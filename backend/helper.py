"""
helper.py
=========
Reusable SQL post-processing functions, extracted from test_arctic.py.

Import in test_arctic.py with:
    from helper import clean_sql, fix_sql_dialect, auto_quote_identifiers

NOTE: fix_sql_dialect here uses a DYNAMIC month-offset pattern (handles
'+1 month', '+2 month', '+N month' — any number) rather than a single
hardcoded '+1 month' pattern. This is the version that was validated against
the live database and produced the 100% execution result — see
results/arctic_results_sample_run.csv.
"""

import re


# ============================================================
# CLEAN SQL
# ============================================================

def clean_sql(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m:
        text = m.group(1)
    m = re.search(r"\bSELECT\b[\s\S]*", text, re.IGNORECASE)
    # A query that starts with a CTE ("WITH x AS (SELECT ...) SELECT ...") must keep its WITH part:
    # cutting at the first SELECT would leave "SELECT ...) SELECT ...", which can never run.
    w = _CTE_START.search(text)
    if w and (m is None or w.start() < m.start()):
        m = re.compile(r"[\s\S]*").match(text, w.start())
    return (m.group(0) if m else text).strip().rstrip(";") + ";"


_CTE_START = re.compile(r'\bWITH\s+(?:RECURSIVE\s+)?(?:"[^"]+"|\w+)\s*(?:\([^()]*\)\s*)?AS\s*(?:NOT\s+)?(?:MATERIALIZED\s+)?\(',
                        re.IGNORECASE)


# ============================================================
# DIALECT FIXER
# ============================================================

def _fix_date_offset(match: re.Match) -> str:
    """Converts DATE(CURRENT_DATE/'now', '+N month', 'start of month') -> Postgres, for ANY N."""
    n = match.group(1)
    if n is None or int(n) == 0:
        return "DATE_TRUNC('month', CURRENT_DATE)"
    return f"DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '{n} month'"


_DIALECT_FIXES = [
    (r"GROUP_CONCAT\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)", r"STRING_AGG(\1, \2)"),
    (r"GROUP_CONCAT\s*\(\s*([^,()]+?)\s*\)", r"STRING_AGG(\1, ', ')"),
    (r"\bIFNULL\s*\(", "COALESCE("),
    (r"`([^`]+)`", r'"\1"'),
    (r"\bLIMIT\s+(\d+)\s*,\s*(\d+)", r"LIMIT \2 OFFSET \1"),
]

# Dynamic patterns — catch ANY month offset (+1, +2, +12, ...), not one hardcoded number
_DATE_OFFSET_PATTERNS = [
    re.compile(
        r"DATE\s*\(\s*(?:CURRENT_DATE|'now')\s*,\s*'\+(\d+)\s*month'\s*,\s*'start of month'\s*\)",
        re.IGNORECASE
    ),
    re.compile(
        r"DATE\s*\(\s*(?:CURRENT_DATE|'now')\s*,\s*'start of month'\s*,\s*'\+(\d+)\s*month'\s*\)",
        re.IGNORECASE
    ),
]

_DATE_SIMPLE_FIXES = [
    (r"DATE\s*\(\s*(?:CURRENT_DATE|'now')\s*,\s*'start of month'\s*\)",
     "DATE_TRUNC('month', CURRENT_DATE)"),
    (r"DATE\s*\(\s*'now'\s*\)", "CURRENT_DATE"),
]


def fix_sql_dialect(sql: str) -> str:
    """Deterministically rewrites known MySQL/SQLite patterns into PostgreSQL equivalents."""
    fixed = sql

    for pattern, replacement in _DIALECT_FIXES:
        fixed = re.sub(pattern, replacement, fixed, flags=re.IGNORECASE)

    for pattern in _DATE_OFFSET_PATTERNS:
        fixed = pattern.sub(_fix_date_offset, fixed)

    for pattern, replacement in _DATE_SIMPLE_FIXES:
        fixed = re.sub(pattern, replacement, fixed, flags=re.IGNORECASE)

    return fixed


# ============================================================
# AUTO-QUOTE IDENTIFIERS
# ============================================================

def auto_quote_identifiers(sql: str, schema_dict: dict) -> str:
    """
    Quotes only identifiers belonging to tables actually used in the SQL.
    Already double-quoted identifiers are preserved. Text inside single-quoted
    string literals is never modified.
    """
    table_pattern = re.compile(
        r'\b(?:FROM|JOIN)\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))',
        re.IGNORECASE
    )
    used_tables = set()
    for match in table_pattern.finditer(sql):
        table_name = match.group(1) or match.group(2)
        if not table_name:
            continue
        for schema_table in schema_dict.keys():
            if schema_table.lower() == table_name.lower():
                used_tables.add(schema_table)
                break

    identifiers = set()
    for table_name in used_tables:
        identifiers.add(table_name)
        table_info = schema_dict.get(table_name, {})
        if not isinstance(table_info, dict):
            continue
        columns = table_info.get("columns", {})
        if isinstance(columns, dict):
            identifiers.update(columns.keys())

    if not identifiers:
        return sql

    identifiers = sorted(identifiers, key=len, reverse=True)
    parts = re.split(r"('(?:[^']|'')*')", sql)

    for name in identifiers:
        pattern = re.compile(rf'(?<!["\w]){re.escape(name)}(?!["\w])', re.IGNORECASE)
        for i in range(0, len(parts), 2):
            parts[i] = pattern.sub(lambda m: f'"{name}"', parts[i])

    return "".join(parts)


# ============================================================
# SELF-TEST — run `python helper.py` directly to verify all functions
# ============================================================

if __name__ == "__main__":
    test_schema = {
        "deals": {
            "columns": {
                "Deal_ID": "integer",
                "Deal_Name": "text",
                "Owner_ID": "integer",
                "Expected_Close_Date": "text",
            }
        },
    }

    tests = [
        ("clean_sql strips fences",
         clean_sql("```sql\nSELECT 1;\n```"), "SELECT 1;"),
        ("fix_sql_dialect: +1 month",
         fix_sql_dialect("DATE(CURRENT_DATE, '+1 month', 'start of month')"),
         "DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'"),
        ("fix_sql_dialect: +2 month (dynamic — not hardcoded)",
         fix_sql_dialect("DATE(CURRENT_DATE, '+2 month', 'start of month')"),
         "DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 month'"),
        ("auto_quote_identifiers",
         auto_quote_identifiers("SELECT Deal_Name FROM deals", test_schema),
         'SELECT "Deal_Name" FROM "deals"'),
    ]

    all_passed = True
    for label, result, expected in tests:
        ok = expected in result
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_passed = False
        print(f"[{status}] {label}")
        if not ok:
            print(f"       expected to contain: {expected}")
            print(f"       got:                 {result}")

    print("\nAll tests passed." if all_passed else "\nSOME TESTS FAILED.")