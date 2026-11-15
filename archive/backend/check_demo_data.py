"""
Demo data readiness check (READ-ONLY).

Answers: does the CRM data already contain what we need to demo
admin / sales admin / sales rep behaviour with region and deal-team rules?

Prints roles, regions, deals per region, owner/region mismatches, deal team
members and a PASS / MISSING checklist. Only IDs, roles, regions and counts
are printed - no names, emails or phone numbers.

Point it at the source database (POSTGRES_* in .env) or at the demo copy by
setting DEMO=1 (uses DEMO_POSTGRES_* variables).

Usage:  python check_demo_data.py
"""
import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

SPLIT = "regexp_split_to_array(coalesce({col}, ''), '\\s*,\\s*')"
REPORT = []


def out(line=""):
    print(line)
    REPORT.append(line)


def get_connection():
    if os.getenv("DEMO") == "1":
        return psycopg2.connect(
            host=os.getenv("DEMO_POSTGRES_HOST", "localhost"),
            port=int(os.getenv("DEMO_POSTGRES_PORT", "5432")),
            dbname=os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
            user=os.getenv("DEMO_POSTGRES_USER", "postgres"),
            password=os.getenv("DEMO_POSTGRES_PASSWORD", ""),
        )
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        port=int(os.getenv("POSTGRES_PORT")),
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
        sslmode=os.getenv("POSTGRES_SSLMODE", "disable"),
    )


def rows(cur, query):
    cur.execute(query)
    return cur.fetchall()


def table(title, header, data, limit=40):
    out()
    out(title)
    out("-" * len(title))
    if not data:
        out("  (none)")
        return
    out("  " + " | ".join(header))
    for r in data[:limit]:
        out("  " + " | ".join("" if v is None else str(v) for v in r))
    if len(data) > limit:
        out(f"  ... {len(data) - limit} more rows")


def one(cur, query):
    cur.execute(query)
    return cur.fetchone()[0]


def main():
    conn = get_connection()
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    user_regions = SPLIT.format(col='u."Region"')
    deal_region_ok = f'd."Region" = ANY({user_regions})'

    out("DEMO DATA CHECK")
    out(f"Database: {one(cur, 'select current_database()')}  as {one(cur, 'select current_user')}")

    table("Organizations (users per organization)",
          ["organization_id", "users"],
          rows(cur, 'select "Organization_ID", count(*) from users group by 1 order by 2 desc'))

    table("Users by role and status", ["role", "status", "count"],
          rows(cur, 'select "Role", "Status", count(*) from users group by 1, 2 order by 1, 2'))

    table("Users by role: how many have a region set",
          ["role", "total", "with_region", "without_region"],
          rows(cur, """
              select "Role", count(*),
                     count(*) filter (where coalesce("Region",'') <> ''),
                     count(*) filter (where coalesce("Region",'') = '')
              from users group by 1 order by 1"""))

    table("Distinct user Region values (shows list format)",
          ["Region", "users"],
          rows(cur, 'select "Region", count(*) from users group by 1 order by 2 desc'))

    table("Deals per Region", ["Region", "deals"],
          rows(cur, 'select coalesce(nullif("Region",\'\'), \'(empty)\'), count(*) '
                    'from deals group by 1 order by 2 desc'))

    table("Deals per owner (top 15)", ["owner_id", "role", "owner_region", "deals"],
          rows(cur, """
              select d."Owner_ID", u."Role", u."Region", count(*)
              from deals d left join users u on u."User_ID" = d."Owner_ID"
              group by 1, 2, 3 order by 4 desc limit 15"""))

    mismatch = rows(cur, f"""
        select d."Deal_ID", d."Region", u."User_ID", u."Role", u."Region"
        from deals d join users u on u."User_ID" = d."Owner_ID"
        where coalesce(d."Region",'') <> ''
          and not ({deal_region_ok})""")
    table("Deals whose owner does NOT have the deal's region (hidden from owner under team rule)",
          ["deal_id", "deal_region", "owner_id", "owner_role", "owner_region"], mismatch)

    table("Deal team members", ["metric", "value"], [
        ("rows", one(cur, "select count(*) from deal_team_members")),
        ("deals with a team", one(cur, 'select count(distinct "Deal_ID") from deal_team_members')),
        ("members who are not the deal owner", one(cur, """
            select count(*) from deal_team_members t join deals d on d."Deal_ID" = t."Deal_ID"
            where t."User_ID" <> d."Owner_ID" """)),
    ])

    bad_team = rows(cur, f"""
        select t."Deal_ID", d."Region", t."User_ID", u."Role", u."Region"
        from deal_team_members t
        join deals d on d."Deal_ID" = t."Deal_ID"
        join users u on u."User_ID" = t."User_ID"
        where t."User_ID" <> d."Owner_ID" and not ({deal_region_ok})""")
    table("Team members who do NOT have the deal's region (break the team rule)",
          ["deal_id", "deal_region", "member_id", "member_role", "member_region"], bad_team)

    region_reps = rows(cur, f"""
        select r, count(*) from (
          select unnest({user_regions}) r from users u where u."Role" = 'Sales_Rep'
        ) x where r <> '' group by 1 order by 2 desc""")
    table("Sales reps per region", ["region", "reps"], region_reps)

    # ---- checklist ----
    n = lambda q: one(cur, q)
    checks = [
        ("an Admin user exists",
         n('select count(*) from users where "Role" = \'Admin\'') > 0),
        ("a Sales_Admin WITH region(s) exists",
         n('select count(*) from users where "Role" = \'Sales_Admin\' and coalesce("Region",\'\') <> \'\'') > 0),
        ("a Sales_Admin WITHOUT region exists (sees all)",
         n('select count(*) from users where "Role" = \'Sales_Admin\' and coalesce("Region",\'\') = \'\'') > 0),
        ("a region with 2+ sales reps exists",
         any(c >= 2 for _, c in region_reps)),
        ("reps exist in 2+ different regions",
         len(region_reps) >= 2),
        ("a rep with 2+ regions in profile exists",
         n("""select count(*) from users where "Role" = 'Sales_Rep'
              and cardinality(regexp_split_to_array(coalesce("Region",''), '\\s*,\\s*')) >= 2
              and "Region" like '%,%'""") > 0),
        ("every region has at least one deal",
         all(n(f"select count(*) from deals where \"Region\" = '{r}'") > 0 for r, _ in region_reps)
         if region_reps else False),
        ("a deal owned by a rep exists in the rep's own region",
         n(f"""select count(*) from deals d join users u on u."User_ID" = d."Owner_ID"
               where u."Role" = 'Sales_Rep' and {deal_region_ok}""") > 0),
        ("a deal whose owner lacks the deal's region exists (owner-hidden case)",
         len(mismatch) > 0),
        ("a deal team member who is not the owner exists (team case)",
         n("""select count(*) from deal_team_members t join deals d on d."Deal_ID" = t."Deal_ID"
              where t."User_ID" <> d."Owner_ID" """) > 0),
        ("no team member breaks the same-region rule",
         len(bad_team) == 0),
        ("no deals have an empty region",
         n('select count(*) from deals where coalesce("Region",\'\') = \'\'') == 0),
    ]
    out()
    out("CHECKLIST")
    out("---------")
    for label, ok in checks:
        out(f"  [{'PASS' if ok else 'MISSING'}] {label}")
    out()
    out("MISSING items are what we will seed in the private demo copy.")

    conn.close()
    with open("demo_data_report.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(REPORT))
    print("\nReport saved to demo_data_report.txt (IDs, roles, regions, counts only).")


if __name__ == "__main__":
    main()
