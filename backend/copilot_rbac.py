"""
copilot_rbac.py  -  RBAC for the CloseMore AI Copilot backend (FastAPI)

Everything about "who is asking" and "what may they see" lives in this one file:

  get_current_user()   FastAPI dependency. Demo: X-Demo-User header. Later: JWT.
                       (Moving to real login only changes this function.)
  run_scoped_sql()     Runs LLM-written SQL for one user: guard -> read-only
                       transaction -> signed identity -> PostgreSQL RLS filters rows.
  check_sql()          The SQL guard (one plain SELECT on allowed tables only).
  scope_info()         Label for the UI, e.g. "Your deals and deal-team deals in Indore".
  visible_sql()        Whether to return the SQL text to this user.
  audit()              One JSON line per request in logs/audit.jsonl.
  router               GET /me and GET /demo/users.

server.py (current version) uses: set_request_user(), connect_for_request(), connect_for_lookup(),
check_sql(), scope_info(), visible_sql(), audit(). Every changed line in server.py is tagged "# RBAC".

GENERIC WIRING (for any other FastAPI app)
------------------------------------------
    from fastapi import Depends
    from copilot_rbac import (router as rbac_router, get_current_user, CurrentUser,
                              run_scoped_sql, SqlRejected, DbQueryError,
                              scope_info, visible_sql, audit)

    app.include_router(rbac_router)

    @app.post("/ask")
    def ask(body: AskBody, user: CurrentUser = Depends(get_current_user)):
        ...                                       # existing routing / text-to-SQL
        try:
            result = run_scoped_sql(user, sql)    # INSTEAD of cursor.execute(sql)
            rows, columns = result.rows, result.columns
        except SqlRejected as e:                  # guard said no -> treat like an SQL error
            sql_error = str(e)
        except DbQueryError as e:                 # database error (syntax, permission, timeout)
            sql_error = str(e)
        ...
        audit(event="ask", user_id=user.user_id, role=user.role, session_id=body.session_id,
              question=body.question, sql=sql, row_count=..., error=sql_error)
        return {..., "sql": visible_sql(user, sql), "scope": scope_info(user)}

    CORS: allow_headers must include "X-Demo-User", allow_methods must include "DELETE".
    The FastAPI routes that use these functions must be plain `def` (not `async def`),
    because psycopg2 is blocking.

.env (backend)
--------------
    RBAC_MODE=demo                  # demo = X-Demo-User header; anything else = 401 until JWT exists
    COPILOT_DB_HOST=localhost       # defaults to DEMO_POSTGRES_HOST
    COPILOT_DB_PORT=5432            # defaults to DEMO_POSTGRES_PORT
    COPILOT_DB_NAME=closemore_demo  # defaults to DEMO_POSTGRES_DB
    COPILOT_DB_USER=copilot_app
    COPILOT_DB_PASSWORD=...
    COPILOT_RBAC_SECRET=...         # printed by run_phase2.py
    RBAC_SHOW_SQL=all               # all | admins
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

import psycopg2
import psycopg2.pool
import sqlglot
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlglot import exp

logging.getLogger("sqlglot").setLevel(logging.ERROR)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------------------------------------------------------------- settings

RBAC_MODE = os.getenv("RBAC_MODE", "demo")
DEMO_HEADER = "X-Demo-User"
STATEMENT_TIMEOUT_MS = int(os.getenv("RBAC_STATEMENT_TIMEOUT_MS", "20000"))
MAX_ROWS = int(os.getenv("RBAC_MAX_ROWS", "1000"))
MAX_SQL_LENGTH = 8000
AUDIT_DIR = os.getenv("RBAC_AUDIT_DIR", "logs")

DEMO_PERSONAS = [p.strip() for p in os.getenv(
    "DEMO_PERSONAS",
    "seed-u-1,u-1786635589299-566,seed-u-2,seed-u-5,seed-u-12,seed-u-30,seed-u-15,seed-u-6",
).split(",") if p.strip()]

FULL_VIEW_ROLES = {"System_Admin", "Admin"}
REGION_ADMIN_ROLES = {"Sales_Admin", "Executive"}
ROLE_LABELS = {
    "System_Admin": "System admin", "Admin": "System admin",
    "Sales_Admin": "Sales admin", "Executive": "Executive", "Sales_Rep": "Sales rep",
}


def _db_kwargs():
    return dict(
        host=os.getenv("COPILOT_DB_HOST") or os.getenv("DEMO_POSTGRES_HOST", "localhost"),
        port=int(os.getenv("COPILOT_DB_PORT") or os.getenv("DEMO_POSTGRES_PORT", "5432")),
        dbname=os.getenv("COPILOT_DB_NAME") or os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
        user=os.getenv("COPILOT_DB_USER", "copilot_app"),
        password=os.getenv("COPILOT_DB_PASSWORD", ""),
        application_name="closemore-copilot",
    )


# ---------------------------------------------------------------- errors / results

class SqlRejected(Exception):
    """The SQL guard refused the query. The message is safe to show and to feed back to the LLM.
    security=True means the query tried something unsafe; False means an ordinary mistake (unknown function...)."""

    def __init__(self, message, security=True):
        super().__init__(message)
        self.security = security


class DbQueryError(Exception):
    """The database refused or failed the query (syntax, permission, timeout...)."""

    def __init__(self, message, pgcode=None):
        super().__init__(message)
        self.pgcode = pgcode


@dataclass
class QueryResult:
    columns: list
    rows: list
    row_count: int
    truncated: bool


@dataclass
class CurrentUser:
    user_id: str
    name: str
    role: str
    regions: list = field(default_factory=list)
    organization_id: str | None = None

    @property
    def role_label(self):
        return ROLE_LABELS.get(self.role, self.role)

    @property
    def is_full_view(self):
        return self.role in FULL_VIEW_ROLES or (self.role in REGION_ADMIN_ROLES and not self.regions)

    def public(self):
        return {
            "user_id": self.user_id,
            "name": self.name,
            "role": self.role,
            "role_label": self.role_label,
            "regions": self.regions,
            "scope_label": scope_label(self),
            "demo_mode": RBAC_MODE == "demo",
        }


# ---------------------------------------------------------------- database access

_POOL = None
_POOL_LOCK = threading.Lock()


def _pool():
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = psycopg2.pool.ThreadedConnectionPool(
                1, int(os.getenv("RBAC_POOL_MAX", "5")), **_db_kwargs())
        return _POOL


def _secret():
    secret = os.getenv("COPILOT_RBAC_SECRET", "")
    if not secret:
        raise RuntimeError("COPILOT_RBAC_SECRET is not set (run_phase2.py prints it).")
    return secret


def sign_user(user_id):
    """Must match rbac.sign_user() in the database: HMAC-SHA256(user_id, secret) as hex."""
    return hmac.new(_secret().encode("utf-8"), user_id.encode("utf-8"), hashlib.sha256).hexdigest()


@contextmanager
def _user_transaction(user_id):
    """A read-only transaction in which the database knows who is asking. Always rolled back."""
    pool = _pool()
    conn = pool.getconn()
    broken = False
    try:
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute("SET LOCAL statement_timeout = %s", (str(STATEMENT_TIMEOUT_MS),))
        cur.execute("SET LOCAL app.current_user_id = %s", (user_id,))
        cur.execute("SET LOCAL app.current_user_sig = %s", (sign_user(user_id),))
        yield cur
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        broken = True
        raise
    finally:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            broken = True
        pool.putconn(conn, close=broken)


def _split_regions(text):
    return [r.strip() for r in (text or "").split(",") if r.strip()]


def load_user(user_id):
    """Returns the active user, or None. RLS only shows a user's own row if they are Active."""
    if not user_id or len(user_id) > 128:
        return None
    with _user_transaction(user_id) as cur:
        cur.execute(
            'select "User_ID", "First_Name", "Last_Name", "Role", "Region", "Organization_ID" '
            'from users where "User_ID" = %s', (user_id,))
        row = cur.fetchone()
    if not row:
        return None
    uid, first, last, role, region, org = row
    return CurrentUser(
        user_id=uid,
        name=" ".join(p for p in (first, last) if p).strip() or uid,
        role=role,
        regions=_split_regions(region),
        organization_id=str(org) if org else None,
    )


# ---------------------------------------------------------------- identity (the only part JWT changes)

def get_current_user(request: Request) -> CurrentUser:
    if RBAC_MODE == "demo":
        user_id = (request.headers.get(DEMO_HEADER) or "").strip()
        if not user_id:
            raise HTTPException(status_code=401, detail="No user selected.")
        user = load_user(user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Unknown or inactive user.")
        return user
    # Phase 6: the website's login. website_connector.py only says WHICH user is asking; everything about what that
    # user may see stays here and in the database.
    import website_connector
    user_id = website_connector.get_website_user(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Login required.")
    user = load_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unknown or inactive user.")
    return user


# ---------------------------------------------------------------- scope labels

def _join(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def scope_label(user: CurrentUser):
    if user.role in FULL_VIEW_ROLES:
        return "All deals in your organization"
    if user.role in REGION_ADMIN_ROLES:
        return "All regions" if not user.regions else f"Deals in {_join(user.regions)}"
    if user.role == "Sales_Rep":
        if not user.regions:
            return "No region in your profile, so no deals are visible"
        return f"Your deals and deal-team deals in {_join(user.regions)}"
    return "No access"


def scope_info(user: CurrentUser):
    return {"label": scope_label(user), "role": user.role, "role_label": user.role_label,
            "regions": user.regions, "user_id": user.user_id, "name": user.name}


def visible_sql(user: CurrentUser, sql):
    if os.getenv("RBAC_SHOW_SQL", "all") == "all" or user.role in FULL_VIEW_ROLES:
        return sql
    return None


# ---------------------------------------------------------------- SQL guard

ALLOWED_TABLES = {
    "deals", "contacts", "deal_contacts", "deal_team_members", "line_items",
    "products", "pipelines", "deal_types", "users", "organizations", "organization_regions",
}

# Functions the parser does not know by name must be on this list.
ALLOWED_UNKNOWN_FUNCTIONS = {
    "date_part", "to_char", "to_date", "to_timestamp", "to_number", "age", "justify_interval",
    "initcap", "btrim", "ltrim", "rtrim", "split_part", "string_to_array", "array_to_string",
    "regexp_replace", "regexp_match", "make_date", "make_interval", "date_bin", "generate_series",
    "unnest", "cardinality", "array_length", "array_position", "width_bucket", "percentile_cont",
    "percentile_disc", "mode", "ntile", "bool_or", "bool_and", "every", "jsonb_array_length",
    "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_extract_path_text", "json_agg",
    "jsonb_agg", "concat_ws", "format", "nullif", "date", "now", "char_length", "octet_length",
    "trunc", "sign", "div", "mod", "lpad", "rpad", "repeat", "reverse", "strpos", "left", "right",
}
DENIED_FUNCTIONS = {
    "set_config", "current_setting", "query_to_xml", "query_to_xml_and_xmlschema",
    "dblink", "lo_import", "lo_export", "lo_get", "txid_current", "current_user", "session_user",
}
_FORBIDDEN_NODES = tuple(getattr(exp, n) for n in (
    "Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "Command", "Set",
    "Into", "Lock", "TruncateTable", "Copy", "Grant", "Use", "Transaction", "Commit", "Rollback",
) if hasattr(exp, n))


def check_sql(sql):
    """Returns the cleaned SQL, or raises SqlRejected with a short, safe reason."""
    if not isinstance(sql, str) or not sql.strip():
        raise SqlRejected("Empty query.", security=False)
    text = sql.strip()
    while text.endswith(";"):
        text = text[:-1].rstrip()
    if len(text) > MAX_SQL_LENGTH:
        raise SqlRejected("Query is too long.", security=False)
    # Characters that let PostgreSQL and the parser disagree about where a statement ends.
    for bad, reason in ((";", "Only one statement is allowed."),
                        ("\\", "Backslashes are not allowed."),
                        ("/*", "Block comments are not allowed."),
                        ("$", "Dollar quoting and parameters are not allowed."),
                        ("\x00", "Invalid character.")):
        if bad in text:
            raise SqlRejected(reason)
    if re.search(r"\b(set_config|pg_sleep)\b", text, re.IGNORECASE):
        raise SqlRejected("That function is not allowed.")

    try:
        statements = [s for s in sqlglot.parse(text, read="postgres") if s is not None]
    except Exception:  # noqa: BLE001
        raise SqlRejected("Could not parse the query.", security=False)
    if len(statements) != 1:
        raise SqlRejected("Only one statement is allowed.")
    root = statements[0]
    while isinstance(root, (exp.Subquery, exp.Paren)) and root.this is not None:
        root = root.this
    if not isinstance(root, (exp.Select, exp.Union, exp.Except, exp.Intersect)):
        raise SqlRejected("Only SELECT queries are allowed.")

    for node in root.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise SqlRejected("Only read-only SELECT queries are allowed.")

    cte_names = {c.alias_or_name.lower() for c in root.find_all(exp.CTE)}
    for t in root.find_all(exp.Table):
        if not isinstance(t.this, exp.Identifier):
            continue  # table functions such as generate_series are checked below
        if t.catalog or (t.db and t.db.lower() != "public"):
            raise SqlRejected(f"Schema '{t.db or t.catalog}' is not allowed.")
        name = t.name.lower()
        if name not in ALLOWED_TABLES and name not in cte_names:
            raise SqlRejected(f"Table '{t.name}' is not available.", security=name.startswith("pg_"))

    for d in root.find_all(exp.Dot):
        if isinstance(d.expression, exp.Func):
            raise SqlRejected("Schema-qualified functions are not allowed.")

    for f in root.find_all(exp.Func):
        if isinstance(f, exp.Anonymous):
            name = (f.name or "").lower()
            if name not in ALLOWED_UNKNOWN_FUNCTIONS:
                raise SqlRejected(f"Function '{f.name}' is not allowed.", security=name.startswith("pg_"))
        else:
            name = (f.sql_name() or "").lower()
        if name in DENIED_FUNCTIONS or name.startswith("pg_"):
            raise SqlRejected(f"Function '{name}' is not allowed.")
    return text


# ---------------------------------------------------------------- running LLM SQL

def run_scoped_sql(user: CurrentUser, sql) -> QueryResult:
    clean = check_sql(sql)
    try:
        with _user_transaction(user.user_id) as cur:
            cur.execute(clean)
            columns = [d.name for d in cur.description] if cur.description else []
            rows = cur.fetchmany(MAX_ROWS + 1) if cur.description else []
    except psycopg2.errors.InsufficientPrivilege:
        raise DbQueryError("Permission denied: that column or table is not available.", "42501")
    except psycopg2.errors.QueryCanceled:
        raise DbQueryError("The query took too long and was stopped.", "57014")
    except psycopg2.Error as e:
        message = (e.pgerror or str(e)).strip().splitlines()[0] if (e.pgerror or str(e)) else "Query failed."
        raise DbQueryError(message, e.pgcode)
    truncated = len(rows) > MAX_ROWS
    rows = rows[:MAX_ROWS]
    return QueryResult(columns=columns, rows=rows, row_count=len(rows), truncated=truncated)


# ---------------------------------------------------------------- connections for existing pipeline code

# The user of the request being handled. Set once per request with set_request_user().
current_user_var: ContextVar = ContextVar("copilot_current_user", default=None)
LOOKUP_USER = os.getenv("RBAC_LOOKUP_USER", "seed-u-1")


def set_request_user(user: CurrentUser):
    current_user_var.set(user)


def request_user():
    return current_user_var.get()


def connect_as(user_id, statement_timeout_ms=None):
    """A read-only psycopg2 connection whose whole session belongs to user_id.
    Identity is set at SESSION level, so it survives the conn.rollback() calls the pipeline makes.
    The caller closes the connection (it is not pooled)."""
    if not user_id:
        raise RuntimeError("No user for this database connection (refusing to run without one).")
    conn = psycopg2.connect(**_db_kwargs())
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = %s", (str(statement_timeout_ms or STATEMENT_TIMEOUT_MS),))
            cur.execute("SET app.current_user_id = %s", (user_id,))
            cur.execute("SET app.current_user_sig = %s", (sign_user(user_id),))
        conn.autocommit = False
        conn.set_session(readonly=True)
        return conn
    except Exception:
        conn.close()
        raise


def connect_for_request(statement_timeout_ms=None):
    """Connection for the user of the current request. Fails if no user was set (fail closed)."""
    user = request_user()
    return connect_as(user.user_id if user else None, statement_timeout_ms)


def connect_for_lookup(statement_timeout_ms=None):
    """Connection for the shared name index (entity lookup). Runs as RBAC_LOOKUP_USER.
    Demo limitation: names are resolved across the whole organization; the data itself stays scoped."""
    return connect_as(LOOKUP_USER, statement_timeout_ms)


# ---------------------------------------------------------------- audit

_AUDIT_LOCK = threading.Lock()


def audit(**fields):
    """Appends one JSON line to logs/audit.jsonl. Never raises."""
    try:
        os.makedirs(AUDIT_DIR, exist_ok=True)
        record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **fields}
        line = json.dumps(record, default=str, ensure_ascii=False)
        with _AUDIT_LOCK, open(os.path.join(AUDIT_DIR, "audit.jsonl"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------- upload regions

def upload_regions(user: CurrentUser):
    """Regions this user may upload documents into: own regions, or every region of the
    organization for full-view users. A sales rep with no region gets []."""
    if not user.is_full_view:
        return list(user.regions)
    try:
        with _user_transaction(user.user_id) as cur:
            cur.execute("select rbac.org_regions()")
            return list(cur.fetchone()[0] or [])
    except psycopg2.Error:          # Phase 3 SQL not applied yet
        return list(user.regions)


def public_with_regions(user: CurrentUser):
    out = user.public()
    out["profile_regions"] = list(user.regions)
    out["regions"] = upload_regions(user)
    out["all_regions"] = user.is_full_view
    return out


# ---------------------------------------------------------------- routes

router = APIRouter()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return public_with_regions(user)


@router.get("/demo/users")
def demo_users():
    if RBAC_MODE != "demo":
        raise HTTPException(status_code=404, detail="Not found.")
    out = []
    for user_id in DEMO_PERSONAS:
        user = load_user(user_id)
        if user:
            out.append(public_with_regions(user))
    return out