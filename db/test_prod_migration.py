"""Tests prod_migration.sql / prod_rollback.sql against the real closemore_next schema (loaded locally, made-up data).

Checks:
  * the migration runs twice without error
  * every made-up user sees exactly what the Copilot rules allow (computed independently here)
  * forged / missing identity, app.bypass_rls and the main app's settings give the Copilot nothing extra
  * secrets, passwords, login tokens and billing are not readable; nothing is writable
  * the MAIN APP's view (its own login, its own settings) is identical before, after, and after rollback
  * the main app can still write rows the Copilot rules would not allow (no new triggers)
  * rollback removes everything, and the migration can be applied again
Usage (a TEST server only, never the shared one; roles are server-wide):
  1. createdb closemore_next_test, then load a schema-only dump of closemore_next into it
     (pg_dump --schema-only --no-owner; on PostgreSQL 16 remove the \restrict / transaction_timeout lines)
  2. create role closemore_user login password 'apppw'   (stands in for the main app's login)
  3. python test_prod_migration.py      (edit HOST / PORT at the top if needed)
"""
import hashlib
import hmac
import subprocess
import sys
import uuid

import psycopg2
from psycopg2 import errors

HOST, PORT, DB = "localhost", 5433, "closemore_next_test"
SUPER = dict(host=HOST, port=PORT, dbname=DB, user="postgres")
APP = dict(host=HOST, port=PORT, dbname=DB, user="closemore_user", password="apppw")
COPILOT = dict(host=HOST, port=PORT, dbname=DB, user="copilot_app", password="copilotpw")
A, B = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print("ok  ", name)
    else:
        fail += 1; print("FAIL", name, detail)


def psql(path):
    r = subprocess.run(["psql", "-h", HOST, "-p", str(PORT), "-U", "postgres", "-d", DB, "-q",
                        "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


# ------------------------------------------------------------------ made-up data (same shape as the CRM)
USERS = [  # id, first, last, role, status, region, org
    ("u-sys", "Sara", "Sys", "System_Admin", "Active", None, A),
    ("u-adm", "Adam", "Legacy", "Admin", "Active", None, A),
    ("u-sa-east", "Esha", "Admin", "Sales_Admin", "Active", "east ", A),
    ("u-exec", "Eli", "Exec", "Executive", "Active", None, A),
    ("u-exec-west", "Wen", "Exec", "Executive", "Active", "WEST", A),
    ("u-rep-east", "Ravi", "East", "Sales_Rep", "Active", "EAST", A),
    ("u-rep-west", "Rita", "West", "Sales_Rep", "Active", "West", A),
    ("u-rep-noreg", "Nina", "None", "Sales_Rep", "Active", None, A),
    ("u-inactive", "Ian", "Gone", "Sales_Rep", "Inactive", "East", A),
    ("u-b-sys", "Bob", "Other", "System_Admin", "Active", None, B),
    ("u-b-rep", "Bea", "Other", "Sales_Rep", "Active", "East", B),
]
DEALS = [  # id, name, region, owner, contact, org
    ("d1", "East deal", "East", "u-rep-east", "c1", A),
    ("d2", "West deal with east member", "West", "u-rep-west", "c2", A),
    ("d3", "lower-case east", "east", "u-sa-east", "c3", A),
    ("d4", "no region, east owner", None, "u-rep-east", "c1", A),
    ("d5", "no region, owner has none", None, "u-rep-noreg", "c4", A),
    ("d6", "East deal owned by west rep", "East", "u-rep-west", "c2", A),
    ("d7", "spaced EAST", " EAST ", "u-sys", "c5", A),
    ("xb1", "other company deal", "East", "u-b-rep", "cb1", B),
]
TEAM = [("d2", "u-rep-east", A), ("d1", "u-rep-west", A), ("d7", "u-rep-east", A)]
CONTACTS = [("c1", A, "u-rep-east"), ("c2", A, "u-rep-west"), ("c3", A, "u-sa-east"), ("c4", A, "u-rep-noreg"),
            ("c5", A, "u-sys"), ("c6", A, "u-sys"), ("cb1", B, "u-b-rep")]   # c6: linked to no deal


def seed():
    with psycopg2.connect(**SUPER) as c, c.cursor() as cur:
        cur.execute("set session_replication_role = replica")     # seed without firing app triggers
        for org, name in ((A, "Acme"), (B, "Beta")):
            cur.execute('insert into organizations ("Organization_ID","Name","Slug","Billing_Email") values (%s,%s,%s,%s)',
                        (org, name, name.lower(), f"billing@{name.lower()}.test"))
            cur.execute('insert into pipelines values (%s,%s,%s,%s)', (f"p-{name}", "Main", '["New","Won"]', org))
            cur.execute('insert into products ("Product_ID","Name","SKU_Code","Type","Unit_Price","Description","Organization_ID") '
                        'values (%s,%s,%s,%s,%s,%s,%s)', (f"pr-{name}", "Widget", f"SKU-{name}", "Goods", 10, "x", org))
            cur.execute('insert into organization_regions ("Organization_ID","Name") values (%s,%s)', (org, "East"))
        for uid, f, l, role, st, reg, org in USERS:
            cur.execute('insert into users ("User_ID","First_Name","Last_Name","Email","Role","Status","Password","Region",'
                        '"Organization_ID","Organization_Name") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (uid, f, l, f"{uid}@x.test", role, st, "hash-" + uid, reg, org, "Acme" if org == A else "Beta"))
        for cid, org, owner in CONTACTS:
            cur.execute('insert into contacts ("Contact_ID","First_Name","Last_Name","Email","Phone_Primary","Organization_Name",'
                        '"Contact_Type","Source","Created_Date","Owner_ID","Organization_ID") '
                        'values (%s,%s,%s,%s,%s,%s,%s,%s,current_date,%s,%s)',
                        (cid, "C", cid, f"{cid}@x.test", "1", "Cust", "Lead", "Web", owner, org))
        for did, name, reg, owner, contact, org in DEALS:
            cur.execute('insert into deals ("Deal_ID","Deal_Name","Associated_Contact_ID","Pipeline_ID","Current_Stage",'
                        '"Deal_Value","Expected_Close_Date","Probability_Percentage","Owner_ID","Status","Region","Organization_ID") '
                        'values (%s,%s,%s,%s,%s,%s,current_date,%s,%s,%s,%s,%s)',
                        (did, name, contact, "p-Acme" if org == A else "p-Beta", "New", 1000, 50, owner, "Open", reg, org))
            cur.execute('insert into deal_contacts values (%s,%s,true,%s)', (did, contact, org))
            cur.execute('insert into line_items values (%s,%s,%s,1,10,0,10,%s)',
                        ("li-" + did, did, "pr-Acme" if org == A else "pr-Beta", org))
        for did, uid, org in TEAM:
            cur.execute('insert into deal_team_members values (%s,%s,%s)', (did, uid, org))
        cur.execute('insert into auth_sessions ("User_ID","Token_Hash","Expires_At") values (%s,%s, now() + interval \'1 day\')',
                    ("u-rep-east", "secret-token-hash"))
        # the main app's login owns the tables, as on the server (FORCE ROW LEVEL SECURITY applies to it)
        cur.execute("select tablename from pg_tables where schemaname = 'public'")
        for (t,) in cur.fetchall():
            cur.execute(f'alter table public."{t}" owner to closemore_user')
        cur.execute("alter view public.tenants owner to closemore_user")


# ------------------------------------------------------------------ expected access, computed independently
def regions(text):
    return {x.strip().lower() for x in (text or "").split(",") if x.strip()}


U = {u[0]: dict(role=u[3], status=u[4], regions=regions(u[5]), org=u[6], first_region=(u[5] or "").split(",")[0].strip().lower())
     for u in USERS}


def deal_region(d):
    return (d[2] or "").strip().lower() or U[d[3]]["first_region"] or None


def expected_deals(uid):
    u = U[uid]
    if u["status"] != "Active":
        return set()
    out = set()
    for d in DEALS:
        if d[5] != u["org"]:
            continue
        r = deal_region(d)
        if u["role"] in ("System_Admin", "Admin"):
            out.add(d[0])
        elif u["role"] in ("Sales_Admin", "Executive"):
            if not u["regions"] or r in u["regions"]:
                out.add(d[0])
        elif u["role"] == "Sales_Rep":
            member = any(t[0] == d[0] and t[1] == uid for t in TEAM)
            if r in u["regions"] and (d[3] == uid or member):
                out.add(d[0])
    return out


def expected_contacts(uid):
    u = U[uid]
    if u["status"] != "Active":
        return set()
    if u["role"] in ("System_Admin", "Admin") or (u["role"] in ("Sales_Admin", "Executive") and not u["regions"]):
        return {c[0] for c in CONTACTS if c[1] == u["org"]}
    seen = expected_deals(uid)
    return {d[4] for d in DEALS if d[0] in seen}


# ------------------------------------------------------------------ helpers
def secret():
    with psycopg2.connect(**SUPER) as c, c.cursor() as cur:
        cur.execute("select secret from rbac.app_secret")
        return cur.fetchone()[0]


def copilot(uid=None, sig=None, extra=None):
    conn = psycopg2.connect(**COPILOT)
    conn.autocommit = True
    cur = conn.cursor()
    if uid is not None:
        cur.execute("set app.current_user_id = %s", (uid,))
        s = sig if sig is not None else hmac.new(SECRET.encode(), uid.encode(), hashlib.sha256).hexdigest()
        cur.execute("set app.current_user_sig = %s", (s,))
    for k, v in (extra or {}).items():
        cur.execute(f"set {k} = %s", (v,))
    return conn, cur


def ids(cur, sql):
    cur.execute(sql)
    return {r[0] for r in cur.fetchall()}


APP_VIEWS = [  # what the main app sees with its own settings
    {"app.current_organization_id": A, "app.current_user_tenant": "Acme", "app.current_user_role": "Sales_Rep",
     "app.current_user_id": "u-rep-east", "app.current_user_region": "East"},
    {"app.current_organization_id": A, "app.current_user_tenant": "Acme", "app.current_user_role": "Admin",
     "app.current_user_id": "u-adm", "app.current_user_region": ""},
    {"app.current_organization_id": B, "app.bypass_rls": "true"},
]
APP_TABLES = ["users", "deals", "contacts", "deal_contacts", "deal_team_members", "line_items", "pipelines",
              "products", "organizations", "organization_regions", "auth_sessions"]


def app_snapshot():
    snap = []
    with psycopg2.connect(**APP) as c, c.cursor() as cur:
        for view in APP_VIEWS:
            cur.execute("begin")
            for k, v in view.items():
                cur.execute("select set_config(%s, %s, true)", (k, v))
            for t in APP_TABLES:
                cur.execute(f'select count(*) from public."{t}"')
                snap.append((t, cur.fetchone()[0]))
            cur.execute("rollback")
    return snap


# ------------------------------------------------------------------ run
seed()
before = app_snapshot()
check("main app sees some rows before (sanity)", sum(n for _, n in before) > 0, before)

code, out = psql("prod_migration.sql")
check("migration runs", code == 0, out[-600:])
code, out = psql("prod_migration.sql")
check("migration runs a second time", code == 0, out[-600:])
with psycopg2.connect(**SUPER) as c, c.cursor() as cur:
    cur.execute("alter role copilot_app password 'copilotpw'")
SECRET = secret()

check("main app view unchanged after migration", app_snapshot() == before)

for uid in U:
    conn, cur = copilot(uid)
    got_d = ids(cur, 'select "Deal_ID" from deals')
    check(f"{uid}: deals", got_d == expected_deals(uid), f"got {sorted(got_d)} want {sorted(expected_deals(uid))}")
    got_c = ids(cur, 'select "Contact_ID" from contacts')
    check(f"{uid}: contacts", got_c == expected_contacts(uid), f"got {sorted(got_c)} want {sorted(expected_contacts(uid))}")
    for t in ("deal_team_members", "deal_contacts", "line_items"):
        got = ids(cur, f'select "Deal_ID" from {t}')
        check(f"{uid}: {t} follow deals", got <= expected_deals(uid), sorted(got - expected_deals(uid)))
    want_org = {u for u, v in U.items() if v["org"] == U[uid]["org"]} if U[uid]["status"] == "Active" else set()
    check(f"{uid}: users of own company only", ids(cur, 'select "User_ID" from users') == want_org)
    conn.close()

# attacks
conn, cur = copilot()
check("no identity: no deals", ids(cur, 'select "Deal_ID" from deals') == set())
check("no identity: no users", ids(cur, 'select "User_ID" from users') == set())
conn.close()
conn, cur = copilot("u-sys", sig="0" * 64)
check("forged signature: nothing", ids(cur, 'select "Deal_ID" from deals') == set())
conn.close()
conn, cur = copilot("u-rep-east", extra={"app.bypass_rls": "true", "app.current_user_role": "Admin",
                                          "app.current_organization_id": A, "app.current_user_tenant": "Acme",
                                          "app.current_user_region": ""})
check("bypass_rls + main-app settings give nothing extra", ids(cur, 'select "Deal_ID" from deals') == expected_deals("u-rep-east"))
cur.execute("select set_config('app.current_user_id', 'u-sys', false)")
check("changing the user id without the secret gives nothing", ids(cur, 'select "Deal_ID" from deals') == set())
conn.close()

conn, cur = copilot("u-sys")
for name, sql, err in [
    ("users.Password not readable", 'select "Password" from users', errors.InsufficientPrivilege),
    ("login tokens not readable", "select * from auth_sessions", errors.InsufficientPrivilege),
    ("billing not readable", 'select "Billing_Email" from organizations', errors.InsufficientPrivilege),
    ("invitations not readable", "select * from organization_invitations", errors.InsufficientPrivilege),
    ("secret not readable", "select * from rbac.app_secret", errors.InsufficientPrivilege),
    ("cannot sign users", "select rbac.sign_user('u-sys')", errors.InsufficientPrivilege),
    ("cannot write", "insert into deal_team_members values ('d1','u-sys','%s')" % A, errors.ReadOnlySqlTransaction),
    ("cannot create objects", "create table public.x (a int)", errors.ReadOnlySqlTransaction),
]:
    try:
        cur.execute(sql)
        check(name, False, "query succeeded")
    except err:
        check(name, True)
    except Exception as e:  # noqa: BLE001
        check(name, False, repr(e))
check("own company name readable", ids(cur, 'select "Name" from organizations') == {"Acme"})
conn.close()

# documents
doc = "doc-" + uuid.uuid4().hex[:8]
conn = psycopg2.connect(**COPILOT); conn.autocommit = False; cur = conn.cursor()
cur.execute("set transaction read write")
cur.execute("set local app.current_user_id = 'u-rep-east'")
cur.execute("set local app.current_user_sig = %s", (hmac.new(SECRET.encode(), b"u-rep-east", hashlib.sha256).hexdigest(),))
cur.execute("select rbac.doc_create(%s, 'a.pdf', 'east', 10, 'k')", (doc,))
conn.commit()
try:
    cur.execute("set transaction read write")
    cur.execute("set local app.current_user_id = 'u-rep-east'")
    cur.execute("set local app.current_user_sig = %s", (hmac.new(SECRET.encode(), b"u-rep-east", hashlib.sha256).hexdigest(),))
    cur.execute("select rbac.doc_create('doc-west', 'b.pdf', 'West', 10, 'k')")
    check("rep cannot upload into another region", False, "succeeded")
except errors.InsufficientPrivilege:
    check("rep cannot upload into another region", True)
conn.rollback(); conn.close()
for uid, want in (("u-rep-east", True), ("u-sa-east", True), ("u-rep-west", False), ("u-sys", True), ("u-b-sys", False)):
    conn, cur = copilot(uid)
    check(f"document visible to {uid}: {want}", (doc in ids(cur, 'select "Doc_ID" from copilot_documents')) == want)
    conn.close()

# the main app is not limited by the Copilot's rules (no new triggers)
with psycopg2.connect(**APP) as c, c.cursor() as cur:
    cur.execute("begin")
    cur.execute("select set_config('app.bypass_rls', 'true', true)")
    cur.execute("select set_config('app.current_organization_id', %s, true)", (A,))
    try:
        cur.execute("insert into deal_team_members values ('d2', 'u-rep-noreg', %s)", (A,))
        check("main app can still add any team member (no new trigger)", True)
    except Exception as e:  # noqa: BLE001
        check("main app can still add any team member (no new trigger)", False, repr(e))
    cur.execute("rollback")

code, out = psql("prod_rollback.sql")
check("rollback runs", code == 0, out[-600:])
code, out = psql("prod_rollback.sql")
check("rollback runs a second time", code == 0, out[-600:])
check("main app view unchanged after rollback", app_snapshot() == before)
with psycopg2.connect(**SUPER) as c, c.cursor() as cur:
    cur.execute("""select count(*) from pg_roles r where rolname like 'copilot%'
                    and (has_table_privilege(r.oid, 'public.deals', 'select')
                         or has_schema_privilege(r.oid, 'public', 'usage') and rolname = 'copilot_rules_owner')""")
    roles_left = cur.fetchone()[0]       # a role may survive only if another database uses it; it has nothing here
    cur.execute("select count(*) from pg_policies where policyname like 'copilot%'")
    pol_left = cur.fetchone()[0]
    cur.execute("select count(*) from pg_namespace where nspname = 'rbac'")
    schema_left = cur.fetchone()[0]
    cur.execute("select count(*) from pg_policies")
    policies = cur.fetchone()[0]
check("rollback removed roles, policies and schema", (roles_left, pol_left, schema_left) == (0, 0, 0),
      (roles_left, pol_left, schema_left))
check("the main app's 37 policies are all still there", policies == 37, policies)
code, out = psql("prod_migration.sql")
check("migration can be applied again after rollback", code == 0, out[-600:])

print(f"\n{ok}/{ok + fail} passed")
sys.exit(1 if fail else 0)
