"""
session_store.py -- chat history kept on the SERVER, in a compact form, keyed by the frontend's session_id.

Why: the browser's `history` is plain text, untrusted, and limited to a few messages. A long answer (a 50-row result) would
eat the model's context. Here every finished turn is stored as ONE short line built by code (question, route, row count,
column names, the people/deals it was about, the first value), so 4-6 turns cost only a few hundred tokens whatever the
answers looked like. The browser's `history` is still read for the "Shall I try again?" flow and as a fallback.

Also kept per session:
  - the names mentioned so far (so "his deals" can be resolved even when the turn that named him is older),
  - a pending "which one did you mean?" question with its candidates, and match_choice() to read the reply
    (an e-mail address, "the second one", "all", or a word from the candidate's details).

In memory only (a restart empties it; the browser history then serves as the fallback). Bounded: STORE_TURNS per session,
MAX_SESSIONS sessions, TTL_SECONDS idle time.
"""

import re
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field

SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
STORE_TURNS = 30
MAX_ENTITIES = 12
MAX_SESSIONS = 1000
TTL_SECONDS = 6 * 3600
PENDING_TTL_SECONDS = 1800


def valid_id(session_id):
    return session_id if isinstance(session_id, str) and SID_RE.match(session_id) else None


def _clip(text, n):
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


@dataclass
class TurnSummary:
    question: str                               # the standalone question that was answered
    route: str = ""                             # SQL | RAG | CHAT | BOTH
    status: str = ""                            # rows | empty | failed | not_found | ambiguous | ok ...
    names: list = field(default_factory=list)   # people / deals the turn was about
    columns: list = field(default_factory=list) # visible column names (no IDs)
    rows: int = 0
    top: str = ""                               # first value of the first row, e.g. a deal name
    note: str = ""                              # short free text (start of a document or chat answer)

    def line(self, full=True) -> str:
        q = _clip(self.question, 160)
        if not full:
            return f"Q: {q}" + (f" (about: {', '.join(self.names)})" if self.names else "")
        bits = [self.route or "?"]
        if self.status and self.status not in ("rows", "ok"):
            bits.append(self.status.replace("_", " "))
        if self.rows:
            bits.append(f"{self.rows} row{'s' if self.rows != 1 else ''}")
        parts = [", ".join(bits)]
        if self.columns:
            parts.append("columns: " + ", ".join(self.columns[:6]))
        if self.names:
            parts.append("about: " + ", ".join(self.names))
        if self.top:
            parts.append("first: " + _clip(self.top, 60))
        if self.note:
            parts.append("answer: " + _clip(self.note, 90))
        return f"Q: {q} -> " + "; ".join(parts)


class _Session:
    def __init__(self):
        self.turns = deque(maxlen=STORE_TURNS)
        self.entities = OrderedDict()           # (kind, id) -> display name, most recent last
        self.pending = None
        self.last_used = time.time()
        self.answered = 0                       # answered turns so far (the deque above is capped)
        self.people, self.people_turn = None, -1   # letters of the last answer about several people / deals
        self.letters = None                     # the whole latest choice list (picked or not), by letter


_lock = threading.Lock()
_sessions = OrderedDict()


def _touch(sid, create=False):
    now = time.time()
    s = _sessions.get(sid)
    if s is not None and now - s.last_used > TTL_SECONDS:
        del _sessions[sid]
        s = None
    if s is None:
        if not create:
            return None
        while len(_sessions) >= MAX_SESSIONS:
            _sessions.popitem(last=False)       # drop the least recently used
        s = _sessions[sid] = _Session()
    s.last_used = now
    _sessions.move_to_end(sid)
    return s


def remember(sid, summary: TurnSummary, entities=()):
    """entities: iterable of (kind, id, display)."""
    if not valid_id(sid):
        return
    with _lock:
        s = _touch(sid, create=True)
        s.turns.append(summary)
        s.answered += 1
        for kind, eid, display in entities:
            key = (kind, str(eid))
            s.entities.pop(key, None)
            s.entities[key] = display
        while len(s.entities) > MAX_ENTITIES:
            s.entities.popitem(last=False)


def history_lines(sid, total=6, full=3):
    """The last `total` turns, oldest first: the newest `full` as full lines, the older ones as short lines."""
    if not valid_id(sid):
        return []
    with _lock:
        s = _touch(sid)
        turns = list(s.turns)[-total:] if s else []
    cut = max(0, len(turns) - full)
    return [t.line(full=(i >= cut)) for i, t in enumerate(turns)]


def mentioned(sid, limit=8):
    """Display names of the people/deals named so far in this session, most recent last."""
    if not valid_id(sid):
        return []
    with _lock:
        s = _touch(sid)
        names = list(dict.fromkeys(s.entities.values())) if s else []
    return names[-limit:]


def mentioned_ids(sid):
    """(kind, id) of the people/deals named so far in this session, most recent last."""
    if not valid_id(sid):
        return []
    with _lock:
        s = _touch(sid)
        return list(s.entities.keys()) if s else []


def set_people(sid, people, table=None):
    """people: the latest answer about several people / deals (A = ..., C = ...). table: a NEW choice list (every
    letter offered, picked or not); it replaces the old one only when given. Call AFTER remember()."""
    if not valid_id(sid) or not (people or table):
        return
    with _lock:
        s = _touch(sid, create=True)
        if people:
            s.people, s.people_turn = [dict(p) for p in people], s.answered
        if table:
            s.letters = [dict(p) for p in table]


def get_letters(sid):
    """The whole latest choice list by letter (empty list when none)."""
    if not valid_id(sid):
        return []
    with _lock:
        s = _touch(sid)
        return [dict(p) for p in (s.letters or [])] if s else []


def get_people(sid):
    """(people, from_last_answer). Letters stay usable until a new list replaces them; "their / them" only counts
    when the very last answer was that list."""
    if not valid_id(sid):
        return None, False
    with _lock:
        s = _touch(sid)
        if s is None or not s.people:
            return None, False
        return [dict(p) for p in s.people], s.people_turn == s.answered


def turn_count(sid):
    with _lock:
        s = _touch(sid) if valid_id(sid) else None
        return len(s.turns) if s else 0


def clear(sid):
    with _lock:
        _sessions.pop(sid, None)


def reset_all():
    with _lock:
        _sessions.clear()


# ---------------------------------------------------------------- "which one did you mean?"
def set_pending(sid, pending: dict):
    """pending = {"question", "route", "typed", "candidates": [{"kind","id","display","detail","first","last"}]}"""
    if not valid_id(sid):
        return
    with _lock:
        s = _touch(sid, create=True)
        s.pending = dict(pending, created=time.time())


def pop_pending(sid):
    """Returns and clears the pending question. Any next message ends the clarification, answered or not."""
    if not valid_id(sid):
        return None
    with _lock:
        s = _touch(sid)
        if s is None or s.pending is None:
            return None
        p, s.pending = s.pending, None
    return p if time.time() - p.get("created", 0) <= PENDING_TTL_SECONDS else None


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ORDINAL = {"first": 0, "1st": 0, "1": 0, "second": 1, "2nd": 1, "2": 1, "third": 2, "3rd": 2, "3": 2,
            "fourth": 3, "4th": 3, "4": 3, "fifth": 4, "5th": 4, "5": 4, "last": -1}
_ALL = {"all", "both", "every", "each", "everyone", "everybody"}
_FILLER = {"the", "a", "an", "one", "ones", "of", "them", "please", "user", "users", "person", "people", "persons", "named",
           "name", "entry", "entries", "match", "matches", "yes", "ok", "okay", "i", "mean", "meant", "want", "with", "for",
           "is", "it", "that", "this", "those", "these", "and", "number", "no", "pick", "choose", "select", "go", "take",
           "use", "show", "me", "id", "email", "mail", "address", "e"}


_CHOICE_SPLIT = re.compile(r"\s*(?:,|&|/|\+|\band\b|\s)\s*")


def match_letters(reply, count):
    """"A", "a, c", "A and C", "1,3", "1 and 3" -> list of indexes. None = not a list of letters/numbers (read it some
    other way). "invalid" = it is such a list but names a choice that was not offered (ask again)."""
    text = str(reply or "").strip().lower().rstrip(".!")
    text = re.sub(r"^(?:option|options|choice|choices|pick|select|show)\s+", "", text)
    if not text or not re.fullmatch(r"[a-z0-9]+(?:\s*(?:,|&|/|\+|\band\b|\s)\s*[a-z0-9]+)*", text):
        return None
    parts = [p for p in _CHOICE_SPLIT.split(text) if p and p != "and"]
    if not parts or not all((len(p) == 1 and p.isalpha()) or (p.isdigit() and len(p) <= 2) for p in parts):
        return None
    out = []
    for p in parts:
        i = int(p) - 1 if p.isdigit() else ord(p) - ord("a")
        if not 0 <= i < count:
            return "invalid"
        if i not in out:
            out.append(i)
    return out


def match_choice(reply, candidates, typed=""):
    """Reads the answer to a "which one?" question. Returns the list of chosen candidate indexes, or None when the reply
    is not an answer to it (it is then treated as a new question)."""
    text = str(reply or "").lower().strip()
    if not text or not candidates or len(text.split()) > 10:
        return None
    emails = _EMAIL.findall(text)
    def _parts(c):
        return [p.strip() for p in str(c.get("detail", "")).lower().split(",")]
    hits = [i for i, c in enumerate(candidates) if any(e in _parts(c) for e in emails)]      # the exact address
    if not hits:
        hits = [i for i, c in enumerate(candidates) if any(e in str(c.get("detail", "")).lower() for e in emails)]
    rest = _EMAIL.sub(" ", text)
    typed_tokens = set(re.findall(r"[a-z0-9]+", str(typed).lower()))
    tokens = [t for t in re.findall(r"[a-z0-9]+", rest) if t not in _FILLER and t not in typed_tokens]
    if emails and not tokens:
        return hits[:1] if len(hits) >= 1 else None
    if not tokens:
        return None
    if all(t in _ALL for t in tokens):
        return list(range(len(candidates)))
    if len(tokens) == 1 and tokens[0].isdigit():            # "3" -> the third candidate (any list length)
        i = int(tokens[0]) - 1
        return [i] if 0 <= i < len(candidates) else None
    if len(tokens) == 1 and tokens[0] in _ORDINAL:
        i = _ORDINAL[tokens[0]]
        i = len(candidates) - 1 if i == -1 else i
        return [i] if 0 <= i < len(candidates) else None
    # a word from the candidate's details ("taw", "executive_manager") that fits exactly one of them
    detail_hits = [i for i, c in enumerate(candidates)
                   if all(t in str(c.get("detail", "")).lower() for t in tokens)]
    return detail_hits if len(detail_hits) == 1 else None
