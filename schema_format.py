"""
schema_format.py -- turns schema.json into the compact text shown to the SQL model.

One line per table instead of indented JSON (roughly 45% fewer tokens), plus short relationship and example-value lines
when schema.json has them (see build_schema.py). The Organization_ID column is hidden from the model (it is the same
in every table and only invites mistakes); schema.json itself is not changed, so SQL that uses it is still accepted.
"""

_TYPE_SHORT = {
    "timestamp with time zone": "timestamptz",
    "timestamp without time zone": "timestamp",
    "time without time zone": "time",
    "double precision": "float",
    "character varying": "text",
    "integer": "int",
    "boolean": "bool",
}
HIDDEN_COLUMNS = {"organization_id"}


def format_schema(schema: dict) -> str:
    lines = []
    for table, info in schema.items():
        cols = [f"{c} {_TYPE_SHORT.get(t, t)}" for c, t in info.get("columns", {}).items()
                if c.lower() not in HIDDEN_COLUMNS]
        lines.append(f"{table}({', '.join(cols)})")
        rels = info.get("relationships") or []
        if rels:
            lines.append("  links: " + "; ".join(rels))
        vals = info.get("values") or {}
        if vals:
            lines.append("  example values: " + "; ".join(f"{c} = {' | '.join(v)}" for c, v in vals.items()))
    return "\n".join(lines)
