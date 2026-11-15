"""
Phase 1 runner for the PRIVATE demo copy (never run this against the shared database).

  1. applies 01_clean_data.sql, 02_rbac_policies.sql, 03_seed_demo.sql
  2. tests every demo persona AS the restricted role copilot_ro, comparing what
     Postgres RLS returns with an independent re-implementation of the team's rules
  3. runs security tests (no identity, inactive user, bypass attempts, column
     privileges, team rule trigger, writes)

Connection: DEMO_POSTGRES_* variables from .env (same as make_demo_copy.py),
or pass --uri postgresql://user:pass@host:port/dbname

Usage:
    python run_phase1.py                 # apply SQL + run tests
    python run_phase1.py --tests-only    # only run the tests
"""
import argparse
import os
import sys

import psycopg2
from psycopg2 import errors

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SQL_FILES = ["01_clean_data.sql", "02_rbac_policies.sql", "03_seed_demo.sql"]

PERSONAS = [
    ("seed-u-1", "System admin"),
    ("u-1786635589299-566", "Sales admin, no region"),
    ("seed-u-2", "Sales admin, East"),
    ("seed-u-5", "Rep, Indore"),
    ("seed-u-12", "Rep, Indore"),
    ("seed-u-30", "Rep, Indore + Australia"),
    ("seed-u-15", "Rep, Japan"),
    ("seed-u-6", "Rep, East"),
]

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  - {detail}" if detail else ""))


def connect(uri, autocommit):
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
    conn.autocommit = autocommit
    return conn


def apply_sql(admin):
    cur = admin.cursor()
    for name in SQL_FILES:
        with open(os.path.join(HERE, name), encoding="utf-8") as f:
            cur.execute(f.read())
        print(f"  applied {name}")


def split_regions(text):
    return {r.strip().lower() for r in (text or "").split(",") if r.strip()}


def oracle_deals(cur, uid):
    """Independent implementation of the team's rules (plain SQL on raw tables)."""
    cur.execute('select "Role", "Region", "Organization_ID", "Status" from users where "User_ID" = %s', (uid,))
    row = cur.fetchone()
    if not row or row[3] != "Active":
        return set()
    role, region, org, _ = row
    regs = split_regions(region)
    cur.execute('select "Deal_ID", "Region", "Owner_ID" from deals where "Organization_ID" = %s', (org,))
    deals = cur.fetchall()
    cur.execute('select "Deal_ID" from deal_team_members where "User_ID" = %s', (uid,))
    team = {r[0] for r in cur.fetchall()}
    out = set()
    for did, dreg, owner in deals:
        dr = (dreg or "").strip().lower()
        if role in ("System_Admin", "Admin"):
            out.add(did)
        elif role in ("Sales_Admin", "Executive"):
            if not regs or dr in regs:
                out.add(did)
        elif role == "Sales_Rep":
            if dr and dr in regs and (owner == uid or did in team):
                out.add(did)
    return out


def as_user(conn, uid, queries, settings=None):
    """Run read queries as copilot_ro with the given identity; always rolls back."""
    cur = conn.cursor()
    results = {}
    try:
        # identity is set (and signed) as the admin, THEN we drop to copilot_ro
        if uid is not None:
            cur.execute("select set_config('app.current_user_id', %s, true), "
                        "set_config('app.current_user_sig', rbac.sign_user(%s), true)", (uid, uid))
        for k, v in (settings or {}).items():
            cur.execute("select set_config(%s, %s, true)", (k, v))
        cur.execute("set local role copilot_ro")
        for name, sql in queries.items():
            cur.execute(sql)
            results[name] = cur.fetchall() if cur.description else []
    finally:
        conn.rollback()
    return results


Q = {
    "deals": 'select "Deal_ID" from deals',
    "contacts": 'select "Contact_ID" from contacts',
    "line_items": 'select "Line_Item_ID" from line_items',
    "team": 'select "Deal_ID", "User_ID" from deal_team_members',
    "users": 'select "User_ID" from users',
}


def test_personas(admin, tester):
    print("\nPERSONA CHECKS (RLS result vs independent rule check)")
    cur = admin.cursor()
    cur.execute('select count(*) from deals')
    print(f"  total deals in copy: {cur.fetchone()[0]}")
    print(f"  {'persona':28} {'user_id':22} {'deals':>5} {'contacts':>8} {'items':>5} {'team':>4}")
    for uid, label in PERSONAS:
        cur.execute('select "Status", "Role", "Region" from users where "User_ID" = %s', (uid,))
        info = cur.fetchone()
        if not info:
            record(f"{label} ({uid}) exists", False, "user id not found in the copy")
            continue
        res = as_user(tester, uid, Q)
        got = {r[0] for r in res["deals"]}
        want = oracle_deals(cur, uid)
        print(f"  {label:28} {uid:22} {len(got):>5} {len(res['contacts']):>8} "
              f"{len(res['line_items']):>5} {len(res['team']):>4}")
        record(f"{label}: visible deals match the rules", got == want,
               "" if got == want else f"extra={sorted(got - want)[:5]} missing={sorted(want - got)[:5]}")
        if info[0] != "Active":
            record(f"{label}: user is Active", False, f"status is {info[0]}")


def test_security(admin, tester):
    print("\nSECURITY CHECKS")
    cur = admin.cursor()

    res = as_user(tester, None, Q)
    record("no identity -> no rows at all", all(len(v) == 0 for v in res.values()))

    cur.execute('select "User_ID" from users where "Status" <> %s limit 1', ("Active",))
    row = cur.fetchone()
    if row:
        res = as_user(tester, row[0], Q)
        record(f"inactive/pending user {row[0]} -> no rows", all(len(v) == 0 for v in res.values()))
    else:
        print("  (no non-active user in the copy, test skipped)")

    uid = "seed-u-5"
    want = oracle_deals(cur, uid)
    res = as_user(tester, uid, Q, {
        "app.bypass_rls": "true", "app.current_user_role": "Sales_Admin",
        "app.current_user_region": "", "app.current_user_tenant": "x"})
    record("old bypass_rls / role / region settings are ignored",
           {r[0] for r in res["deals"]} == want)

    try:
        as_user(tester, uid, {"pw": 'select "Password" from users'})
        record("users.Password is not readable by copilot_ro", False, "query succeeded")
    except errors.InsufficientPrivilege:
        tester.rollback()
        record("users.Password is not readable by copilot_ro", True)

    try:
        cur2 = tester.cursor()
        cur2.execute("set local role copilot_ro")
        cur2.execute("select set_config('app.current_user_id', %s, true)", (uid,))
        cur2.execute('update deals set "Deal_Name" = \'x\'')
        wrote = cur2.rowcount
        tester.rollback()
        record("copilot_ro cannot write", False, f"{wrote} rows updated")
    except errors.InsufficientPrivilege:
        tester.rollback()
        record("copilot_ro cannot write", True)

    # team rule trigger: Kenji (Japan) into Priya's Indore deal must be rejected
    cur.execute('select "Deal_ID", "Organization_ID" from deals where "Owner_ID" = %s '
                'and lower(btrim("Region")) = %s order by "Deal_ID" limit 1', ("seed-u-5", "indore"))
    d = cur.fetchone()
    if d:
        try:
            cur.execute("begin")
            cur.execute('insert into deal_team_members ("Deal_ID", "User_ID", "Organization_ID") values (%s, %s, %s)',
                        (d[0], "seed-u-15", d[1]))
            cur.execute("rollback")
            record("team rule: cross-region member is rejected", False, "insert succeeded")
        except errors.CheckViolation as e:
            cur.execute("rollback")
            record("team rule: cross-region member is rejected", True, str(e).splitlines()[0][:90])
    else:
        print("  (no Indore deal owned by seed-u-5, team test skipped)")

    # impersonation from inside SQL (as if the SQL guard had been bypassed)
    allowed = len(oracle_deals(cur, uid))
    for label, swap_sql in [
        ("set_config", "select set_config('app.current_user_id', 'seed-u-1', true)"),
        ("SET LOCAL", "set local app.current_user_id = 'seed-u-1'"),
    ]:
        try:
            res = as_user(tester, uid, {"swap": swap_sql, "all": 'select "Deal_ID" from deals'})
            n_after = len(res["all"])
            record(f"identity switch via {label} gains nothing", n_after <= allowed,
                   f"rows after switch: {n_after} (own scope {allowed})")
        except errors.InsufficientPrivilege:
            tester.rollback()
            record(f"identity switch via {label} gains nothing", True, "permission denied")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=None)
    ap.add_argument("--tests-only", action="store_true")
    a = ap.parse_args()

    admin = connect(a.uri, True)
    tester = connect(a.uri, False)
    cur = admin.cursor()
    cur.execute("select current_database(), current_user")
    db, user = cur.fetchone()
    print(f"Connected to {db} as {user}")
    if db in ("closemore_next",):
        sys.exit("Refusing to run on the shared database.")
    cur.execute("select 1 from pg_roles where rolname = 'copilot_ro'")
    if not cur.fetchone():
        sys.exit("Role copilot_ro not found. Run make_demo_copy.py first.")

    if not a.tests_only:
        print("\nAPPLYING SQL")
        apply_sql(admin)

    test_personas(admin, tester)
    test_security(admin, tester)

    failed = [n for n, ok in RESULTS if not ok]
    print(f"\nSUMMARY: {len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAILED: {n}")


if __name__ == "__main__":
    main()