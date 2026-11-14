"""
Build a PRIVATE, MASKED demo copy of the CRM database.

Source (read only use): POSTGRES_* variables in your .env
Target (new database) : DEMO_POSTGRES_* variables (defaults: localhost:5432,
                        db closemore_demo, user postgres). The target user must
                        be a superuser (needed to load data with triggers off).

What it does
  1. Refuses to run if target == source
  2. Creates the target database (if missing)
  3. Copies the FULL schema (tables, FKs, functions, RLS policies)
  4. Copies DATA only for the tables the demo needs
  5. Masks passwords, emails, phones, addresses, contact names
  6. Creates role copilot_ro (no superuser, no BYPASSRLS, SELECT only,
     users.Password not readable) for running the LLM's SQL
  7. Prints row counts

It only READS from the source database.

Usage:  python make_demo_copy.py
"""
import os
import shutil
import subprocess
import sys

import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv

load_dotenv()

DATA_TABLES = [
    "organizations", "users", "pipelines", "deal_types", "products",
    "contacts", "deals", "deal_contacts", "deal_team_members",
    "line_items", "organization_regions",
]
HIDDEN_USER_COLUMNS = {"Password", "Avatar_Data_URL"}

SRC = dict(
    host=os.getenv("POSTGRES_HOST"),
    port=str(os.getenv("POSTGRES_PORT")),
    dbname=os.getenv("POSTGRES_DB"),
    user=os.getenv("POSTGRES_USER"),
    password=os.getenv("POSTGRES_PASSWORD"),
)
DST = dict(
    host=os.getenv("DEMO_POSTGRES_HOST", "localhost"),
    port=str(os.getenv("DEMO_POSTGRES_PORT", "5432")),
    dbname=os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
    user=os.getenv("DEMO_POSTGRES_USER", "postgres"),
    password=os.getenv("DEMO_POSTGRES_PASSWORD", ""),
)

MASK_SQL = [
    'UPDATE users SET "Password" = NULL, "Avatar_Data_URL" = NULL, '
    '"Email" = \'user_\' || "User_ID" || \'@demo.local\', '
    '"Phone_Number" = NULL, "Mobile_Number" = NULL, '
    '"Residential_Address" = NULL, "Office_Address" = NULL',
    'UPDATE contacts SET "First_Name" = \'Contact\', '
    '"Last_Name" = right("Contact_ID", 6), '
    '"Email" = \'contact_\' || "Contact_ID" || \'@demo.local\', '
    '"Phone_Primary" = \'0000000000\'',
    'UPDATE organizations SET "Billing_Email" = \'billing@demo.local\'',
]


def tool(name):
    exe = shutil.which(name)
    if not exe:
        sys.exit(f"{name} not found on PATH. Install PostgreSQL client tools.")
    return exe


def env_for(conf):
    env = os.environ.copy()
    env["PGPASSWORD"] = conf["password"] or ""
    env["PGSSLMODE"] = os.getenv("POSTGRES_SSLMODE", "disable") if conf is SRC else "prefer"
    return env


def conn_args(conf):
    return ["-h", conf["host"], "-p", conf["port"], "-U", conf["user"]]


def run(cmd, env, label):
    res = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"FAILED: {label}")
        print(res.stderr.strip()[:1500])
        sys.exit(1)
    print(f"ok: {label}")
    return res


def dump_to_file(extra, path, label):
    cmd = [tool("pg_dump"), *conn_args(SRC), "-d", SRC["dbname"],
           "--no-owner", "--no-privileges", *extra, "-f", path]
    run(cmd, env_for(SRC), label)


def load_file(path, label):
    cmd = [tool("psql"), *conn_args(DST), "-d", DST["dbname"],
           "-v", "ON_ERROR_STOP=1", "-q", "-f", path]
    run(cmd, env_for(DST), label)


def create_target_db():
    conn = psycopg2.connect(host=DST["host"], port=DST["port"], dbname="postgres",
                            user=DST["user"], password=DST["password"])
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("select 1 from pg_database where datname = %s", (DST["dbname"],))
    if cur.fetchone():
        sys.exit(f"Database {DST['dbname']} already exists on target. "
                 "Drop it or set DEMO_POSTGRES_DB to a new name.")
    cur.execute(sql.SQL("create database {}").format(sql.Identifier(DST["dbname"])))
    conn.close()
    print(f"ok: created database {DST['dbname']}")


def post_load():
    conn = psycopg2.connect(host=DST["host"], port=DST["port"], dbname=DST["dbname"],
                            user=DST["user"], password=DST["password"])
    conn.autocommit = True
    cur = conn.cursor()

    for stmt in MASK_SQL:
        cur.execute(stmt)
    print("ok: masked passwords, emails, phones, addresses, contact names")

    cur.execute("select 1 from pg_roles where rolname = 'copilot_ro'")
    if not cur.fetchone():
        cur.execute("create role copilot_ro nologin nosuperuser nobypassrls")
    cur.execute("grant usage on schema public to copilot_ro")
    for t in DATA_TABLES:
        if t == "users":
            continue
        cur.execute(sql.SQL("grant select on public.{} to copilot_ro").format(sql.Identifier(t)))
    cur.execute(
        "select column_name from information_schema.columns "
        "where table_schema = 'public' and table_name = 'users'"
    )
    cols = [c for (c,) in cur.fetchall() if c not in HIDDEN_USER_COLUMNS]
    cur.execute(
        sql.SQL("grant select ({}) on public.users to copilot_ro").format(
            sql.SQL(", ").join(sql.Identifier(c) for c in cols)
        )
    )
    print("ok: role copilot_ro created (SELECT only, users.Password hidden)")

    print("\nRow counts in the demo copy:")
    for t in DATA_TABLES:
        cur.execute(sql.SQL("select count(*) from public.{}").format(sql.Identifier(t)))
        print(f"  {t:25} {cur.fetchone()[0]}")
    conn.close()


def main():
    same = (SRC["host"], SRC["port"], SRC["dbname"]) == (DST["host"], DST["port"], DST["dbname"])
    if same:
        sys.exit("Target equals source. Refusing to continue.")
    print(f"Source: {SRC['host']}:{SRC['port']}/{SRC['dbname']}  (read only)")
    print(f"Target: {DST['host']}:{DST['port']}/{DST['dbname']}  (new)\n")

    create_target_db()
    dump_to_file(["--schema-only"], "demo_schema.sql", "dump full schema")
    load_file("demo_schema.sql", "load schema into demo database")

    data_flags = ["--data-only", "--disable-triggers"]
    for t in DATA_TABLES:
        data_flags += ["-t", f"public.{t}"]
    dump_to_file(data_flags, "demo_data.sql", "dump data for demo tables")
    load_file("demo_data.sql", "load data into demo database")

    post_load()
    print("\nDone. Demo copy is ready. demo_data.sql holds UNMASKED data: delete it now.")


if __name__ == "__main__":
    main()

