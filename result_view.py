"""
result_view.py -- turns SQL result rows into the optional `table` and `chart` fields of the /ask response.

Matches the contract in BACKEND_HANDOFF.md:
  table = {"columns": [...], "rows": [[...]], "truncated": bool}      rows capped at 50
  chart = {"type": "bar"|"line", "x": <column>, "series": [<columns>], "title": str}   only together with a table
The chart type and columns are chosen by RULES here, never by the model. No chart is sent when the shape is unsuitable.
"""

import math
import re
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

import os

MAX_ROWS = int(os.environ.get("TABLE_MAX_ROWS", "200"))     # rows sent to the frontend (it shows 50 at a time)
MAX_BAR_POINTS = int(os.environ.get("CHART_MAX_BAR_POINTS", "25"))     # more bars than this: table only (frontend scrolls charts sideways)
MAX_LINE_POINTS = int(os.environ.get("CHART_MAX_LINE_POINTS", "50"))
MAX_SERIES = 3
MAX_SCALE_RATIO = 50          # series whose largest values differ by more than this are not drawn together
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T].*)?$")


_ID_COL = re.compile(r"(?:^|[_\s])id$", re.I)


def is_id_column(name) -> bool:
    """Deal_ID, Owner_ID, Associated_Contact_ID, 'id' ... are internal keys, not information for the reader."""
    return bool(_ID_COL.search(str(name).strip()))


def drop_id_columns(columns, rows):
    """Removes ID columns. Keeps everything when there is nothing to hide or nothing else would be left."""
    keep = [i for i, c in enumerate(columns) if not is_id_column(c)]
    if not keep or len(keep) == len(columns):
        return list(columns), [list(r) for r in rows]
    return [columns[i] for i in keep], [[row[i] for i in keep] for row in rows]


def _cell(v):
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, Decimal):
        f = float(v)
        if not math.isfinite(f):
            return None
        return int(f) if f.is_integer() and abs(f) < 1e15 else f
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    return str(v)


def _pretty(name: str) -> str:
    n = re.sub(r"_+", " ", str(name)).strip() or "Column"
    return n[:1].upper() + n[1:]


def _unique(names):
    seen, out = {}, []
    for n in names:
        if n in seen:
            seen[n] += 1
            out.append(f"{n} ({seen[n]})")
        else:
            seen[n] = 1
            out.append(n)
    return out


def _merge_names(columns, rows):
    """Joins neighbouring '<x>First_Name' + '<x>Last_Name' columns into one '<x>Name' column."""
    out_cols, idx, i = [], [], 0
    while i < len(columns):
        a = str(columns[i])
        b = str(columns[i + 1]) if i + 1 < len(columns) else ""
        if a.lower().endswith("first_name") and b.lower().endswith("last_name") \
                and a[: -len("first_name")].lower() == b[: -len("last_name")].lower():
            out_cols.append(a[: -len("first_name")] + "Name")
            idx.append((i, i + 1))
            i += 2
        else:
            out_cols.append(a)
            idx.append((i,))
            i += 1
    new_rows = []
    for row in rows:
        new = []
        for group in idx:
            if len(group) == 2:
                parts = [str(row[g]).strip() for g in group if row[g] not in (None, "")]
                new.append(" ".join(parts) if parts else None)
            else:
                new.append(row[group[0]])
        new_rows.append(new)
    return out_cols, new_rows


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _kind(col_values, name):
    vals = [v for v in col_values if v is not None]
    if not vals:
        return "empty"
    if all(_is_num(v) for v in vals) and not name.lower().rstrip().endswith(" id") and not name.lower().endswith("_id"):
        return "number"
    if all(isinstance(v, str) and _DATE_RE.match(v) for v in vals):
        return "date"
    return "text"


def _pick_chart(columns, rows, truncated):
    n = len(rows)
    if truncated or n < 2:
        return None, rows
    kinds = [_kind([r[i] for r in rows], columns[i]) for i in range(len(columns))]
    numbers = [i for i, k in enumerate(kinds) if k == "number"]
    dates = [i for i, k in enumerate(kinds) if k == "date"]
    texts = [i for i, k in enumerate(kinds) if k == "text"]
    if not numbers or len(numbers) > MAX_SERIES:
        return None, rows
    if dates:
        x = dates[0]
        if len(dates) > 1 or texts or n > MAX_LINE_POINTS:
            return None, rows
        ctype = "line" if n >= 3 else "bar"
        rows = sorted(rows, key=lambda r: str(r[x]))
    elif len(texts) == 1 and n <= MAX_BAR_POINTS:
        x, ctype = texts[0], "bar"
    else:
        return None, rows
    series = [i for i in numbers if i != x]
    if not series or len(series) > MAX_SERIES:
        return None, rows
    if len({r[x] for r in rows}) < 2:
        return None, rows
    if len(series) > 1:
        peaks = [max(abs(r[i]) for r in rows if r[i] is not None) for i in series]
        if min(peaks) == 0 or max(peaks) / min(peaks) > MAX_SCALE_RATIO:
            return None, rows
    names = [columns[i] for i in series]
    return {"type": ctype, "x": columns[x], "series": names, "title": f"{', '.join(names)} by {columns[x]}"}, rows


def build(columns, rows, show_ids=False):
    """Returns (table, chart); either may be None. ID columns are hidden unless show_ids (the user asked for IDs)."""
    if not rows or not columns:
        return None, None
    if not show_ids:
        columns, rows = drop_id_columns(columns, rows)
    if len(rows) == 1 and len(columns) < 3:
        return None, None                      # a single value or pair is better said in the text
    clean = [[_cell(v) for v in row] for row in rows]
    cols, clean = _merge_names([str(c) for c in columns], clean)
    cols = _unique([_pretty(c) for c in cols])
    truncated = len(clean) > MAX_ROWS
    shown = clean[:MAX_ROWS]
    chart, shown = _pick_chart(cols, shown, truncated)
    if cols and cols[0] == "Person":           # several people (letters A, B ...): one bar per letter would repeat, so no chart
        chart = None
    return {"columns": cols, "rows": shown, "truncated": truncated}, chart