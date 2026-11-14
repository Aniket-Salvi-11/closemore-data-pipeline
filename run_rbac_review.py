"""
RBAC review check for the Copilot changes (Phase 3.5 - 5A). Run on the PRIVATE demo copy (closemore_demo).
Needs NO language model and NO AWS. Read-only: it changes nothing in the database.

It checks, with the REAL copilot_rbac.py (guard + signed identity + row-level security):
  1. every fixed SQL template the backend can now run passes the RBAC SQL guard (rbac.check_sql)
  2. for every demo persona:
       - the visible deal count is still exactly the team's rules (same check as run_phase2.py)
       - "my deals" / "deals I own" / "deals I'm part of" / "how many deals do I have" return exactly
         (visible deals) AND (owner OR deal-team member) -- computed independently as the admin
       - asking about ANOTHER person's deals never returns a deal outside the persona's scope
       - the "all of them" IN (...) query never returns a deal outside the persona's scope
  3. the name-lookup user (RBAC_LOOKUP_USER) is an active user in the demo organization

Usage (same folder as copilot_rbac.py, sql_templates.py, guardrails.py; .env as for run_phase2.py):
    python run_rbac_review.py
"""
import os
import sys

import psycopg2

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import copilot_rbac as rb          # noqa: E402
import guardrails                  # noqa: E402
import sql_templates as t          # noqa: E402

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  - {detail}" if detail else ""))


def info(text):
    print(f"  [INFO] {text}")


def admin_connect():
    conn = psycopg2.connect(
        host=os.getenv("DEMO_POSTGRES_HOST", "localhost"),
        port=int(os.getenv("DEMO_POSTGRES_PORT", "5432")),
        dbname=os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
        user=os.getenv("DEMO_POSTGRES_USER", "postgres"),
        password=os.getenv("DEMO_POSTGRES_PASSWORD", ""))
    conn.autocommit = True
    return conn


def oracle(cur, uid):
    """(visible deal ids, owned ids, team ids) by the team's rules, computed as the admin on the raw tables."""
    cur.execute('select "Role", "Region", "Organization_ID", "Status" from users where "User_ID" = %s', (uid,))
    row = cur.fetchone()
    if not row or row[3] != "Active":
        return set(), set(), set()
    role, region, org, _ = row
    regs = {r.strip().lower() for r in (region or "").split(",") if r.strip()}
    cur.execute('select "Deal_ID", "Region", "Owner_ID" from deals where "Organization_ID" = %s', (org,))
    deals = cur.fetchall()
    cur.execute('select "Deal_ID" from deal_team_members where "User_ID" = %s', (uid,))
    team = {r[0] for r in cur.fetchall()}
    visible = set()
    for did, dreg, owner in deals:
        dr = (dreg or "").strip().lower()
        if role in ("System_Admin", "Admin"):
            visible.add(did)
        elif role in ("Sales_Admin", "Executive"):
            if not regs or dr in regs:
                visible.add(did)
        elif role == "Sales_Rep":
            if dr and dr in regs and (owner == uid or did in team):
                visible.add(did)
    owned = {did for did, _, owner in deals if owner == uid} & visible
    return visible, owned, team & visible


class Person:
    def __init__(self, uid, name):
        self.id, self.display = uid, name


def as_server(sql):
    """The SQL exactly as server.py would run it: guardrails validator (adds LIMIT) then the RBAC guard."""
    v = guardrails.validate_sql(sql)
    if not v.ok:
        raise rb.SqlRejected(f"guardrails: {v.reason}", security=False)
    return rb.check_sql(v.sql)


def ids(user, where):
    res = rb.run_scoped_sql(user, f'SELECT d."Deal_ID" FROM "deals" d WHERE {where}')
    return {r[0] for r in res.rows}


def test_guard():
    print("\n1. TEMPLATES THROUGH THE RBAC SQL GUARD")
    me = Person("seed-u-5", "Priya Nair")
    for label, q in [("my deals", "show me all my deals"), ("deals I own", "deals I own"),
                     ("deals I'm part of", "deals where I am part of the team"), ("how many deals do I have", "how many deals do I have"),
                     ("deals per owner", "how many deals does each owner have"), ("top owners", "top 5 owners by total deal value"),
                     ("deals by stage", "deals by stage"), ("deals closing", "deals closing this month"),
                     ("deals with contacts", "deals with contacts"), ("deals with owner", "deals with owner"),
                     ("deal name search", "deals whose name contains sail"), ("total value", "total deal value"),
                     ("count deals", "how many deals are there"), ("person's deals", "deals of priya nair")]:
        m = t.match(q)
        if m is None:
            record(f"{label}: template matches", False, q)
            continue
        sql = m.build(me) if m.build else m.sql
        try:
            as_server(sql)
            record(f"{label} ({m.name}) allowed", True)
        except rb.SqlRejected as e:
            record(f"{label} ({m.name}) allowed", False, str(e))
    m = t.match("tasks of priya nair")
    try:
        as_server(m.build(me))
        info("tasks template is allowed (unexpected: 'tasks' is not in rbac.ALLOWED_TABLES)")
    except rb.SqlRejected as e:
        info(f"tasks template rejected as expected ({e}); task questions are not available in the Copilot")


def test_personas(admin):
    print("\n2. PERSONAS (real identity + row-level security vs independent rules)")
    cur = admin.cursor()
    cur.execute('select "User_ID" from users')
    everyone = [r[0] for r in cur.fetchall()]
    for uid in rb.DEMO_PERSONAS:
        user = rb.load_user(uid)
        if not user:
            record(f"{uid}: loads as an active user", False)
            continue
        who = f"{user.role_label:12} {user.name:16}"
        visible, owned, team = oracle(cur, uid)
        me = t.lit(uid)

        got = {r[0] for r in rb.run_scoped_sql(user, 'select "Deal_ID" from deals').rows}
        record(f"{who} sees {len(got):>3} deals (unchanged rules)", got == visible,
               "" if got == visible else f"expected {len(visible)}")

        for label, where, want in [("my deals", t._self_deals_where(me), owned | team),
                                   ("deals I own", t._self_deals_where(me, owned_only=True), owned),
                                   ("deals I'm part of", t._self_deals_where(me, team_only=True), team)]:
            g = ids(user, where)
            record(f"{who} {label:18} = {len(g):>3}", g == want and g <= visible,
                   "" if g == want else f"expected {len(want)}; extra={sorted(g - want)[:3]} missing={sorted(want - g)[:3]}")

        # the real template SQL runs and returns the same number of rows
        for q, want in [("show me all my deals", len(owned | team)), ("deals I own", len(owned)),
                        ("deals where I am part of the team", len(team))]:
            m = t.match(q)
            res = rb.run_scoped_sql(user, as_server(m.build(Person(uid, user.name))))
            record(f"{who} template {m.name:16} runs: {res.row_count} rows", res.row_count == min(want, guardrails.MAX_ROWS))
        n = rb.run_scoped_sql(user, as_server(t.match("how many deals do I have").build(Person(uid, user.name)))).rows[0][0]
        record(f"{who} how many deals do I have = {n}", n == len(owned | team))

        # asking about OTHER people never leaks a deal outside this persona's scope
        leaked = set()
        for other in rb.DEMO_PERSONAS:
            leaked |= ids(user, f'd."Owner_ID" = {t.lit(other)}') - visible
        sample = [t.lit(x) for x in everyone[:40]]
        leaked |= ids(user, f'd."Owner_ID" IN ({", ".join(sample)})') - visible
        record(f"{who} other people's deals / IN (...) stay in scope", not leaked, f"leaked={sorted(leaked)[:3]}" if leaked else "")


def test_lookup_user(admin):
    print("\n3. NAME-LOOKUP USER")
    lookup = rb.load_user(rb.LOOKUP_USER)
    record(f"RBAC_LOOKUP_USER={rb.LOOKUP_USER} is active", lookup is not None)
    if not lookup:
        return
    cur = admin.cursor()
    cur.execute('select distinct "Organization_ID" from users where "User_ID" = any(%s)', (rb.DEMO_PERSONAS,))
    orgs = {str(r[0]) for r in cur.fetchall()}
    record("lookup user is in the same organization as every persona", orgs == {lookup.organization_id},
           f"persona orgs={sorted(orgs)}, lookup org={lookup.organization_id}")
    info("names (users, contacts, deals, products) resolve across the lookup user's organization; "
         "the rows a question returns are still filtered per user")


def main():
    admin = admin_connect()
    cur = admin.cursor()
    cur.execute("select current_database()")
    db = cur.fetchone()[0]
    print(f"Connected to {db} (admin, for the independent checks)")
    if db == "closemore_next":
        sys.exit("Refusing to run on the shared database.")
    test_guard()
    test_personas(admin)
    test_lookup_user(admin)
    failed = [n for n, ok in RESULTS if not ok]
    print(f"\nSUMMARY: {len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAILED: {n}")


if __name__ == "__main__":
    main()
