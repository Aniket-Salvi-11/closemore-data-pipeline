"""
build_schema.py -- builds a fresh schema.json straight from your PostgreSQL database.

Run (from the folder with db_connection.py and .env):
    python build_schema.py              # writes schema_new.json and prints what changed vs schema.json
    python build_schema.py --apply      # same, then backs up schema.json -> schema_old.json and replaces it

Options:  --out FILE   --no-values   --no-relations

What it does
  1. Reads every table/column/type the database user can see (information_schema, schema "public").
  2. Leaves out sensitive tables and columns (lists at the top of this file -- edit them freely).
  3. Adds, per table, short hints for the model:
       "relationships": ["Owner_ID -> users.User_ID", ...]   real foreign keys + the known list below
       "values": {"Status": ["Open", "Won", ...]}            real stored values of small category columns
  4. Writes the same JSON layout the server already reads, so server.py needs NO change.
The connection is read-only. Restart the backend after replacing schema.json (it is read at startup).
"""

import argparse
import json
import os
import re
import sys

from db_connection import get_connection

SCHEMA_NAME = "public"

# ---- left out of the model's schema (matched case-insensitively) ----
EXCLUDED_TABLES = {
    "schema_migrations", "auth_sessions", "deal_rag_history", "organizations", "tenants", "organization_regions",
}
EXCLUDED_TABLE_PATTERNS = [r"billing", r"subscription", r"session", r"tenant", r"organization", r"invitation",
                           r"password", r"credential", r"token"]
EXCLUDED_COLUMN_PATTERNS = [r"password", r"passwd", r"secret", r"token", r"api[_ ]?key", r"private[_ ]?key",
                            r"avatar_data_url"]       # avatar columns hold huge base64 images

# ---- relationships assumed from column names -- each is checked against the real columns; review the printout ----
KNOWN_RELATIONSHIPS = {
    "deals": [("Owner_ID", "users", "User_ID"), ("Associated_Contact_ID", "contacts", "Contact_ID"),
              ("Pipeline_ID", "pipelines", "Pipeline_ID")],
    "contacts": [("Owner_ID", "users", "User_ID")],
    "line_items": [("Deal_ID", "deals", "Deal_ID"), ("Product_ID", "products", "Product_ID")],
    "deal_contacts": [("Deal_ID", "deals", "Deal_ID"), ("Contact_ID", "contacts", "Contact_ID")],
    "deal_team_members": [("Deal_ID", "deals", "Deal_ID"), ("User_ID", "users", "User_ID")],
    "deal_attachments": [("Deal_ID", "deals", "Deal_ID")],
    "activities": [("Logged_By_User_ID", "users", "User_ID")],
    "activity_attachments": [("Log_ID", "activities", "Log_ID")],
    "tasks": [("Assigned_To", "users", "User_ID"), ("Assigned_By", "users", "User_ID")],
    "task_comments": [("Task_ID", "tasks", "Task_ID"), ("User_ID", "users", "User_ID")],
    "task_attachments": [("Task_ID", "tasks", "Task_ID")],
    "task_notifications": [("Task_ID", "tasks", "Task_ID"), ("User_ID", "users", "User_ID")],
    "comment_reactions": [("Comment_ID", "task_comments", "Comment_ID"), ("User_ID", "users", "User_ID")],
    "user_alert_states": [("User_ID", "users", "User_ID")],
}

# ---- small category columns whose real values are shown to the model (only if few distinct values) ----
VALUE_COLUMNS = {
    "deals": ["Status", "Current_Stage", "Deal_Type", "Sale_Type", "Region", "Deal_Source"],
    "users": ["Role", "Status"],
    "tasks": ["Status"],
    "contacts": ["Contact_Type", "Source"],
    "activities": ["Activity_Type"],
    "deal_types": ["Label"],
    "products": ["Type"],
}
MAX_DISTINCT = 20
MAX_VALUE_LEN = 40

COLUMNS_SQL = f"""
SELECT c.table_name, c.column_name, c.data_type
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = '{SCHEMA_NAME}' AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position
"""
FK_SQL = f"""
SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '{SCHEMA_NAME}'
"""


def _matches(name, patterns):
    return any(re.search(p, name, re.I) for p in patterns)


def _q(ident):
    return '"' + ident.replace('"', '""') + '"'      # identifiers come from the database itself


def table_excluded(name):
    return name.lower() in EXCLUDED_TABLES or _matches(name, EXCLUDED_TABLE_PATTERNS)


def read_schema(cur):
    cur.execute(COLUMNS_SQL)
    schema, skipped_tables, skipped_cols = {}, set(), []
    for table, col, dtype in cur.fetchall():
        if table_excluded(table):
            skipped_tables.add(table)
            continue
        if _matches(col, EXCLUDED_COLUMN_PATTERNS):
            skipped_cols.append(f"{table}.{col}")
            continue
        schema.setdefault(table, {"columns": {}})["columns"][col] = dtype
    return dict(sorted(schema.items())), sorted(skipped_tables), skipped_cols


def read_relationships(cur, schema):
    found = {}
    try:
        cur.execute(FK_SQL)
        for table, col, rtable, rcol in cur.fetchall():
            # keep only foreign keys where both tables and both columns are in the schema being built
            # (tables left out above, e.g. organization_regions, are skipped)
            if (table in schema and rtable in schema
                    and col in schema[table]["columns"] and rcol in schema[rtable]["columns"]):
                found.setdefault(table, []).append((col, rtable, rcol, "foreign key"))
    except Exception as e:
        print(f"  (could not read foreign keys: {str(e).strip().splitlines()[0]})")
    for table, rels in KNOWN_RELATIONSHIPS.items():
        for col, rtable, rcol in rels:
            if (rtable in schema and rcol in schema[rtable]["columns"]
                    and table in schema and col in schema[table]["columns"]):
                if not any(r[:3] == (col, rtable, rcol) for r in found.get(table, [])):
                    found.setdefault(table, []).append((col, rtable, rcol, "assumed from names"))
    return found


def read_values(cur, schema):
    out = {}
    for table, cols in VALUE_COLUMNS.items():
        for col in cols:
            if table not in schema or col not in schema[table]["columns"]:
                continue
            try:
                cur.execute(f"SELECT DISTINCT {_q(col)} FROM {_q(table)} WHERE {_q(col)} IS NOT NULL "
                            f"ORDER BY 1 LIMIT {MAX_DISTINCT + 1}")
                vals = [str(r[0]) for r in cur.fetchall()]
            except Exception as e:
                print(f"  (skipped values of {table}.{col}: {str(e).strip().splitlines()[0]})")
                cur.connection.rollback()
                continue
            if 0 < len(vals) <= MAX_DISTINCT and all(len(v) <= MAX_VALUE_LEN for v in vals):
                out.setdefault(table, {})[col] = vals
    return out


def diff_report(old, new):
    lines = []
    old_t, new_t = set(old), set(new)
    for t in sorted(new_t - old_t):
        lines.append(f"  + new table: {t} ({len(new[t]['columns'])} columns)")
    for t in sorted(old_t - new_t):
        lines.append(f"  - table no longer included: {t}")
    for t in sorted(old_t & new_t):
        oc, nc = old[t].get("columns", {}), new[t]["columns"]
        for c in nc.keys() - oc.keys():
            lines.append(f"  + {t}.{c} ({nc[c]})")
        for c in oc.keys() - nc.keys():
            lines.append(f"  - {t}.{c}")
        for c in nc.keys() & oc.keys():
            if nc[c] != oc[c]:
                lines.append(f"  ~ {t}.{c}: {oc[c]} -> {nc[c]}")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="schema_new.json")
    ap.add_argument("--apply", action="store_true", help="back up schema.json to schema_old.json and replace it")
    ap.add_argument("--no-values", action="store_true")
    ap.add_argument("--no-relations", action="store_true")
    args = ap.parse_args()

    conn = get_connection()
    try:
        conn.autocommit = True
        with conn.cursor() as c:
            c.execute("SET statement_timeout = 15000")
        conn.autocommit = False
        conn.set_session(readonly=True)
        cur = conn.cursor()

        print("Reading tables and columns...")
        schema, skipped_tables, skipped_cols = read_schema(cur)

        rel_notes = []
        if not args.no_relations:
            print("Reading relationships...")
            for table, rels in read_relationships(cur, schema).items():
                schema[table]["relationships"] = [f"{c} -> {rt}.{rc}" for c, rt, rc, _ in rels]
                rel_notes += [f"  {table}.{c} -> {rt}.{rc}   [{src}]" for c, rt, rc, src in rels]
        if not args.no_values:
            print("Reading values of category columns...")
            for table, vals in read_values(cur, schema).items():
                schema[table]["values"] = vals
        cur.close()
    finally:
        conn.close()

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)

    text = json.dumps(schema, indent=2, ensure_ascii=False)
    print(f"\nWrote {args.out}: {len(schema)} tables, {sum(len(t['columns']) for t in schema.values())} columns")
    print(f"Left out tables ({len(skipped_tables)}): {', '.join(skipped_tables) or '-'}")
    print(f"Left out columns ({len(skipped_cols)}): {', '.join(skipped_cols) or '-'}")
    if rel_notes:
        print(f"\nRelationships included ({len(rel_notes)}) -- 'assumed from names' ones are worth a quick check:")
        print("\n".join(rel_notes))

    old = None
    if os.path.isfile("schema.json"):
        try:
            old = json.load(open("schema.json", encoding="utf-8"))
        except Exception:
            old = None
    if old is not None:
        changes = diff_report(old, schema)
        print(f"\nDifferences vs the current schema.json ({len(changes)}):")
        print("\n".join(changes) if changes else "  none -- the current file already matches the database")

    approx_tokens = int(len(text) / 3.2)
    print(f"\nSize: about {len(text)} characters (~{approx_tokens} tokens in every SQL prompt)")
    if len(text) > 9500:
        print("  WARNING: large. The model servers have a 4096-token context; consider --no-values or fewer tables.")

    if args.apply:
        if os.path.isfile("schema.json"):
            os.replace("schema.json", "schema_old.json")
            print("Backed up schema.json -> schema_old.json")
        os.replace(args.out, "schema.json")
        print("Replaced schema.json. Restart the backend (uvicorn) to use it.")
    else:
        print(f"\nTo use it: rename schema.json to schema_old.json, rename {args.out} to schema.json, restart uvicorn "
              f"(or just run:  python build_schema.py --apply)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Failed: {e}")
        sys.exit(1)