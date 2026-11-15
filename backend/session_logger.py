"""
session_logger.py -- one log file per chat session for the CloseMore AI Copilot.

For every question it records: the guard decision, routing, every model call (model, purpose, seconds, tokens),
every SQL attempt (SQL text, problems, database runs, rows, errors), document sources, the FULL final answer
and the total latency.

Files (folder LOG_DIR, default "logs" next to server.py):
    session_<YYYYmmdd-HHMMSS>_<session8>.jsonl   one JSON record per question (machine readable)
    session_<YYYYmmdd-HHMMSS>_<session8>.txt     the same records as readable text
    session_<YYYYmmdd>_nosession.jsonl/.txt      questions that arrived without a session id (one pair per day)
    server.log                                   the normal console log, rotated daily (30 days kept)

The frontend creates a session id when the page loads and again when "Clear conversation" is pressed.
The logs contain CRM names, SQL and answers: keep the logs folder out of Git and decide how long to keep it.
Logging never breaks a request: any problem writing a log is reported as a warning and ignored.
"""

import contextvars
import glob
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime
from logging.handlers import TimedRotatingFileHandler

LOG_DIR = os.environ.get("LOG_DIR", "logs")
_SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_current = contextvars.ContextVar("question_log", default=None)
_lock = threading.Lock()
_bases = {}           # session key -> file path without extension
_log = logging.getLogger("copilot")


class QuestionLog:
    def __init__(self, session_id, question, history_turns):
        self.session_id = session_id if isinstance(session_id, str) and _SID_RE.match(session_id) else None
        self.request_id = uuid.uuid4().hex[:8]
        self.question = question
        self.history_turns = history_turns
        self.started = time.time()
        self.started_iso = datetime.now().astimezone().isoformat(timespec="seconds")
        self.events = []
        self.fields = {}

    def event(self, kind, **data):
        self.events.append({"t_ms": int((time.time() - self.started) * 1000), "kind": kind, **data})

    def note(self, **kv):
        self.fields.update(kv)


# ---------------- per-question API (uses a context variable, so no object has to be passed around) ----------------
def start(session_id, question, history_turns=0):
    rec = QuestionLog(session_id, question, history_turns)
    _current.set(rec)
    return rec


def current():
    return _current.get()


def log_event(kind, **data):
    rec = _current.get()
    if rec is not None:
        rec.event(kind, **data)


def note(**kv):
    rec = _current.get()
    if rec is not None:
        rec.note(**kv)


def finish(rec, route, answer, sql=None, sql_error=None, outcome="ok"):
    record = {
        "time": rec.started_iso,
        "session_id": rec.session_id or "nosession",
        "request_id": rec.request_id,
        "question": rec.question,
        "history_turns": rec.history_turns,
        "route": route,
        "outcome": outcome,
        "total_ms": int((time.time() - rec.started) * 1000),
        "answer": answer,
        "sql": sql,
        "sql_error": sql_error,
        **rec.fields,
        "events": rec.events,
    }
    try:
        _write(rec.session_id, record)
    except Exception as e:                       # never break a request because of logging
        _log.warning(f"could not write the session log: {e}")
    _current.set(None)
    return record


# ---------------- files ----------------
def _base_path(session_id):
    today = datetime.now().strftime("%Y%m%d")
    key = session_id or f"nosession-{today}"
    base = _bases.get(key)
    if base:
        return base
    os.makedirs(LOG_DIR, exist_ok=True)
    if session_id:
        suffix = session_id[:8]
        existing = sorted(glob.glob(os.path.join(LOG_DIR, f"session_*_{suffix}.jsonl")))
        base = existing[-1][:-len(".jsonl")] if existing else os.path.join(
            LOG_DIR, f"session_{datetime.now().strftime('%Y%m%d-%H%M%S')}_{suffix}")
    else:
        base = os.path.join(LOG_DIR, f"session_{today}_nosession")
    _bases[key] = base
    return base


def _write(session_id, record):
    with _lock:
        base = _base_path(session_id)
        with open(base + ".jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        with open(base + ".txt", "a", encoding="utf-8") as f:
            f.write(render_text(record))


def _fmt_value(v):
    return json.dumps(v, ensure_ascii=False, default=str) if not isinstance(v, str) else v


def render_text(r):
    when = r["time"].replace("T", " ")[:19]
    out = ["=" * 78,
           f"[{when}]  request {r['request_id']}   session {r['session_id'][:8]}",
           f"QUESTION: {r['question']}"]
    if r.get("effective_question"):
        out.append(f"  (understood as: {r['effective_question']})")
    out.append(f"route: {r['route']}   outcome: {r['outcome']}   total: {r['total_ms'] / 1000:.1f}s   "
               f"history turns: {r['history_turns']}")
    out.append("-" * 78)
    for e in r["events"]:
        inline, block = [], []
        for k, v in e.items():
            if k in ("t_ms", "kind"):
                continue
            s = _fmt_value(v)
            (block if (len(s) > 70 or "\n" in s) else inline).append((k, s))
        head = f"+{e['t_ms'] / 1000:6.1f}s  {e['kind']}"
        if inline:
            head += "  " + "  ".join(f"{k}={s}" for k, s in inline)
        out.append(head)
        for k, s in block:
            out.append(f"            {k}: {s}")
    out.append("-" * 78)
    out.append("ANSWER:")
    out.append(r["answer"])
    out.append("")
    return "\n".join(out) + "\n"


# ---------------- server console log -> file ----------------
def server_log_handler():
    """A daily-rotating file handler for the normal console log, or None if the folder is not writable."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        h = TimedRotatingFileHandler(os.path.join(LOG_DIR, "server.log"), when="midnight", backupCount=30, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        return h
    except Exception as e:
        print(f"WARNING: server.log could not be created: {e}")
        return None
