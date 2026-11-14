"""
CRM database readiness check  (READ-ONLY)

What it tells you:
  1. Who you are in the DB and what you are allowed to do (read / create / bypass RLS)
  2. Postgres version and total database size
  3. Every table: approx rows, size, whether you can SELECT it, whether RLS is already on
  4. Columns that look like ownership / region / team (needed for RBAC)
  5. Columns that look sensitive (names, emails, phones...) so you know what to mask
  6. Foreign keys (so a copy keeps relations intact)
  7. Whether pg_dump works for you (also saves a schema-only dump, NO row data)

It never writes to the database. The report file contains table and column
names only, no row data.

Usage:
    python check_crm_db.py              # fast, uses row estimates
    python check_crm_db.py --exact      # exact COUNT(*) per table (slower on big tables)
    python check_crm_db.py --no-dump    # skip the pg_dump test
"""
import argparse
import os
import re
import shutil
import subprocess
from datetime import datetime

import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv

load_dotenv()

SYSTEM_SCHEMAS = ("pg_catalog", "information_schema")

OWNERSHIP_WORDS = [
    "owner", "region", "territory", "manager", "team",
    "assigned", "created_by", "sales_rep", "user_id",
]
SENSITIVE_WORDS = [
    "email", "phone", "mobile", "address", "ssn", "password", "passwd",
    "token", "secret", "salary", "dob", "birth", "iban", "aadhaar",
    "first_name", "last_name", "full_name",
]

REPORT = []


def out(line=""):
    print(line)
    REPORT.append(line)


def section(title):
    out()
    out("=" * 72)
    out(title)
    out("=" * 72)


def human(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def get_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        port=int(os.getenv("POSTGRES_PORT")),
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
        sslmode=os.getenv("POSTGRES_SSLMODE", "disable"),
    )


def check_server_and_role(cur, verdict):
    section("1. SERVER AND YOUR ROLE")
    cur.execute(
        "select version(), current_user, current_database(), "
        "current_setting('server_version_num')::int"
    )
    version, user, db, vnum = cur.fetchone()
    major = vnum // 10000
    out(f"Server      : {version}")
    out(f"Database    : {db}")
    out(f"You are     : {user}")
    out(f"Major ver.  : {major}  (security_invoker views need 15+)")
    verdict["server_major"] = major

    cur.execute(
        "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls "
        "from pg_roles where rolname = current_user"
    )
    sup, createdb, createrole, bypass = cur.fetchone()
    out(f"Superuser   : {sup}")
    out(f"Create DB   : {createdb}")
    out(f"Create role : {createrole}")
    out(f"Bypass RLS  : {bypass}")

    try:
        cur.execute(
            "select has_database_privilege(current_database(), 'CREATE'), "
            "has_schema_privilege('public', 'CREATE')"
        )
        db_create, schema_create = cur.fetchone()
    except Exception:
        db_create, schema_create = None, None
    out(f"CREATE on database : {db_create}")
    out(f"CREATE on public   : {schema_create}")
    verdict["can_write_here"] = bool(schema_create or db_create)

    cur.execute("select pg_database_size(current_database())")
    size = cur.fetchone()[0]
    out(f"Database size      : {human(size)}")
    verdict["db_size"] = size


def check_tables(cur, verdict, exact):
    section("2. TABLES (rows, size, access, RLS)")
    cur.execute(
        """
        select n.nspname, c.relname, c.relkind, c.reltuples::bigint,
               pg_total_relation_size(c.oid),
               has_table_privilege(c.oid, 'SELECT'),
               c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm')
          and n.nspname not in %s
          and n.nspname not like 'pg\\_%%'
        order by n.nspname, c.relname
        """,
        (SYSTEM_SCHEMAS,),
    )
    rows = cur.fetchall()
    out(f"{'table':45} {'kind':4} {'rows':>12} {'size':>10} {'select':>6} {'rls':>4}")
    out("-" * 86)

    tables = []
    total_bytes = 0
    unreadable = []
    rls_on = 0
    for schema, name, kind, est, size, can_select, rls in rows:
        full = f"{schema}.{name}"
        count_txt = "unknown" if est < 0 else f"~{est}"
        if exact and can_select and kind in ("r", "p"):
            try:
                cur.execute(
                    sql.SQL("select count(*) from {}.{}").format(
                        sql.Identifier(schema), sql.Identifier(name)
                    )
                )
                count_txt = str(cur.fetchone()[0])
            except Exception as e:
                count_txt = "error"
                out(f"  (count failed for {full}: {e})")
        out(
            f"{full:45} {kind:4} {count_txt:>12} {human(size):>10} "
            f"{'yes' if can_select else 'NO':>6} {'on' if rls else 'off':>4}"
        )
        tables.append((schema, name, kind))
        if kind in ("r", "p"):
            if can_select:
                total_bytes += size
            else:
                unreadable.append(full)
        if rls:
            rls_on += 1

    out("-" * 86)
    out(f"Objects listed: {len(rows)}  (kind: r=table p=partitioned v=view m=matview)")
    out(f"Readable table size, upper bound incl. indexes: {human(total_bytes)}")
    if unreadable:
        out("Tables you cannot SELECT: " + ", ".join(unreadable))
    out(f"Objects with RLS already on: {rls_on}")
    verdict["readable_bytes"] = total_bytes
    verdict["unreadable"] = unreadable
    verdict["table_count"] = len(rows)


def check_columns(cur):
    section("3. COLUMNS THAT MATTER FOR RBAC AND PRIVACY")
    cur.execute(
        """
        select table_schema, table_name, column_name, data_type
        from information_schema.columns
        where table_schema not in %s and table_schema not like 'pg\\_%%'
        order by table_schema, table_name, ordinal_position
        """,
        (SYSTEM_SCHEMAS,),
    )
    cols = cur.fetchall()

    out("Ownership / region / team style columns:")
    found = False
    for schema, table, col, dtype in cols:
        low = col.lower()
        if any(w in low for w in OWNERSHIP_WORDS):
            out(f"  {schema}.{table}.{col}  ({dtype})")
            found = True
    if not found:
        out("  none found")

    out()
    out("Possibly sensitive columns (consider masking in a copy):")
    found = False
    for schema, table, col, dtype in cols:
        low = col.lower()
        if any(w in low for w in SENSITIVE_WORDS):
            out(f"  {schema}.{table}.{col}  ({dtype})")
            found = True
    if not found:
        out("  none found")


def check_foreign_keys(cur):
    section("4. FOREIGN KEYS")
    cur.execute(
        """
        select conrelid::regclass::text, conname, pg_get_constraintdef(c.oid)
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f'
          and n.nspname not in %s and n.nspname not like 'pg\\_%%'
        order by 1, 2
        """,
        (SYSTEM_SCHEMAS,),
    )
    fks = cur.fetchall()
    if not fks:
        out("No foreign keys defined (relations may be implicit by column name).")
        return
    for table, name, definition in fks:
        out(f"  {table}: {definition}")


def check_pg_dump(server_major, verdict):
    section("5. PG_DUMP TEST (schema only, no row data)")
    exe = shutil.which("pg_dump")
    if not exe:
        out("pg_dump NOT found on PATH.")
        out("Install PostgreSQL client tools (matching the server major version),")
        out("or use the COPY / psycopg2 export fallback instead.")
        verdict["dump_ok"] = False
        return

    raw = subprocess.run([exe, "--version"], capture_output=True, text=True).stdout.strip()
    out(f"Found: {exe}")
    out(f"Client: {raw}")
    m = re.search(r"(\d+)(?:\.\d+)*", raw.split(")")[-1])
    client_major = int(m.group(1)) if m else None
    if client_major and client_major < server_major:
        out(f"WARNING: pg_dump {client_major} is older than server {server_major}; "
            "it will refuse to dump. Install a matching or newer client.")

    env = os.environ.copy()
    env["PGPASSWORD"] = os.getenv("POSTGRES_PASSWORD", "")
    env["PGSSLMODE"] = os.getenv("POSTGRES_SSLMODE", "disable")
    target = "crm_schema_only.sql"
    cmd = [
        exe,
        "-h", os.getenv("POSTGRES_HOST"),
        "-p", str(os.getenv("POSTGRES_PORT")),
        "-U", os.getenv("POSTGRES_USER"),
        "-d", os.getenv("POSTGRES_DB"),
        "--schema-only", "--no-owner", "--no-privileges",
        "-f", target,
    ]
    try:
        res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        out("pg_dump timed out after 180s.")
        verdict["dump_ok"] = False
        return
    if res.returncode == 0:
        out(f"pg_dump schema-only OK -> saved {target} (structure only, no data)")
        verdict["dump_ok"] = True
    else:
        out("pg_dump FAILED:")
        out(res.stderr.strip()[:600])
        verdict["dump_ok"] = False


def print_verdict(verdict):
    section("SUMMARY")
    out(f"Postgres major version      : {verdict['server_major']}")
    out(f"Database size               : {human(verdict['db_size'])}")
    out(f"Readable tables size (max)  : {human(verdict['readable_bytes'])}")
    out(f"You can write in this DB    : {verdict['can_write_here']}  (expected False)")
    if verdict["unreadable"]:
        out(f"Tables you cannot read      : {len(verdict['unreadable'])} (a copy would miss these)")
    else:
        out("Tables you cannot read      : none")
    if "dump_ok" in verdict:
        out(f"pg_dump works               : {verdict['dump_ok']}")
    out()
    out("Reading this:")
    out(" - All needed tables readable + modest size  -> copying to a private DB is feasible.")
    out(" - pg_dump False                             -> use per-table COPY / psycopg2 export.")
    out(" - Sensitive columns listed above            -> confirm permission or mask them first.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exact", action="store_true", help="exact COUNT(*) per table")
    parser.add_argument("--no-dump", action="store_true", help="skip the pg_dump test")
    args = parser.parse_args()

    out(f"CRM DB check - {datetime.now():%Y-%m-%d %H:%M}")
    try:
        conn = get_connection()
    except Exception as e:
        out("Connection failed:")
        out(str(e))
        return
    out("Connected to PostgreSQL successfully.")

    verdict = {}
    try:
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()
        check_server_and_role(cur, verdict)
        check_tables(cur, verdict, args.exact)
        check_columns(cur)
        check_foreign_keys(cur)
    except Exception as e:
        out(f"Check failed: {e}")
    finally:
        conn.close()

    if not args.no_dump and "server_major" in verdict:
        check_pg_dump(verdict["server_major"], verdict)

    if "server_major" in verdict:
        print_verdict(verdict)

    with open("crm_db_report.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(REPORT))
    print("\nReport saved to crm_db_report.txt (names only, no row data).")


if __name__ == "__main__":
    main()
