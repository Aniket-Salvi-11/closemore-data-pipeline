"""
Phase 2 runner for the PRIVATE demo copy (never run this against the shared database).

  1. applies 04_app_role.sql (login role copilot_app, set_config revoked)
  2. sets copilot_app's password from COPILOT_DB_PASSWORD in .env
  3. prints COPILOT_RBAC_SECRET if your .env does not have the right one
  4. tests copilot_rbac.py end to end, exactly as the backend will use it:
       - SQL guard (allowed and rejected queries)
       - every persona through run_scoped_sql() vs the team's rules
       - attacks that skip the guard and talk to the database directly
       - /me and /demo/users through FastAPI (needs: pip install httpx)

Admin connection (setup + reference checks): DEMO_POSTGRES_* from .env, or --uri.
App connection: COPILOT_DB_* from .env (same defaults as copilot_rbac.py).

Usage:
    python run_phase2.py
"""
import argparse
import os
import sys
import tempfile

import psycopg2
from psycopg2 import errors

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  - {detail}" if detail else ""))


def admin_connect(uri):
    if uri:
        conn = psycopg2.connect(uri)
    else:
        conn = psycopg2.connect(
            host=os.getenv("DEMO_POSTGRES_HOST", "localhost"),
            port=int(os.getenv("DEMO_POSTGRES_PORT", "5432")),
            dbname=os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
            user=os.getenv("DEMO_POSTGRES_USER", "postgres"),
            password=os.getenv("DEMO_POSTGRES_PASSWORD", ""),
        )
    conn.autocommit = True
    return conn


def oracle_deal_count(cur, uid):
    """Independent implementation of the team's rules, computed as the admin."""
    cur.execute('select "Role", "Region", "Organization_ID", "Status" from users where "User_ID" = %s', (uid,))
    row = cur.fetchone()
    if not row or row[3] != "Active":
        return 0
    role, region, org, _ = row
    regs = {r.strip().lower() for r in (region or "").split(",") if r.strip()}
    cur.execute('select "Deal_ID", "Region", "Owner_ID" from deals where "Organization_ID" = %s', (org,))
    deals = cur.fetchall()
    cur.execute('select "Deal_ID" from deal_team_members where "User_ID" = %s', (uid,))
    team = {r[0] for r in cur.fetchall()}
    n = 0
    for did, dreg, owner in deals:
        dr = (dreg or "").strip().lower()
        if role in ("System_Admin", "Admin"):
            n += 1
        elif role in ("Sales_Admin", "Executive"):
            n += 1 if (not regs or dr in regs) else 0
        elif role == "Sales_Rep":
            n += 1 if (dr and dr in regs and (owner == uid or did in team)) else 0
    return n


GUARD_CASES = [
    # (sql, should be allowed)
    ('select "Owner_ID", count(*) from deals group by "Owner_ID"', True),
    ('SELECT d."Deal_Name", u."First_Name" FROM deals d JOIN users u ON u."User_ID" = d."Owner_ID";', True),
    ("with t as (select \"Region\" r, sum(\"Deal_Value\") v from deals group by 1) select * from t order by v desc", True),
    ("select date_trunc('month', \"Expected_Close_Date\"), count(*) from deals group by 1", True),
    ("select to_char(now(), 'YYYY-MM'), coalesce(max(\"Deal_Value\"), 0) from deals", True),
    ("select \"Name\" from products union select \"Deal_Name\" from deals", True),
    ("select count(*) from deals where \"Status\" ilike '%open%' -- open deals", True),
    ("select 1; select 2", False),
    ("select set_config('app.current_user_id', 'seed-u-1', true)", False),
    ("select pg_catalog.set_config('a', 'b', true)", False),
    ("set local app.current_user_id = 'seed-u-1'", False),
    ("reset role", False),
    ("update deals set \"Deal_Value\" = 0", False),
    ("with x as (delete from deals returning *) select * from x", False),
    ("select * into newtable from deals", False),
    ("select * from deals for update", False),
    ("select * from pg_catalog.pg_user", False),
    ("select * from information_schema.tables", False),
    ("select * from rbac.app_secret", False),
    ("select rbac.sign_user('seed-u-1')", False),
    ("select pg_sleep(30)", False),
    ("select current_setting('app.current_user_id')", False),
    ("select query_to_xml('select 1', true, true, '')", False),
    ("select $$a$$", False),
    ("select 'a\\'; select 1", False),
    ("select 1 /* hidden */", False),
    ("copy deals to '/tmp/x.csv'", False),
    ("do $$ begin perform 1; end $$", False),
    ("", False),
]


def test_guard(rb):
    print("\nSQL GUARD")
    for sql, should_pass in GUARD_CASES:
        try:
            rb.check_sql(sql)
            ok, detail = should_pass, "allowed"
        except rb.SqlRejected as e:
            ok, detail = not should_pass, f"rejected: {e}"
        label = (sql[:60] + "...") if len(sql) > 60 else (sql or "(empty)")
        record(f"{'allow' if should_pass else 'block'}: {label}", ok, "" if ok else detail)


def test_personas(rb, admin):
    print("\nPERSONAS THROUGH run_scoped_sql() (the real backend path)")
    cur = admin.cursor()
    for uid in rb.DEMO_PERSONAS:
        user = rb.load_user(uid)
        if not user:
            record(f"{uid}: loads as an active user", False, "not found or not Active")
            continue
        got = rb.run_scoped_sql(user, "select count(*) from deals").rows[0][0]
        want = oracle_deal_count(cur, uid)
        record(f"{user.role_label:13} {user.name:18} sees {got:>3} deals", got == want,
               f"{rb.scope_label(user)}" if got == want else f"expected {want}")

    print("\n  Demo preview - same question, same SQL, different answers:")
    q = ('select u."First_Name" || \' \' || u."Last_Name" as owner, count(*) as deals '
         'from deals d join users u on u."User_ID" = d."Owner_ID" group by 1 order by 2 desc')
    for uid in ["seed-u-1", "seed-u-2", "seed-u-5"]:
        user = rb.load_user(uid)
        if user:
            res = rb.run_scoped_sql(user, q)
            print(f"    {user.name:15} ({user.role_label}): {res.row_count} owner rows")


def test_attacks(rb, admin):
    print("\nATTACKS THAT SKIP THE GUARD (direct to the database as copilot_app)")
    acur = admin.cursor()
    acur.execute("select rolsuper, rolbypassrls from pg_roles where rolname = 'copilot_app'")
    sup, byp = acur.fetchone()
    record("copilot_app is not superuser and cannot bypass RLS", not sup and not byp)

    uid = "seed-u-5"
    own = oracle_deal_count(acur, uid)

    def raw(sqls, sig=None):
        conn = psycopg2.connect(**rb._db_kwargs())
        try:
            c = conn.cursor()
            c.execute("SET LOCAL app.current_user_id = %s", (uid,))
            c.execute("SET LOCAL app.current_user_sig = %s", (sig if sig is not None else rb.sign_user(uid),))
            out = None
            for s in sqls:
                c.execute(s)
                out = c.fetchall() if c.description else None
            return out
        finally:
            conn.rollback()
            conn.close()

    n = raw(["select count(*) from deals"])[0][0]
    record("correct identity sees own scope", n == own, f"{n} deals")
    n = raw(["select count(*) from deals"], sig="0" * 64)[0][0]
    record("forged signature sees nothing", n == 0, f"{n} deals")
    n = raw(["set local app.current_user_id = 'seed-u-1'", "select count(*) from deals"])[0][0]
    record("switching user id with SET LOCAL sees nothing", n == 0, f"{n} deals")

    for label, sql, exc in [
        ("set_config() is not callable", "select set_config('app.current_user_id', 'seed-u-1', true)", errors.InsufficientPrivilege),
        ("secret table is not readable", "select * from rbac.app_secret", errors.InsufficientPrivilege),
        ("sign_user() is not callable", "select rbac.sign_user('seed-u-1')", errors.InsufficientPrivilege),
        ("users.Password is not readable", 'select "Password" from users', errors.InsufficientPrivilege),
        ("writes are refused", 'update deals set "Deal_Value" = 0', psycopg2.Error),
    ]:
        try:
            raw([sql])
            record(label, False, "query succeeded")
        except exc as e:
            record(label, True, type(e).__name__)


def test_api(rb, admin):
    print("\nAPI (/me, /demo/users)")
    try:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
    except Exception:  # noqa: BLE001
        print("  (skipped: pip install httpx to run the API tests)")
        return
    app = FastAPI()
    app.include_router(rb.router)
    client = TestClient(app)
    record("/me without header -> 401", client.get("/me").status_code == 401)
    record("/me with unknown user -> 401", client.get("/me", headers={rb.DEMO_HEADER: "nobody"}).status_code == 401)
    cur = admin.cursor()
    cur.execute('select "User_ID" from users where "Status" <> %s limit 1', ("Active",))
    row = cur.fetchone()
    if row:
        record("/me with inactive user -> 401", client.get("/me", headers={rb.DEMO_HEADER: row[0]}).status_code == 401)
    r = client.get("/me", headers={rb.DEMO_HEADER: "seed-u-5"})
    record("/me with a persona -> 200", r.status_code == 200, str(r.json().get("scope_label")) if r.status_code == 200 else r.text)
    r = client.get("/demo/users")
    ok = r.status_code == 200 and len(r.json()) == len(rb.DEMO_PERSONAS)
    record("/demo/users lists all personas", ok, f"{len(r.json())} users" if r.status_code == 200 else r.text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=None, help="admin connection (default: DEMO_POSTGRES_* from .env)")
    a = ap.parse_args()

    admin = admin_connect(a.uri)
    cur = admin.cursor()
    cur.execute("select current_database(), current_user")
    db, user = cur.fetchone()
    print(f"Connected to {db} as {user}")
    if db == "closemore_next":
        sys.exit("Refusing to run on the shared database.")
    cur.execute("select to_regclass('rbac.app_secret')")
    if cur.fetchone()[0] is None:
        sys.exit("rbac.app_secret not found. Run the updated phase1/run_phase1.py first.")

    password = os.getenv("COPILOT_DB_PASSWORD")
    if not password:
        sys.exit("Add COPILOT_DB_PASSWORD=<choose a password> to your .env, then run again.")

    print("\nSETUP")
    with open(os.path.join(HERE, "04_app_role.sql"), encoding="utf-8") as f:
        cur.execute(f.read())
    print("  applied 04_app_role.sql")
    cur.execute("alter role copilot_app password %s", (password,))
    print("  set copilot_app password from COPILOT_DB_PASSWORD")
    cur.execute("select secret from rbac.app_secret limit 1")
    secret = cur.fetchone()[0]
    if os.getenv("COPILOT_RBAC_SECRET") != secret:
        print("\n  >>> Add this line to your backend .env (keep it private):")
        print(f"      COPILOT_RBAC_SECRET={secret}\n")
        os.environ["COPILOT_RBAC_SECRET"] = secret
    else:
        print("  COPILOT_RBAC_SECRET in .env matches the database")

    os.environ.setdefault("RBAC_AUDIT_DIR", tempfile.mkdtemp(prefix="rbac_audit_"))
    import copilot_rbac as rb

    test_guard(rb)
    test_personas(rb, admin)
    test_attacks(rb, admin)
    test_api(rb, admin)

    failed = [n for n, ok in RESULTS if not ok]
    print(f"\nSUMMARY: {len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAILED: {n}")


if __name__ == "__main__":
    main()
