"""
schema_check.py -- fast, model-free checks of a generated SQL query against schema.json.

Catches the mistakes the 8B model makes most often, BEFORE the database is touched:
  - a table that is not in the schema           (e.g. "regions", "sale_types")
  - an alias used but never defined             (e.g. u."First_Name" with no "users" u)
  - a table referenced by name after it was aliased
  - a column that does not exist in its table   (e.g. deals.Owner_First_Name)
  - a numeric column cast to a date             (e.g. "Deal_Value"::date)
  - a placeholder filter value                  (e.g. ILIKE '%value%') that the question never asked for

check_schema(sql, schema_dict) -> list of short problem descriptions (empty list = OK).
Unqualified column names are not checked here; PostgreSQL's own EXPLAIN is the backstop.
"""

from guardrails import tokenize

_CLAUSE_WORDS = {
    "where", "group", "order", "limit", "offset", "having", "union", "intersect", "except", "join", "inner",
    "left", "right", "full", "cross", "natural", "on", "using", "window", "fetch", "for", "returning",
    "lateral", "only", "select", "with",
}
_FROM_FUNCS = {"extract", "substring", "trim", "overlay", "position"}
_NUMERIC_TYPES = {"double precision", "integer", "bigint", "smallint", "real", "numeric", "boolean"}
_DATE_TYPES = {"date", "timestamp", "timestamptz", "time", "interval"}
MAX_ISSUES = 6
_PLACEHOLDERS = {"value", "values", "your_value", "your value", "placeholder", "example", "string", "text",
                 "keyword", "search_term", "search term", "<value>", "xxx"}


def _matching(tokens, j):
    d = 0
    for k in range(j, len(tokens)):
        if tokens[k][:2] == ("op", "("):
            d += 1
        elif tokens[k][:2] == ("op", ")"):
            d -= 1
            if d == 0:
                return k
    return len(tokens) - 1


def _parse_from_list(tokens, j, refs, allow_commas):
    n = len(tokens)
    while True:
        while j < n and tokens[j][0] == "word" and tokens[j][1] in ("only", "lateral"):
            j += 1
        if j >= n:
            return j
        kind, val, _ = tokens[j]
        table, derived = None, False
        if kind == "op" and val == "(":
            m = _matching(tokens, j)
            _collect_refs(tokens[j + 1:m], refs)
            j, derived = m + 1, True
        elif kind in ("word", "qident"):
            name = val.lower()
            j += 1
            while j + 1 < n and tokens[j][:2] == ("op", ".") and tokens[j + 1][0] in ("word", "qident"):
                name = tokens[j + 1][1].lower()
                j += 2
            if j < n and tokens[j][:2] == ("op", "("):          # table-valued function
                m = _matching(tokens, j)
                _collect_refs(tokens[j + 1:m], refs)
                j, derived = m + 1, True
            else:
                table = name
        else:
            return j
        alias = None
        if j < n and tokens[j][:2] == ("word", "as"):
            j += 1
        if j < n and tokens[j][0] in ("word", "qident") and not (tokens[j][0] == "word" and tokens[j][1] in _CLAUSE_WORDS):
            alias = tokens[j][1].lower()
            j += 1
            if j < n and tokens[j][:2] == ("op", "("):
                j = _matching(tokens, j) + 1
        refs.append(("derived" if derived else "table", table, alias))
        if allow_commas and j < n and tokens[j][:2] == ("op", ","):
            j += 1
            continue
        return j


def _collect_refs(tokens, refs):
    stack, i, n = [], 0, len(tokens)
    while i < n:
        kind, val, _ = tokens[i]
        if kind == "op" and val == "(":
            prev = tokens[i - 1][1] if i > 0 and tokens[i - 1][0] == "word" else ""
            stack.append(prev)
            i += 1
        elif kind == "op" and val == ")":
            if stack:
                stack.pop()
            i += 1
        elif kind == "word" and val in ("from", "join") and not (stack and stack[-1] in _FROM_FUNCS):
            i = _parse_from_list(tokens, i + 1, refs, allow_commas=(val == "from"))
        else:
            i += 1


def check_schema(sql: str, schema: dict) -> list:
    try:
        toks = tokenize(sql)
    except Exception:
        return []  # the safety validator reports tokenizer problems

    cols = {t.lower(): {c.lower(): (c, ty) for c, ty in info.get("columns", {}).items()}
            for t, info in schema.items()}
    names = {t.lower(): t for t in schema}
    ctes = {toks[k][1].lower() for k in range(len(toks) - 2)
            if toks[k][0] in ("word", "qident") and toks[k + 1][:2] == ("word", "as") and toks[k + 2][:2] == ("op", "(")}

    refs = []
    _collect_refs(toks, refs)

    issues = []
    alias_map = {}          # usable qualifier -> table (lowercase) or None for derived tables / CTEs
    aliased_tables = {}     # table -> alias, for tables that were given an alias
    used_tables = set()

    for kind, table, alias in refs:
        if kind == "derived":
            if alias:
                alias_map[alias] = None
            continue
        if table in ctes:
            alias_map[alias or table] = None
            continue
        if table not in names:
            issues.append(f"table \"{table}\" is not in the schema (available tables: {', '.join(sorted(names.values()))})")
            alias_map[alias or table] = None
            continue
        used_tables.add(table)
        alias_map[alias or table] = table
        if alias:
            aliased_tables[table] = alias

    def type_of_unqualified(col):
        found = [cols[t][col][1] for t in used_tables if col in cols[t]]
        return found[0] if len(found) == 1 else None

    n = len(toks)
    for i in range(n):
        kind, val, _ = toks[i]
        if kind in ("word", "qident") and i + 2 < n and toks[i + 1][:2] == ("op", "."):
            if i > 0 and toks[i - 1][:2] == ("op", "."):
                continue
            first = val.lower()
            if first == "public":
                continue
            k2, v2, _ = toks[i + 2]
            if k2 not in ("word", "qident") and not (k2 == "op" and v2 == "*"):
                continue
            if first in alias_map:
                table = alias_map[first]
                if table is None or v2 == "*":
                    continue
                col = v2.lower()
                if col not in cols[table]:
                    valid = ", ".join(c for c, _ in cols[table].values())
                    issues.append(f"column \"{v2}\" does not exist in table \"{names[table]}\" (its columns: {valid})")
                    continue
                proper, ctype = cols[table][col]
                if (ctype in _NUMERIC_TYPES and i + 5 < n + 0
                        and toks[i + 3][:2] == ("op", ":") and toks[i + 4][:2] == ("op", ":")
                        and toks[i + 5][0] == "word" and toks[i + 5][1] in _DATE_TYPES):
                    issues.append(f"\"{names[table]}\".\"{proper}\" is {ctype} and cannot be cast to {toks[i + 5][1]}; "
                                  f"use a date column such as \"Created_At\" or cast the text date column \"Expected_Close_Date\"")
            elif first in aliased_tables:
                issues.append(f"table \"{first}\" was given the alias \"{aliased_tables[first]}\"; use \"{aliased_tables[first]}\" instead of \"{first}\"")
            elif first in names:
                issues.append(f"table \"{first}\" is used but is not listed in FROM/JOIN")
            else:
                issues.append(f"\"{val}\" is used as a table alias but is never defined in FROM/JOIN "
                              f"(write e.g. JOIN \"users\" {val} ON ... before using {val}.\"column\")")
        elif kind in ("word", "qident") and i + 3 < n and toks[i + 1][:2] == ("op", ":") and toks[i + 2][:2] == ("op", ":") \
                and toks[i + 3][0] == "word" and toks[i + 3][1] in _DATE_TYPES:
            if i > 0 and toks[i - 1][:2] == ("op", "."):
                continue
            ctype = type_of_unqualified(val.lower())
            if ctype in _NUMERIC_TYPES:
                issues.append(f"column \"{val}\" is {ctype} and cannot be cast to {toks[i + 3][1]}; use a date column instead")

    placeholder_issues = []
    for kind, val, _ in toks:
        if kind == "str" and val.strip().strip("%").strip().lower() in _PLACEHOLDERS:
            placeholder_issues.append(f"the filter value '{val}' is a placeholder, not a real value; remove every filter "
                                      f"the question did not ask for, and use only values that appear in the question")

    seen, out = set(), []
    for msg in placeholder_issues + issues:
        if msg not in seen:
            seen.add(msg)
            out.append(msg)
    return out[:MAX_ISSUES]