"""
guardrails.py -- input, SQL and output guardrails for the CloseMore AI Copilot.

Pure Python, no extra dependencies, no model calls: every check here is a rule
that runs in well under a millisecond, BEFORE (or after) the slow LLM calls.

Public API
----------
check_input(question)  -> GuardResult      prompt injection, probing, write intent, toxicity, size
validate_sql(sql, ...) -> SqlCheck         single read-only statement, no system catalogs, LIMIT added
check_output(answer)   -> (answer, flag)   prompt-leak, internal URLs, toxicity in the answer

Policy (as decided):
  - all application tables are allowed (ALLOWED_TABLES = None); no denied columns
  - lenient on harmless off-topic requests (poems, small talk are NOT blocked)
  - English-only toxicity detection (extend with blocked_words.txt)

IMPORTANT: these rules reduce risk, they do not replace database permissions.
The real wall is a read-only Postgres role. Run `python test_guardrails.py` to self-test.
"""

import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

# ============================================================
# CONFIG
# ============================================================

MAX_QUESTION_CHARS = 2000
MAX_ROWS = int(os.environ.get("SQL_MAX_ROWS", "200"))

# None = every table allowed. To restrict later: {"deals", "contacts", "products", ...}
_env_tables = os.environ.get("ALLOWED_TABLES", "").strip()
ALLOWED_TABLES = {t.strip().lower() for t in _env_tables.split(",") if t.strip()} or None

# Columns that must never be selected. Empty by decision; set DENIED_COLUMNS="password,token" to enable.
_env_cols = os.environ.get("DENIED_COLUMNS", "").strip()
DENIED_COLUMNS = {c.strip().lower() for c in _env_cols.split(",") if c.strip()}

REPLIES = {
    "injection": "I can't help with that request. I'm here to answer questions about your CRM data and uploaded documents.",
    "probe": "I can't share database internals, prompts or credentials. I can help with questions about your deals, contacts, products and documents.",
    "write": "This assistant is read-only: it can look up CRM data, but it can't create, change or delete records.",
    "toxicity": "Let's keep things respectful. I'm happy to help with questions about your CRM data or documents.",
    "size": "Please send a shorter, non-empty question.",
    "sql_blocked": "I can't run that request. Please ask about your CRM data (deals, contacts, products, pipelines) or documents.",
    "output": "I can't share that. Please ask me about your CRM data or documents.",
}


@dataclass
class GuardResult:
    allowed: bool
    category: Optional[str] = None
    reply: Optional[str] = None


# ============================================================
# NORMALIZATION
# ============================================================

_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"), None)
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})


def _normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).translate(_ZERO_WIDTH).lower()
    return re.sub(r"\s+", " ", t).strip()


def _variants(text: str):
    base = _normalize(text)
    leet = base.translate(_LEET)
    return (base,) if base == leet else (base, leet)


# ============================================================
# INPUT RULES
# ============================================================

_INJECTION = [
    r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines?|directions?|restrictions?|constraints?)\b",
    r"\bsystem prompt\b",
    r"\b(reveal|show|print|display|repeat|tell me|give me|leak|dump)\b.{0,30}\byour\b.{0,15}\b(instructions?|prompt|rules|guidelines|configuration|setup)\b",
    r"\bwhat (are|were) your (instructions|rules|guidelines)\b",
    r"\brepeat\b.{0,20}\b(everything|all|text|words)\b.{0,15}\b(above|before)\b",
    r"\b(you are now|from now on,? you are|pretend (to be|you are|you're|i am|i'm)|roleplay as|act as)\b.{0,40}\b(admin|administrator|root|superuser|developer|dan|unrestricted|jailbroken|no restrictions)\b",
    r"\b(developer|debug|god|jailbreak|dan|sudo) mode\b",
    r"\bjailbreak\b",
]
_INJECTION_RE = [re.compile(p) for p in _INJECTION]

_AUTHORITY_CLAIM = re.compile(r"\b(i am|i'm|im|as)\s+(your|the|an?)\s+(admin|administrator|developer|owner|root|superuser)\b")
_AUTHORITY_ASK = re.compile(r"\b(authori[sz]e|unlock|override|bypass|full access|permissions?|all users|everyone's|every user|all data|everything)\b")

_SCHEMA_PROBE = [
    r"\b(information_schema|pg_catalog|pg_tables|pg_user|pg_shadow|pg_roles|pg_class|pg_database)\b",
    r"\b(list|show|give|tell|what|which|name|display|print|dump)\b.{0,30}\b(tables?|schemas?|columns?)\b.{0,30}\b(database|db|postgres|postgresql|system|backend)\b",
    r"\b(database|db)\b.{0,15}\b(schema|structure|tables|layout)\b",
    r"\bhow many tables\b",
]
_SCHEMA_PROBE_RE = [re.compile(p) for p in _SCHEMA_PROBE]

_SECRET_NOUN = re.compile(r"\b(passwords?|passwd|api[ _-]?keys?|secrets?|tokens?|credentials?|private keys?|access keys?|connection strings?|env(?:ironment)? variables?)\b")
_REVEAL_VERB = re.compile(r"\b(show|give|tell|reveal|what is|what's|whats|list|dump|print|share|leak|display|send|expose|read|get|find|fetch|retrieve|provide)\b")
_SECRET_EXEMPT = re.compile(r"\b(polic(y|ies)|requirements?|rotation|expir\w*|complexity|reset)\b")

_WRITE_INTENT = [
    r"\b(delete|erase|wipe|truncate|destroy)\b.{0,40}\b(deals?|contacts?|users?|tables?|database|records?|data|products?|tasks?|activities|accounts?|rows?)\b",
    r"\bdrop\s+(table|database|schema)\b",
    r"\bdelete\s+from\b",
    r"\binsert\s+into\b",
    r"\balter\s+table\b",
    r"\bgrant\b.{0,30}\b(all|privileges)\b",
    r"^\s*(please\s+)?(can you\s+|could you\s+)?(update|modify|edit|change|set)\s+(?!me\b|us\b|in\b|of\b|on\b|about\b)(the\s+|a\s+|my\s+|our\s+)?(deal|contact|owner|stage|value|status|price|record|product|task)",
    r"^\s*(please\s+)?(can you\s+|could you\s+)?(create|add|insert)\s+(a|an|one|new)\b.{0,15}\b(deal|contact|product|task|user|table|record)",
]
_WRITE_INTENT_RE = [re.compile(p) for p in _WRITE_INTENT]

# ---- toxicity (English). Stems match as prefixes, exact words only as whole words. ----
_TOX_STEMS = ["fuck", "shit", "bitch", "bastard", "asshole", "motherfuck", "bullshit",
              "cunt", "dickhead", "slut", "whore", "wanker", "twat"]
_TOX_EXACT = ["ass", "arse", "dick", "dicks", "prick"]
_TOX_THREATS = [
    re.compile(r"\b(i('| wi)?ll|i am going to|i'm going to|gonna)\b.{0,15}\b(kill|murder|hurt|beat|stab|shoot)\b.{0,10}\b(you|him|her|them)\b"),
    re.compile(r"\bkill yourself\b|\bkys\b"),
]


def _squash(s: str) -> str:
    return re.sub(r"(.)\1+", r"\1", s)


_SQ_STEMS = [_squash(s) for s in _TOX_STEMS]
_SQ_EXACT = {_squash(w) for w in _TOX_EXACT if len(_squash(w)) >= 4}

# optional extra words (slurs, domain terms) kept OUT of source code: one word per line
_extra_words = set()
_words_file = os.environ.get("BLOCKED_WORDS_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "blocked_words.txt"))
if os.path.isfile(_words_file):
    with open(_words_file, encoding="utf-8") as _f:
        _extra_words = {ln.strip().lower() for ln in _f if ln.strip() and not ln.startswith("#")}
_extra_squashed = {_squash(w) for w in _extra_words}


# Stems match as PREFIXES, so real names that start with one are excused: Shital, Shitala, Shitole, Shittu (common Indian names).
_NAME_OK_PREFIXES = ("shital", "shitala", "shitole", "shittu")
_allowed_words = frozenset()          # person names found in the CRM data; the server refreshes this (no database access here)


def set_allowed_words(words):
    """Words that are real names in the CRM (users, contacts) and must never count as toxic."""
    global _allowed_words
    _allowed_words = frozenset(str(w).lower() for w in words)


def data_tokens(rows, limit=300):
    """Lower-case words found in the text cells of result rows (database content is not the model's or the user's speech)."""
    out = set()
    for row in list(rows or [])[:limit]:
        for v in row:
            if isinstance(v, str):
                out.update(re.findall(r"[a-z]+", v.lower()))
    return out


def _is_toxic(text: str, ignore=frozenset()) -> bool:
    ok = _allowed_words | set(ignore)
    for v in _variants(text):
        if any(p.search(v) for p in _TOX_THREATS):
            return True
        for tok in re.findall(r"[a-z]+", v):
            if tok in ok or tok.startswith(_NAME_OK_PREFIXES):
                continue
            if tok in _TOX_EXACT or tok in _extra_words or any(tok.startswith(s) for s in _TOX_STEMS):
                return True
            sq = _squash(tok)
            if sq in _extra_squashed:
                return True
            if len(sq) >= 4 and (sq in _SQ_EXACT or any(sq.startswith(s) for s in _SQ_STEMS)):
                return True
    return False


def check_input(question: str) -> GuardResult:
    if not question or not question.strip() or len(question) > MAX_QUESTION_CHARS:
        return GuardResult(False, "size", REPLIES["size"])

    variants = _variants(question)

    for v in variants:
        if any(p.search(v) for p in _INJECTION_RE):
            return GuardResult(False, "injection", REPLIES["injection"])
        if _AUTHORITY_CLAIM.search(v) and _AUTHORITY_ASK.search(v):
            return GuardResult(False, "injection", REPLIES["injection"])
        if any(p.search(v) for p in _SCHEMA_PROBE_RE):
            return GuardResult(False, "probe", REPLIES["probe"])
        if _SECRET_NOUN.search(v) and _REVEAL_VERB.search(v) and not _SECRET_EXEMPT.search(v):
            return GuardResult(False, "probe", REPLIES["probe"])
        if any(p.search(v) for p in _WRITE_INTENT_RE):
            return GuardResult(False, "write", REPLIES["write"])

    if _is_toxic(question):
        return GuardResult(False, "toxicity", REPLIES["toxicity"])

    return GuardResult(True)


# ============================================================
# SQL VALIDATOR
# ============================================================

class _SqlBlocked(Exception):
    pass


@dataclass
class SqlCheck:
    ok: bool
    reason: Optional[str] = None
    sql: Optional[str] = None  # safe SQL (LIMIT added if missing) when ok


_FORBIDDEN_KEYWORDS = {
    "insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke", "copy",
    "call", "do", "execute", "prepare", "merge", "into", "vacuum", "reindex", "cluster", "lock",
    "listen", "notify", "set", "reset", "load", "refresh", "import", "discard", "security",
}
_FORBIDDEN_IDENTS = {
    "set_config", "current_setting", "version", "current_database", "current_user", "session_user", "user",
    "inet_server_addr", "inet_client_addr", "inet_server_port", "query_to_xml", "table_to_xml",
    "database_to_xml", "information_schema",
}
_FORBIDDEN_IDENT_PREFIXES = ("pg_", "dblink", "lo_")
_FROM_FUNCS = {"extract", "substring", "trim", "overlay", "position"}
_CLAUSE_WORDS = {
    "where", "group", "order", "limit", "offset", "having", "union", "intersect", "except", "join", "inner",
    "left", "right", "full", "cross", "natural", "on", "using", "window", "fetch", "for", "returning",
    "lateral", "only", "select", "with",
}
_WORD_RE = re.compile(r"[^\W\d][\w$]*")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _tokenize(sql: str):
    """Returns [(kind, value, depth)] with comments removed and string literals isolated."""
    if "\x00" in sql:
        raise _SqlBlocked("null byte")
    toks, i, n, depth = [], 0, len(sql), 0
    while i < n:
        c = sql[i]
        if c.isspace():
            i += 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j + 1
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            if j == -1:
                raise _SqlBlocked("unterminated comment")
            i = j + 2
        elif c == "'" or c == '"':
            j = i + 1
            while True:
                if j >= n:
                    raise _SqlBlocked("unterminated quote")
                if sql[j] == c:
                    if j + 1 < n and sql[j + 1] == c:
                        j += 2
                        continue
                    break
                j += 1
            kind = "str" if c == "'" else "qident"
            toks.append((kind, sql[i + 1:j].replace(c + c, c), depth))
            i = j + 1
        elif c == "$":
            raise _SqlBlocked("dollar quoting / parameters are not allowed")
        else:
            m = _WORD_RE.match(sql, i)
            if m:
                toks.append(("word", m.group(0).lower(), depth))
                i = m.end()
                continue
            m = _NUM_RE.match(sql, i)
            if m:
                toks.append(("num", m.group(0), depth))
                i = m.end()
                continue
            if c == "(":
                toks.append(("op", c, depth))
                depth += 1
            elif c == ")":
                depth -= 1
                toks.append(("op", c, depth))
            else:
                toks.append(("op", c, depth))
            i += 1
    return toks


def _matching(tokens, j):
    d = 0
    for k in range(j, len(tokens)):
        if tokens[k][:2] == ("op", "("):
            d += 1
        elif tokens[k][:2] == ("op", ")"):
            d -= 1
            if d == 0:
                return k
    raise _SqlBlocked("unbalanced parentheses")


def _scan_from_list(tokens, j, allowed, ctes, allow_commas):
    n = len(tokens)
    while True:
        while j < n and tokens[j][0] == "word" and tokens[j][1] in ("only", "lateral"):
            j += 1
        if j >= n:
            return j
        kind, val, _ = tokens[j]
        if kind == "op" and val == "(":
            m = _matching(tokens, j)
            _check_tables(tokens[j + 1:m], allowed, ctes)
            j = m + 1
        elif kind in ("word", "qident"):
            name = val.lower()
            j += 1
            while j + 1 < n and tokens[j][:2] == ("op", ".") and tokens[j + 1][0] in ("word", "qident"):
                name = tokens[j + 1][1].lower()
                j += 2
            if j < n and tokens[j][:2] == ("op", "("):          # table-valued function
                m = _matching(tokens, j)
                _check_tables(tokens[j + 1:m], allowed, ctes)
                j = m + 1
            elif name not in ctes and name not in allowed:
                raise _SqlBlocked(f"table not allowed: {name}")
        else:
            return j
        if j < n and tokens[j][:2] == ("word", "as"):
            j += 1
        if j < n and tokens[j][0] in ("word", "qident") and not (tokens[j][0] == "word" and tokens[j][1] in _CLAUSE_WORDS):
            j += 1
            if j < n and tokens[j][:2] == ("op", "("):          # alias column list
                j = _matching(tokens, j) + 1
        if allow_commas and j < n and tokens[j][:2] == ("op", ","):
            j += 1
            continue
        return j


def _check_tables(tokens, allowed, ctes):
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
            i = _scan_from_list(tokens, i + 1, allowed, ctes, allow_commas=(val == "from"))
        else:
            i += 1


def validate_sql(sql: str, allowed_tables=ALLOWED_TABLES, denied_columns=DENIED_COLUMNS, max_rows: int = MAX_ROWS) -> SqlCheck:
    """Accepts a single read-only SELECT (or WITH ... SELECT). Returns safe SQL with LIMIT added if missing."""
    try:
        toks = _tokenize(sql)
        while toks and toks[-1][:2] == ("op", ";"):
            toks.pop()
        if not toks:
            raise _SqlBlocked("empty query")
        if any(t[:2] == ("op", ";") for t in toks):
            raise _SqlBlocked("multiple statements")
        if toks[0][0] != "word" or toks[0][1] not in ("select", "with"):
            raise _SqlBlocked("only SELECT queries are allowed")

        denied = {c.lower() for c in (denied_columns or ())}
        for kind, val, _ in toks:
            low = val.lower()
            if kind == "word" and low in _FORBIDDEN_KEYWORDS:
                raise _SqlBlocked(f"forbidden keyword: {low}")
            if kind in ("word", "qident"):
                if low in _FORBIDDEN_IDENTS or low.startswith(_FORBIDDEN_IDENT_PREFIXES):
                    raise _SqlBlocked(f"system object or function not allowed: {low}")
                if low in denied:
                    raise _SqlBlocked(f"column not allowed: {low}")

        if allowed_tables:
            allowed = {t.lower() for t in allowed_tables}
            ctes = {toks[k][1].lower() for k in range(len(toks) - 2)
                    if toks[k][0] in ("word", "qident")
                    and toks[k + 1][:2] == ("word", "as")
                    and (toks[k + 2][:2] == ("op", "(") or toks[k + 2][:2] in (("word", "materialized"), ("word", "not")))}
            _check_tables(toks, allowed, ctes)

        has_limit = any(t[0] == "word" and t[1] in ("limit", "fetch") and t[2] == 0 for t in toks)
        body = sql.rstrip().rstrip(";").rstrip()
        safe = body + ("" if has_limit else f"\nLIMIT {int(max_rows)}") + ";"
        return SqlCheck(True, None, safe)
    except _SqlBlocked as e:
        return SqlCheck(False, str(e), None)


# ============================================================
# OUTPUT CHECK
# ============================================================

_LEAK_MARKERS = [
    "you are a postgresql", "text-to-sql", "routing assistant for a crm", "respond with exactly one word",
    "output only the sql", "never invent identifiers", "sql repair system", "sql improvement system",
]
_INTERNAL_URL = re.compile(r"https?://\S*closemore\.in\S*", re.I)


def check_output(answer: str, data_words=frozenset()):
    """Returns (safe_answer, flag). flag is None when the answer passed unchanged.
    data_words: words that came from database rows (see data_tokens); they are not judged for toxicity."""
    low = answer.lower()
    if any(m in low for m in _LEAK_MARKERS):
        return REPLIES["output"], "prompt_leak"
    if _is_toxic(answer, data_words):
        return REPLIES["output"], "toxicity"
    cleaned = _INTERNAL_URL.sub("[internal address]", answer)
    return cleaned, ("internal_url" if cleaned != answer else None)


# public alias so other modules (schema_check.py) can reuse the tokenizer
tokenize = _tokenize