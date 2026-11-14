"""
answer_text.py -- the text shown above a result table, and checks on model-written answers.

Pure Python, no model calls, no database access.

  build_summary(sql_result, table_shown)   a short, always-correct sentence written by CODE
  has_builder(template_name)               True when code writes the sentence for this template (no model call needed)
  rows_for_model(columns, rows)            a SMALL, readable slice of the rows for the final-answer prompt
  check(answer, question, ...)             list of problems found in a model-written answer ([] = passed)

Why: when a table is shown, the answer text must be one short line and must never repeat the rows. The model
kept listing every row (17-68 s), mixed up owners and contacts, said "not enough information" while rows existed,
and overflowed the 4096-token context on wide results. Code-written sentences cannot contradict the rows.
"""

import math
import re
from collections import Counter

import result_view            # reuses its cell clean-up and the First_Name + Last_Name merge, so text and table agree

MAX_MODEL_ROWS = 10
MAX_MODEL_COLS = 8
MAX_LIST_LINES = 3            # more list-like lines than this = the answer is repeating the table


# ============================================================
# formatting
# ============================================================

def fmt_number(v) -> str:
    """Same look as the frontend table: thousands separators, at most 2 decimals, no currency symbol."""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, float):
        s = f"{v:,.2f}"
        return s.rstrip("0").rstrip(".") if "." in s else s
    return str(v)


def _fmt(v) -> str:
    return "not recorded" if v is None else fmt_number(v)


def _label(v) -> str:
    return "(no name)" if v in (None, "") else str(v)


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _norm_col(c) -> str:
    return re.sub(r"[\s_]+", "_", str(c).strip().lower())


def _col(cols, *names):
    for i, c in enumerate(cols):
        if _norm_col(c) in names:
            return i
    return None


def _things(n, capped, one, many=None) -> str:
    """'1 deal', '37 deals', 'at least 200 deals'."""
    many = many or one + "s"
    if capped:
        return f"at least {n:,} {many}"
    return f"{n:,} {one if n == 1 else many}"


def _prepare(columns, rows, show_ids=False):
    columns = [str(c) for c in columns]
    if not show_ids:
        columns, rows = result_view.drop_id_columns(columns, rows)
    clean = [[result_view._cell(v) for v in row] for row in rows]
    return result_view._merge_names(columns, clean)


# ============================================================
# code-written sentences, one per template in sql_templates.py
# ============================================================

def _owner_deal_counts(cols, rows, ctx):
    i_name, i_n = _col(cols, "name"), _col(cols, "deals")
    if i_name is None or i_n is None:
        return None
    ranked = [(r[i_name], r[i_n]) for r in rows if _is_num(r[i_n])]
    if not ranked:
        return None
    top = max(n for _, n in ranked)
    leaders = [nm for nm, n in ranked if n == top]
    if len(leaders) == 1:
        first = f"{_label(leaders[0])} owns the most deals ({fmt_number(top)})."
    else:
        first = f"{len(leaders)} owners are tied for the most deals ({fmt_number(top)} each)."
    total = len(ranked)
    if ctx.get("scoped"):
        return f"{_scoped(first)} {_things(total, False, 'owner')} {'has' if total == 1 else 'have'} deals among them."
    return f"{first} {_things(total, False, 'owner')} {'has' if total == 1 else 'have'} deals in total."


def _top_owners_by_value(cols, rows, ctx):
    i_name, i_val = _col(cols, "name"), _col(cols, "total_deal_value")
    if i_name is None or i_val is None:
        return None
    ranked = [(r[i_name], r[i_val]) for r in rows if _is_num(r[i_val])]
    if not ranked:
        return None
    (a, va) = ranked[0]
    if ctx.get("scoped"):
        return _scoped(_top_owners_by_value(cols, rows, dict(ctx, scoped=False)))
    if len(ranked) == 1:
        return f"{_label(a)} has a total deal value of {fmt_number(va)}."
    (b, vb) = ranked[1]
    if va == vb:
        return f"{_label(a)} and {_label(b)} are tied for the highest total deal value ({fmt_number(va)})."
    return f"{_label(a)} has the highest total deal value ({fmt_number(va)}), followed by {_label(b)} ({fmt_number(vb)})."


def _scoped(sentence):
    """'X has ...' -> 'Of the deals you can see, X has ...' (for users who see only part of the CRM)."""
    return None if not sentence else f"Of the deals you can see, {sentence}"


def _deals_grouped(cols, rows, ctx):
    if ctx.get("scoped"):
        return _scoped(_deals_grouped(cols, rows, dict(ctx, scoped=False)))
    if len(cols) < 2:
        return None
    dim = re.sub(r"_+", " ", str(cols[0])).lower()
    by_value = _norm_col(cols[1]) == "total_deal_value"
    ranked = [(r[0], r[1]) for r in rows if _is_num(r[1])]
    if not ranked:
        return None
    top = max(v for _, v in ranked)
    leaders = [("(not set)" if k in (None, "") else str(k)) for k, v in ranked if v == top]
    if len(leaders) == 1:
        who = leaders[0]
        first = (f"{who} has the highest total deal value ({fmt_number(top)})." if by_value
                 else f"{who} has the most deals ({fmt_number(top)}).")
    else:
        first = (f"{len(leaders)} groups are tied for the highest total deal value ({fmt_number(top)})." if by_value
                 else f"{len(leaders)} groups are tied for the most deals ({fmt_number(top)} each).")
    return f"{first} {len(ranked)} {'group' if len(ranked) == 1 else 'groups'} in total, by {dim}."


def _deals_closing(cols, rows, ctx):
    i_name, i_date = _col(cols, "deal_name"), _col(cols, "expected_close_date")
    n = len(rows)
    text = (f"{_things(n, ctx['capped'], 'deal')}{' that you can see' if ctx.get('scoped') else ''} "
            f"{'is' if n == 1 else 'are'} expected to close in that period.")
    if i_name is not None and i_date is not None and rows[0][i_date]:
        text += f" The earliest is {_label(rows[0][i_name])} on {rows[0][i_date]}."
    return text


def _deals_with_contacts(cols, rows, ctx):
    return f"Listed {_things(len(rows), ctx['capped'], 'deal')}{' that you can see' if ctx.get('scoped') else ''} with their associated contact."


def _deals_with_owner(cols, rows, ctx):
    return f"Listed {_things(len(rows), ctx['capped'], 'deal')}{' that you can see' if ctx.get('scoped') else ''} with their owner."


def _deals_name_contains(cols, rows, ctx):
    return f"Found {_things(len(rows), ctx['capped'], 'deal')}{' that you can see' if ctx.get('scoped') else ''} whose name matches your search."


def _total_deal_value(cols, rows, ctx):
    v = rows[0][0]
    if ctx.get("scoped"):
        return f"The total value of the deals you can see is {fmt_number(v if v is not None else 0)}."
    return f"The total deal value is {fmt_number(v if v is not None else 0)}."


def _count_deals(cols, rows, ctx):
    v = rows[0][0]
    if not _is_num(v):
        return None
    if ctx.get("scoped"):
        return f"You can see {fmt_number(v)} {'deal' if v == 1 else 'deals'}."
    return f"There {'is' if v == 1 else 'are'} {fmt_number(v)} {'deal' if v == 1 else 'deals'} in total."


def _deals_by_owner(cols, rows, ctx):
    who = ctx.get("entity") or "This owner"
    n = len(rows)
    verb = "own" if (" and " in str(who) or re.match(r"^\d+ people\b", str(who))) else "owns"   # several people
    text = f"{who} {verb} {_things(n, ctx['capped'], 'deal')}{' that you can see' if ctx.get('scoped') else ''}"
    i_val, i_name = _col(cols, "deal_value"), _col(cols, "deal_name")
    values = [r[i_val] for r in rows if i_val is not None and _is_num(r[i_val])]
    if values:
        text += f", worth {fmt_number(sum(values))} in total"
    text += "."
    if i_val is not None and i_name is not None and _is_num(rows[0][i_val]):     # SQL orders by value, largest first
        text += f" The largest is {_label(rows[0][i_name])} ({fmt_number(rows[0][i_val])})."
    return text


def _tasks_by_user(cols, rows, ctx):
    who = ctx.get("entity") or "This user"
    n = len(rows)
    text = f"{who} has {_things(n, ctx['capped'], 'task')} assigned"
    i_status = _col(cols, "status")
    if i_status is not None:
        counts = Counter("no status" if r[i_status] in (None, "") else str(r[i_status]) for r in rows)
        text += " (" + ", ".join(f"{s}: {c}" for s, c in counts.most_common()) + ")"
    return text + "."


def _deal_values(cols, rows):
    i_val = _col(cols, "deal_value")
    return [r[i_val] for r in rows if i_val is not None and _is_num(r[i_val])]


def _my_deals(cols, rows, ctx):
    n = len(rows)
    text = f"You have {_things(n, ctx['capped'], 'deal')}"
    i_role = _col(cols, "my_role")
    if i_role is not None:
        owned = sum(1 for r in rows if r[i_role] == "Owner")
        text += f": {owned:,} as owner and {n - owned:,} as a deal-team member"
    values = _deal_values(cols, rows)
    if values:
        text += f", worth {fmt_number(sum(values))} in total"
    return text + "."


def _my_owned_deals(cols, rows, ctx):
    text = f"You own {_things(len(rows), ctx['capped'], 'deal')}"
    values = _deal_values(cols, rows)
    if values:
        text += f", worth {fmt_number(sum(values))} in total"
    i_val, i_name = _col(cols, "deal_value"), _col(cols, "deal_name")
    text += "."
    if i_val is not None and i_name is not None and _is_num(rows[0][i_val]):
        text += f" The largest is {_label(rows[0][i_name])} ({fmt_number(rows[0][i_val])})."
    return text


def _my_team_deals(cols, rows, ctx):
    return f"You are on the deal team of {_things(len(rows), ctx['capped'], 'deal')}."


def _my_deals_count(cols, rows, ctx):
    v = rows[0][0]
    if not _is_num(v):
        return None
    return f"You have {fmt_number(v)} {'deal' if v == 1 else 'deals'} as owner or deal-team member."


def _person_overview(cols, rows, ctx):
    i = {k: _col(cols, k) for k in ("name", "role", "region", "deals", "total_deal_value", "contacts")}
    if i["name"] is None or len(rows) > 3:
        return None
    seen = " that you can see" if ctx.get("scoped") else ""
    out = []
    for r in rows:
        role = str(r[i["role"]] or "user").replace("_", " ").strip().capitalize() if i["role"] is not None else "User"
        region = (r[i["region"]] or "").strip() if i["region"] is not None else ""
        text = f"{_label(r[i['name']])} is a {role}" + (f" in {region}" if region else " with no region")
        if i["deals"] is not None and _is_num(r[i["deals"]]):
            n = r[i["deals"]]
            text += f", with {fmt_number(n)} {'deal' if n == 1 else 'deals'}{seen}"
            if n and i["total_deal_value"] is not None and _is_num(r[i["total_deal_value"]]):
                text += f" worth {fmt_number(r[i['total_deal_value']])} in total"
        if i["contacts"] is not None and _is_num(r[i["contacts"]]):
            c = r[i["contacts"]]
            text += f", and {fmt_number(c)} {'contact' if c == 1 else 'contacts'}"
        out.append(text + ".")
    return " ".join(out)


def _person_all(cols, rows, ctx):
    return ctx.get("summary")


_BUILDERS = {
    "person_all": _person_all,
    "person_overview": _person_overview,
    "my_overview": _person_overview,
    "my_deals": _my_deals,
    "my_owned_deals": _my_owned_deals,
    "my_team_deals": _my_team_deals,
    "my_deals_count": _my_deals_count,
    "owner_deal_counts": _owner_deal_counts,
    "top_owners_by_value": _top_owners_by_value,
    "deals_grouped": _deals_grouped,
    "deals_closing": _deals_closing,
    "deals_with_contacts": _deals_with_contacts,
    "deals_with_owner": _deals_with_owner,
    "deals_name_contains": _deals_name_contains,
    "total_deal_value": _total_deal_value,
    "count_deals": _count_deals,
    "deals_by_owner": _deals_by_owner,
    "tasks_by_user": _tasks_by_user,
}


def has_builder(template_name) -> bool:
    return template_name in _BUILDERS


_NOUN_BY_COLUMN = (("deal_name", "deal"), ("task_title", "task"))
_ENTITY_KIND_SUFFIX = re.compile(r"^(?P<name>.+?)\s*\((?:user|contact)\)$")


def _who(sql_result):
    """The one person the rows belong to, when known: the template's person, or the single user/contact found in the question."""
    if sql_result.get("entity"):
        return str(sql_result["entity"])
    names = [m.group("name") for m in (_ENTITY_KIND_SUFFIX.match(str(e)) for e in sql_result.get("entities") or []) if m]
    return names[0] if len(names) == 1 and len(sql_result.get("entities") or []) == 1 else None


def _noun(cols):
    names = {_norm_col(c) for c in cols}
    return next((noun for col, noun in _NOUN_BY_COLUMN if col in names), "row")


def _generic(cols, rows, ctx, table_shown, table):
    n = len(rows)
    if table_shown:
        text = f"Found {_things(n, ctx['capped'], ctx.get('noun') or 'row')}"
        if ctx.get("who"):
            text += f" for {ctx['who']}"
        if ctx.get("scoped"):
            text += " that you can see"
        text += ". The details are in the table."
        if table and table.get("truncated"):
            text += f" The table shows the first {len(table.get('rows') or [])}."
        return text
    # one small row, no table: the sentence itself carries the data
    pairs = [f"{result_view._pretty(c)}: {_fmt(v)}" for c, v in zip(cols, rows[0])]
    return "; ".join(pairs) + "."


def build_summary(sql_result, table_shown, max_rows=200) -> str:
    """A short sentence about the result, written by code. Empty string when there are no rows."""
    cols, rows = _prepare(sql_result.get("columns") or [], sql_result.get("rows") or [], sql_result.get("show_ids", False))
    n = len(rows)
    if not n:
        return ""
    ctx = {"entity": sql_result.get("entity"), "capped": n >= max_rows, "who": _who(sql_result), "noun": _noun(cols),
           "scoped": bool(sql_result.get("scoped")), "summary": sql_result.get("summary")}
    fn = _BUILDERS.get(sql_result.get("template"))
    text = None
    if fn:
        try:
            text = fn(cols, rows, ctx)
        except Exception:
            text = None
    if text:
        if table_shown and n > 1:
            text += " See the table for the full list."
        return text
    return _generic(cols, rows, ctx, table_shown, sql_result.get("table"))


# ============================================================
# what the final-answer model is allowed to see
# ============================================================

def rows_for_model(columns, rows, max_rows=MAX_MODEL_ROWS, max_cols=MAX_MODEL_COLS, show_ids=False):
    """Returns (header, table_text): at most max_rows rows and max_cols columns, with the real totals in the header.
    ID columns are left out unless show_ids."""
    cols, clean = _prepare(columns, rows, show_ids)
    total_rows, total_cols = len(clean), len(cols)
    lines = [" | ".join(cols[:max_cols])]
    for r in clean[:max_rows]:
        lines.append(" | ".join("(empty)" if v is None else fmt_number(v) for v in r[:max_cols]))
    head = f"{total_rows} row(s) in total"
    if total_rows > max_rows:
        head += f"; only the first {max_rows} rows are shown here"
    if total_cols > max_cols:
        head += f"; only the first {max_cols} of {total_cols} columns are shown"
    return head, "\n".join(lines)


# ============================================================
# clean-up of a model-written answer
# ============================================================

# "Here's the main finding:", "Summary:", "Here is the answer directly to a CRM user:" -- labels the model adds in front
_LABEL = re.compile(r"^\s*(?:summary|short summary|main finding|key finding|answer|here(?:'s|\s+is)\b[^:\n]{0,100}):\s*", re.I)
# "The full table of results is shown (to you) separately." / "See the table." -- sentences that only point at the table
_POINTS_AT_TABLE = re.compile(r"\b(?:is|are)\s+(?:shown|displayed|listed|provided)\s+(?:to you\s+)?(?:separately|below|above)\b|"
                              r"^\W*(?:please\s+)?(?:see|refer to|check)\s+(?:the\s+)?(?:full\s+)?table\b", re.I)


def clean_model_answer(text) -> str:
    """Removes prompt echoes. The table is shown by the app, so the text never needs to mention it."""
    out = []
    for line in str(text or "").strip().split("\n"):
        if not line.strip():
            out.append("")
            continue
        sentences = re.split(r"(?<=[.!?])\s+", line.strip())
        sentences[0] = _LABEL.sub("", sentences[0])
        kept = [s for s in sentences if s.strip() and not (len(s) < 140 and _POINTS_AT_TABLE.search(s))]
        if kept:
            out.append(" ".join(kept))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


# ============================================================
# checks on a model-written answer
# ============================================================

_LEAK = re.compile(r"\bsql\b|\bqueries\b|\bthe context\b|\bprovided context\b|\bcontext above\b|crm user\b|"
                   r"\bdocument search\b|\banswer directly\b", re.I)
_NO_INFO = re.compile(r"not enough information|no information|(?:don'?t|do not) have (?:any )?information|"
                      r"(?:can'?t|cannot|couldn'?t|could not) find|not available in|(?:does not|doesn'?t) contain|"
                      r"\bunfortunately\b", re.I)
_LIST_LINE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+\S")
_DASH_LINE = re.compile(r"\S\s[-\u2013\u2014]\s\S")
_FIELD = re.compile(r"(?:^|[\n,;]\s*)[A-Za-z][A-Za-z_ ]{1,30}:\s+\S")   # "Email: x@y.com" -- the answer copies table columns
MAX_TEXT_WITH_TABLE = 450                     # with a table on screen, the text is a short summary
_NUM = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")
_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_CAP_SEQ = re.compile(r"\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,3}\b")
_NAME_STOP = {"crm", "closemore", "copilot"}


def _words(text):
    return set(re.findall(r"[a-z0-9']+", str(text).lower()))


def _close(a, b):
    return math.isclose(a, b, abs_tol=0.01) or (float(a).is_integer() and round(b) == a)


def check(answer, question="", sql_result=None, table_shown=False, cut_off=False, allowed_text=""):
    """Returns a list of problem codes. An empty list means the answer passed.

    sql_result: pass it only when the answer is meant to be based on those rows (enables the row-based checks).
    allowed_text: extra text the answer may legitimately quote (for example a document answer on the BOTH route).
    """
    problems = []
    text = str(answer or "")
    if not text.strip():
        return ["empty_answer"]
    if cut_off:
        problems.append("cut_off")
    if _LEAK.search(text):
        problems.append("prompt_leak")
    if not sql_result or not sql_result.get("rows"):
        return problems

    cols, rows = _prepare(sql_result.get("columns") or [], sql_result["rows"], sql_result.get("show_ids", False))
    n = len(rows)

    if _NO_INFO.search(text):
        problems.append("no_info_with_rows")

    if table_shown and len(_FIELD.findall(text)) > MAX_LIST_LINES:
        problems.append("lists_rows")               # "Name: ..., Email: ..., Phone: ..." repeats the table, whatever its size
    if table_shown and len(text) > MAX_TEXT_WITH_TABLE and "lists_rows" not in problems:
        problems.append("too_long_with_table")
    if table_shown and n > MAX_LIST_LINES and "lists_rows" not in problems:   # naming the 2-3 rows of a small table is fine
        lines = text.splitlines()
        item_lines = sum(1 for ln in lines if _LIST_LINE.match(ln))
        dash_lines = sum(1 for ln in lines if _DASH_LINE.search(ln))
        cells = {str(v).strip().lower() for r in rows for v in r if isinstance(v, str) and len(str(v).strip()) >= 4}
        low = text.lower()
        repeated = sum(1 for c in cells if c in low)
        if item_lines > MAX_LIST_LINES or dash_lines > MAX_LIST_LINES or repeated > MAX_LIST_LINES:
            problems.append("lists_rows")

    # numbers must come from the rows, the question, the document text, or be the row count
    allowed_nums = {1.0, float(n), float(len(cols))}
    cell_text = []
    for r in rows:
        for v in r:
            if _is_num(v):
                allowed_nums.add(float(v))
            elif isinstance(v, str):
                cell_text.append(v)
    for source in (" ".join(cell_text), question or "", allowed_text or "", " ".join(map(str, cols))):
        for m in _NUM.findall(_DATE.sub(" ", source)):
            try:
                allowed_nums.add(float(m.replace(",", "")))
            except ValueError:
                pass
    bad = []
    for m in _NUM.findall(_DATE.sub(" ", text)):
        try:
            x = float(m.replace(",", "").rstrip("."))
        except ValueError:
            continue
        if not any(_close(x, y) for y in allowed_nums):
            bad.append(m)
    if bad:
        problems.append("number_not_in_data:" + ",".join(dict.fromkeys(bad)))

    # a Firstname Lastname that shares no word with the rows or the question was invented
    known = _words(" ".join(cell_text)) | _words(question) | _words(allowed_text) | _words(" ".join(map(str, cols))) | _NAME_STOP
    invented = []
    for m in _CAP_SEQ.findall(text):
        if not any(w in known for w in _words(m)):
            invented.append(m)
    if invented:
        problems.append("unknown_name:" + ",".join(dict.fromkeys(invented)))

    return problems


# ============================================================
# document citations: "(Source N)" in the text must match the numbered source chips
# ============================================================

_SOURCE_REF = re.compile(r"\bSource\s*(\d+)", re.I)


def cited_sources(text) -> set:
    """Source numbers cited in a text ("(Source 2)", "[Source 3: ...]")."""
    return {int(n) for n in _SOURCE_REF.findall(str(text or ""))}


def source_problems(answer, document_answer) -> list:
    """Problems when the final answer drops the document answer's citations or invents new numbers.
    Nothing to check when the document answer cites nothing."""
    allowed = cited_sources(document_answer)
    if not allowed:
        return []
    used = cited_sources(answer)
    if not used:
        return ["sources_dropped"]
    extra = sorted(used - allowed)
    return ["unknown_source:" + ",".join(map(str, extra))] if extra else []