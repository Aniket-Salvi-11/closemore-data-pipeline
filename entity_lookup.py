"""
entity_lookup.py -- finds the people, deals, products and companies a question talks about, in the real database.

Why: a name like "Aman Jain" lives in ONE table ("users": First_Name + Last_Name) while the data the user wants lives
in others. Letting the SQL model guess both at once is what failed ("what is Aman Jain working on?"). Here the lookup
is done first, by fixed code, and the model (or a template) then only receives the resolved ID.

  resolve_person(text, ...)    exact match, then spelling-tolerant match   -> Resolution (found | ambiguous | not_found)
  scan_question_ex(question)   names found anywhere in a question          -> (entities, ambiguous names)
  scan_question(question)      same, entities only
  facts_for_prompt(entities)   short "use this ID" lines for the SQL prompt
  label_with_detail(entity)    "Priya Nair (priya@x.com, Sales_Rep)" -- tells two people with one name apart

Spelling tolerance (second step of resolve_person):
  1. PostgreSQL pg_trgm fetches CANDIDATES from the live tables (trigram similarity >= TRGM_CANDIDATE_CUTOFF). It sees new
     users immediately and scales past the in-memory cache. Short names score low in trigrams ("jan" vs "jain" = 0.29),
     so the cutoff is deliberately low.
  2. difflib then SCORES those candidates with the normal cutoff, so one scale decides (FUZZY_CUTOFF / MIN_GAP).
  If the pg_trgm extension is missing or the query fails, difflib scores the in-memory names instead. Nothing breaks.

The names are loaded once from the database (read-only) and cached for a few minutes. No model calls.
"""

import difflib
import logging
import re
import threading
import time
from dataclasses import dataclass, field

log = logging.getLogger("copilot")

TTL_SECONDS = 300
RETRY_AFTER_FAILURE_SECONDS = 60
MAX_ROWS_PER_TABLE = 20000
FUZZY_CUTOFF = 0.8
MAX_CANDIDATES = 25                # matches kept for one name (the server shows up to 10, else asks for the last name)
MIN_GAP = 0.06                     # best fuzzy match must beat the runner-up by this much, else it is "ambiguous"
TRGM_CANDIDATE_CUTOFF = 0.2        # pg_trgm similarity needed to be CONSIDERED (difflib then decides)
TRGM_MAX_CANDIDATES = 20
SCAN_FUZZY_CUTOFF = 0.88           # a two-word phrase in a question must be this close to a full name
SCAN_FUZZY_MAX_KEYS = 5000         # skip the in-question typo pass when there are more names than this
_TITLES = {"sir", "mr", "mrs", "ms", "dr", "madam", "mam", "maam", "ji", "shri", "smt"}
_STOP = {
    "the", "and", "for", "all", "any", "are", "who", "what", "which", "show", "tell", "give", "list", "deal", "deals",
    "owner", "owners", "contact", "contacts", "product", "products", "task", "tasks", "name", "names", "first", "last",
    "this", "that", "with", "from", "have", "has", "does", "how", "many", "much", "total", "top", "value", "stage",
    "status", "month", "year", "week", "working", "details", "please", "new", "open", "won", "lost", "lead",
}

SOURCES = [   # kind, table, id column, name columns, detail columns (shown to tell two people with the same name apart)
    ("user", "users", "User_ID", ("First_Name", "Last_Name"), ("Email", "Role")),
    ("contact", "contacts", "Contact_ID", ("First_Name", "Last_Name"), ("Organization_Name",)),
    ("deal", "deals", "Deal_ID", ("Deal_Name",), ()),
    ("product", "products", "Product_ID", ("Name",), ()),
]
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _norm(s) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(s or "").lower())).strip()


@dataclass
class Entity:
    kind: str                 # user | contact | deal | product | company
    id: str
    display: str
    first: str = ""
    last: str = ""
    detail: str = ""          # e.g. "priya@x.com, Sales_Rep" (users) or the organization (contacts)


@dataclass
class Resolution:
    status: str               # found | ambiguous | not_found
    entity: Entity | None = None
    candidates: list = field(default_factory=list)
    corrected: bool = False
    typed: str = ""


class _Index:
    def __init__(self):
        self.entities = []                       # all entities
        self.by_full = {}                        # (kind, normalized full name) -> [Entity]
        self.by_token = {}                       # (kind, normalized first/last token) -> [Entity]
        self.emails = {}                         # lower-case email -> Entity (users)
        self.loaded_at = 0.0
        self._tokens = None

    def add(self, e: Entity):
        self.entities.append(e)
        full = _norm(e.display)
        if full:
            self.by_full.setdefault((e.kind, full), []).append(e)
            if e.kind in ("user", "contact") and e.first and e.last:
                self.by_full.setdefault((e.kind, _norm(f"{e.last} {e.first}")), []).append(e)
        if e.kind in ("user", "contact"):
            for part in (e.first, e.last):
                p = _norm(part)
                if p:
                    self.by_token.setdefault((e.kind, p), []).append(e)

    def name_tokens(self):
        if self._tokens is None:
            self._tokens = {w for e in self.entities if e.kind in ("user", "contact") for w in re.findall(r"[a-z]+", e.display.lower())}
        return self._tokens


_lock = threading.Lock()
_index = None
_trgm_state = None        # None = not tried yet, True = works, False = the pg_trgm functions are missing


def _q(ident):
    return '"' + ident.replace('"', '""') + '"'


def _distinct(entities):
    seen, out = set(), []
    for e in entities:
        if (e.kind, e.id) not in seen:
            seen.add((e.kind, e.id))
            out.append(e)
    return out


def _detail(values) -> str:
    return ", ".join(str(v).strip() for v in values if v not in (None, "") and str(v).strip())


def _entity_from_row(kind, name_cols, details, row) -> Entity:
    """row = (id, *name columns, *detail columns, ...)."""
    n = len(name_cols)
    rid = str(row[0])
    det = _detail(row[1 + n:1 + n + len(details)])
    parts = [str(v).strip() for v in row[1:1 + n] if v not in (None, "")]
    if n == 2:
        return Entity(kind, rid, " ".join(parts), str(row[1] or "").strip(), str(row[2] or "").strip(), det)
    return Entity(kind, rid, parts[0] if parts else "", detail=det)


def _load(get_conn, schema) -> _Index:
    idx = _Index()
    conn = get_conn()
    try:
        cur = conn.cursor()
        for kind, table, id_col, name_cols, detail_cols in SOURCES:
            cols = (schema.get(table) or {}).get("columns", {})
            if id_col not in cols or any(c not in cols for c in name_cols):
                continue
            details = [c for c in detail_cols if c in cols]
            select = ", ".join(_q(c) for c in (id_col, *name_cols, *details))
            try:
                cur.execute(f"SELECT {select} FROM {_q(table)} LIMIT {MAX_ROWS_PER_TABLE}")
                rows = cur.fetchall()
            except Exception as e:
                conn.rollback()
                log.warning(f"entity index: could not read {table}: {str(e).strip().splitlines()[0]}")
                continue
            email_pos = 1 + len(name_cols) + details.index("Email") if "Email" in details else None
            org_pos = 1 + len(name_cols) + details.index("Organization_Name") if (kind == "contact" and "Organization_Name" in details) else None
            companies = set()
            for row in rows:
                e = _entity_from_row(kind, name_cols, details, row)
                if not e.display:
                    continue
                idx.add(e)
                if email_pos is not None and row[email_pos] and str(row[email_pos]).strip():
                    idx.emails.setdefault(str(row[email_pos]).strip().lower(), e)
                if org_pos is not None and row[org_pos] and str(row[org_pos]).strip():
                    companies.add(str(row[org_pos]).strip())
            for c in sorted(companies):
                idx.add(Entity("company", c, c))
        cur.close()
    finally:
        try:
            conn.close()
        except Exception:
            pass
    idx.loaded_at = time.time()
    return idx


def get_index(get_conn, schema) -> _Index:
    global _index
    with _lock:
        now = time.time()
        if _index is not None and now - _index.loaded_at < TTL_SECONDS:
            return _index
        try:
            _index = _load(get_conn, schema)
            log.info(f"entity index loaded: {len(_index.entities)} names")
        except Exception as e:
            log.warning(f"entity index could not be loaded: {e}")
            if _index is None:
                _index = _Index()
            # try again after a short pause instead of on every question
            _index.loaded_at = now - TTL_SECONDS + RETRY_AFTER_FAILURE_SECONDS
        return _index


def reset_cache():
    global _index, _trgm_state
    with _lock:
        _index = None
        _trgm_state = None


def name_tokens():
    """Words that are parts of real user/contact names (from the cached index; never touches the database)."""
    idx = _index
    return idx.name_tokens() if idx is not None else set()


def label_with_detail(entity) -> str:
    return f"{entity.display} ({entity.detail})" if entity.detail else entity.display


# ---------------------------------------------------------------- pg_trgm candidates
def _trgm_entities(get_conn, schema, text, single, kinds):
    """Candidate entities from PostgreSQL pg_trgm (live data). Returns None when pg_trgm cannot be used."""
    global _trgm_state
    if _trgm_state is False:
        return None
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        out = []
        for kind, table, id_col, name_cols, detail_cols in SOURCES:
            if kind not in kinds:
                continue
            cols = (schema.get(table) or {}).get("columns", {})
            if id_col not in cols or any(c not in cols for c in name_cols):
                continue
            details = [c for c in detail_cols if c in cols]
            if len(name_cols) == 2:
                f, l = _q(name_cols[0]), _q(name_cols[1])
                if single:
                    score = (f"GREATEST(similarity(lower(coalesce({f}, '')), %(t)s), "
                             f"similarity(lower(coalesce({l}, '')), %(t)s))")
                else:
                    score = (f"GREATEST(similarity(lower(concat_ws(' ', {f}, {l})), %(t)s), "
                             f"similarity(lower(concat_ws(' ', {l}, {f})), %(t)s))")
            else:
                score = f"similarity(lower(coalesce({_q(name_cols[0])}, '')), %(t)s)"
            select = ", ".join(_q(c) for c in (id_col, *name_cols, *details))
            cur.execute(f"SELECT * FROM (SELECT {select}, {score} AS trgm_score FROM {_q(table)}) q "
                        f"WHERE trgm_score >= %(c)s ORDER BY trgm_score DESC LIMIT {TRGM_MAX_CANDIDATES}",
                        {"t": text, "c": TRGM_CANDIDATE_CUTOFF})
            for row in cur.fetchall():
                e = _entity_from_row(kind, name_cols, details, row)
                if e.display:
                    out.append(e)
        cur.close()
        _trgm_state = True
        return out
    except Exception as e:
        try:
            if conn is not None:
                conn.rollback()
        except Exception:
            pass
        if getattr(e, "pgcode", None) == "42883":          # undefined function: the pg_trgm extension is not installed
            _trgm_state = False
            log.warning("pg_trgm is not installed in this database (CREATE EXTENSION pg_trgm); using in-memory spelling match")
        else:
            log.warning(f"pg_trgm lookup failed ({str(e).strip().splitlines()[0] if str(e).strip() else e}); using in-memory spelling match")
        return None
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------- resolving a name given as text
def _strip_titles(text):
    toks = [t for t in _norm(text).split() if t not in _TITLES]
    return " ".join(toks)


def resolve_person(text, get_conn, schema, kinds=("user",)) -> Resolution:
    typed = str(text or "").strip()
    t = _strip_titles(typed)
    if not t:
        return Resolution("not_found", typed=typed)
    idx = get_index(get_conn, schema)
    toks = t.split()

    found = []
    for kind in kinds:
        if len(toks) == 1:
            found += idx.by_token.get((kind, t), [])
        else:
            found += idx.by_full.get((kind, t), [])
            if not found:                                 # first + last, ignoring middle names
                found += idx.by_full.get((kind, f"{toks[0]} {toks[-1]}"), [])
        if found:
            break
    found = _distinct(found)
    if len(found) == 1:
        return Resolution("found", found[0], typed=typed)
    if len(found) > 1:
        return Resolution("ambiguous", candidates=found[:MAX_CANDIDATES], typed=typed)

    # ---- spelling-tolerant second step: pg_trgm fetches candidates, difflib scores them ----
    pool_entities = _trgm_entities(get_conn, schema, t, len(toks) == 1, kinds)
    if pool_entities is None:                             # pg_trgm unusable: score everything held in memory
        pool_entities = [e for e in idx.entities if e.kind in kinds]
    elif "company" in kinds:
        pool_entities += [e for e in idx.entities if e.kind == "company"]
    pool = {}
    for e in pool_entities:
        if len(toks) == 1:
            for part in (e.first, e.last):
                if _norm(part):
                    pool.setdefault(_norm(part), []).append(e)
        else:
            pool.setdefault(_norm(e.display), []).append(e)
    scored = sorted(((difflib.SequenceMatcher(None, t, name).ratio(), name) for name in pool), reverse=True)
    scored = [(r, n) for r, n in scored if r >= FUZZY_CUTOFF]
    if not scored:
        return Resolution("not_found", typed=typed)
    best_ratio, best_name = scored[0]
    close = [n for r, n in scored if best_ratio - r < MIN_GAP]
    people = _distinct([e for n in close for e in pool[n]])
    if len(people) == 1:
        return Resolution("found", people[0], corrected=True, typed=typed)
    return Resolution("ambiguous", candidates=people[:MAX_CANDIDATES], typed=typed)


# ---------------------------------------------------------------- scanning a whole question
def scan_question_ex(question, get_conn, schema, max_entities=3):
    """Known names appearing in the question. Returns (entities, ambiguous).

    Exact names first (longest phrase first), then an e-mail address if one is typed, then a typo pass for two-word names
    ("aman jan" -> Aman Jain). ambiguous = [(typed name, [Entity, ...])] when one name belongs to several users or
    contacts (two people called Priya Nair): the caller should ask which one instead of picking the first.
    """
    try:
        idx = get_index(get_conn, schema)
    except Exception:
        return [], []
    found, ambiguous, resolved = [], [], set()

    for m in _EMAIL.findall(str(question or "")):          # an e-mail names exactly one person
        e = idx.emails.get(m.lower())
        if e is not None and all((e.kind, e.id) != (f.kind, f.id) for f in found):
            found.append(e)
            resolved.add(_norm(e.display))

    toks = _norm(question).split()
    used = set()
    for n in range(4, 0, -1):
        for i in range(0, len(toks) - n + 1):
            if any(j in used for j in range(i, i + n)):
                continue
            window = toks[i:i + n]
            if all(w in _STOP or w in _TITLES for w in window):
                continue
            phrase = " ".join(window)
            if phrase in resolved:                          # already chosen through the e-mail address
                used.update(range(i, i + n))
                continue
            hits = []
            for kind in ("user", "contact", "deal", "product", "company"):
                hits += idx.by_full.get((kind, phrase), [])
            if not hits and n == 1 and len(phrase) >= 4 and phrase not in _STOP:
                for kind in ("user", "contact"):
                    hits += idx.by_token.get((kind, phrase), [])
            if not hits:
                continue
            same_kind = _distinct([h for h in hits if h.kind == hits[0].kind])
            if n >= 2 and len(same_kind) > 1 and hits[0].kind in ("user", "contact"):
                ambiguous.append((" ".join(w.capitalize() for w in window), same_kind[:MAX_CANDIDATES]))
                used.update(range(i, i + n))
            elif n >= 2 or len({(h.kind, h.id) for h in hits}) == 1:
                found.append(hits[0])
                used.update(range(i, i + n))
            if len(found) >= max_entities:
                return found, ambiguous

    # ---- typo pass: only two-word phrases, only against full person names ----
    if len(found) < max_entities and not ambiguous:
        keys = [k for (kind, k) in idx.by_full if kind in ("user", "contact")]
        if 0 < len(keys) <= SCAN_FUZZY_MAX_KEYS:
            for i in range(0, len(toks) - 1):
                if i in used or i + 1 in used:
                    continue
                window = toks[i:i + 2]
                if any(len(w) < 3 or w.isdigit() or w in _STOP or w in _TITLES for w in window):
                    continue
                phrase = " ".join(window)
                close = difflib.get_close_matches(phrase, keys, n=2, cutoff=SCAN_FUZZY_CUTOFF)
                if not close:
                    continue
                if len(close) == 2:
                    gap = (difflib.SequenceMatcher(None, phrase, close[0]).ratio()
                           - difflib.SequenceMatcher(None, phrase, close[1]).ratio())
                    if gap < MIN_GAP and close[0] != close[1]:
                        continue                            # two names equally close: do not guess
                ents = _distinct(idx.by_full.get(("user", close[0]), []) or idx.by_full.get(("contact", close[0]), []))
                if len(ents) == 1:
                    found.append(ents[0])
                    used.update((i, i + 1))
                elif len(ents) > 1:
                    ambiguous.append((" ".join(w.capitalize() for w in close[0].split()), ents[:MAX_CANDIDATES]))
                    used.update((i, i + 1))
                if len(found) >= max_entities or ambiguous:
                    break
    return found, ambiguous


def scan_question(question, get_conn, schema, max_entities=3):
    """Known names appearing in the question (entities only; see scan_question_ex for duplicates)."""
    return scan_question_ex(question, get_conn, schema, max_entities)[0]


def facts_for_prompt(entities) -> str:
    lines = []
    for e in entities:
        q = e.id.replace("'", "''")
        if e.kind == "user":
            lines.append(f'- "{e.display}" is a user: "users"."User_ID" = \'{q}\' (the owner of deals is "deals"."Owner_ID" = that User_ID)')
        elif e.kind == "contact":
            lines.append(f'- "{e.display}" is a contact: "contacts"."Contact_ID" = \'{q}\' (deals link via "deals"."Associated_Contact_ID")')
        elif e.kind == "deal":
            lines.append(f'- "{e.display}" is a deal: "deals"."Deal_ID" = \'{q}\'')
        elif e.kind == "product":
            lines.append(f'- "{e.display}" is a product: "products"."Product_ID" = \'{q}\' (deals link via "line_items")')
        elif e.kind == "company":
            lines.append(f'- "{e.display}" is a company: "contacts"."Organization_Name" = \'{q}\'')
    return "\n".join(lines)


def describe(entity) -> str:
    return f"{entity.display} ({entity.kind})"