"""
conversation.py -- chat-history handling for the demo (history is kept in the browser and sent with each question).

Pure Python, no model calls. Provides:
  - sanitize_history()      untrusted history from the browser -> short, clean list of turns
  - pending_offer()         did our last message offer "Shall I try again?" -> (original question, earlier turns)
  - closing_context()       did our last message close a failed retry      -> the failed question
  - is_yes / is_no / is_retry_request / same_question
  - looks_like_followup()   cheap rule: does this message need a rewrite?
  - build_rewrite_prompt() / parse_rewrite()   for the fine-tuned model to make a follow-up standalone
  - fixed user-facing messages
"""

import re
from dataclasses import dataclass

# ---------------- fixed messages (also used as markers when reading history) ----------------
OFFER_SENTENCE = "Shall I try again? (yes/no)"
CLOSING_SENTENCE = "I tried again but still couldn't answer this question. Please rephrase it, or ask your admin to look into it."
REPEAT_REPLY = "I've already tried this question twice and couldn't answer it reliably. Please rephrase it, or ask me something else."
DECLINED_REPLY = "Okay, I won't retry. Feel free to ask me something else."
INTERPRETED_PREFIX = "Interpreted as:"

EMPTY_MSG = "No matching records were found for your question."
FAILED_MSG = "I couldn't build a reliable query to answer this question."
SYSTEM_MSG = "A system problem stopped me from answering."
UNAVAILABLE_MSG = "The AI model server isn't reachable right now, so I can't answer. Please try again in a minute."
TIMEOUT_MSG = "The AI model took too long to answer. Please try again in a moment."
DB_UNAVAILABLE_MSG = "The CRM database isn't reachable right now, so I can't answer. Please try again in a minute."
NO_DOCS_MSG ="I couldn't find anything relevant to this in the uploaded documents."
NOTHING_TO_RETRY = "Tell me which question you'd like me to look into again, or rephrase it and I'll take another look."

MAX_TURNS = 8            # last 4 exchanges
MAX_USER_CHARS = 400
MAX_ASSISTANT_CHARS = 600
MAX_REWRITE_CHARS = 300
MAX_FOLLOWUP_WORDS = 8   # pronoun / reference words only count in short messages


@dataclass
class Turn:
    role: str
    content: str
    is_offer: bool = False
    is_closing: bool = False


def _norm(text: str) -> str:
    t = re.sub(r"\s+", " ", str(text).lower()).strip()
    return re.sub(r"[\s.!?,]+$", "", t)


# ---------------- history ----------------
def sanitize_history(raw) -> list:
    """Accepts a list of dicts or objects with role/content. Treats everything as untrusted."""
    turns = []
    for item in list(raw or [])[-(MAX_TURNS * 3):]:
        role = item.get("role") if isinstance(item, dict) else getattr(item, "role", None)
        content = item.get("content") if isinstance(item, dict) else getattr(item, "content", None)
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        flags = (role == "assistant" and OFFER_SENTENCE in content,
                 role == "assistant" and CLOSING_SENTENCE in content)
        lines = [ln for ln in content.splitlines()
                 if not ln.strip().startswith(INTERPRETED_PREFIX) and not ln.strip().startswith("|")]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        limit = MAX_USER_CHARS if role == "user" else MAX_ASSISTANT_CHARS
        if len(text) > limit:
            text = text[:limit].rstrip() + "..."
        if text:
            turns.append(Turn(role, text, flags[0], flags[1]))
    return turns[-MAX_TURNS:]


def _preceding_user_index(turns, idx):
    for k in range(idx - 1, -1, -1):
        if turns[k].role == "user":
            return k
    return None


def pending_offer(turns):
    """If our last message offered a retry: returns (original_user_question, turns_before_it) else None."""
    if not turns or turns[-1].role != "assistant" or not turns[-1].is_offer:
        return None
    k = _preceding_user_index(turns, len(turns) - 1)
    if k is None:
        return None
    return turns[k].content, turns[:k]


def closing_context(turns):
    """If our last message was the closing 'tried again, still failed' message: returns the failed question else None."""
    if not turns or turns[-1].role != "assistant" or not turns[-1].is_closing:
        return None
    k = _preceding_user_index(turns, len(turns) - 1)
    return turns[k].content if k is not None else ""


# ---------------- yes / no / retry ----------------
_YES = re.compile(r"^(?:yes|yeah|yep|yup|ya|yea|y|sure|ok|okay|go ahead|please do|do it|please)"
                  r"(?:\s*,?\s*please)?"
                  r"(?:\s*,?\s*(?:please\s+)?(?:try|retry|go ahead)(?:\s+(?:it\s+)?again)?)?$")
_RETRY = re.compile(r"^(?:please\s+)?(?:can you\s+|could you\s+)?(?:try|retry|run)(?:\s+(?:it|that|this|the question))?"
                    r"(?:\s+(?:once more|again|one more time))?(?:\s+please)?$|^(?:again|once more|one more time|retry)$")
_NO = re.compile(r"^(?:no|nope|nah|n|no thanks|no thank you|don't|do not|cancel|stop|never ?mind|not now|skip)(?:\s+please)?$")


def is_yes(text: str) -> bool:
    t = _norm(text)
    return bool(_YES.match(t) or _RETRY.match(t))


def is_no(text: str) -> bool:
    return bool(_NO.match(_norm(text)))


def is_retry_request(text: str) -> bool:
    return is_yes(text)


def is_retry_phrase(text: str) -> bool:
    """'try again', 'retry', 'once more' ... (NOT a plain 'yes' / 'ok')."""
    return bool(_RETRY.match(_norm(text)))


def last_outcome(turns, question: str):
    """How did the most recent time THIS question was asked end? 'closed' | 'offered' | 'ok' | None."""
    events, cur = [], None
    for t in turns:
        if t.role == "user":
            if is_yes(t.content) or is_no(t.content):
                continue                                  # answer to an offer, not a new question
            cur = {"q": t.content, "closing": False, "offer": False}
            events.append(cur)
        elif cur is not None:
            if t.is_closing:
                cur["closing"] = True
            if t.is_offer:
                cur["offer"] = True
            elif t.content != DECLINED_REPLY:
                cur["offer"] = False                      # a normal answer after the offer settles it
    for ev in reversed(events):
        if same_question(ev["q"], question):
            return "closed" if ev["closing"] else ("offered" if ev["offer"] else "ok")
    return None


def same_question(a: str, b: str) -> bool:
    return bool(a) and bool(b) and _norm(a) == _norm(b)


# ---------------- follow-up detection and rewrite ----------------
_SMALLTALK = re.compile(r"^(?:hi+|hello+|hey+|thanks?|thank you|thx|ok(?:ay)?|cool|great|bye|goodbye|good (?:morning|afternoon|evening))$")
_FOLLOW_START = re.compile(r"^(?:then|and|also|so|but|what about|how about|and what|what else|why|how so|ok so|okay so)\b")
_PRONOUNS = {"it", "its", "they", "them", "their", "those", "these", "he", "she", "his", "her", "him"}
_REFERENCE = re.compile(r"\b(above|previous|earlier|same|second|third|first one|last one|former|latter|the other)\b")


def looks_like_followup(text: str) -> bool:
    t = _norm(text)
    if not t or _SMALLTALK.match(t):
        return False
    if _FOLLOW_START.match(t):
        return True
    words = re.findall(r"[a-z']+", t)
    if len(words) > MAX_FOLLOWUP_WORDS:
        return False        # long messages are almost always self-contained ("... including their first name ...")
    return bool(_REFERENCE.search(t)) or any(w in _PRONOUNS for w in words)


def build_rewrite_prompt(turns, question: str) -> str:
    lines = []
    for t in turns[-6:]:
        who = "User" if t.role == "user" else "Assistant"
        lines.append(f"{who}: {t.content[:300]}")
    convo = "\n".join(lines) if lines else "(none)"
    return f"""Rewrite the user's LAST MESSAGE as ONE standalone question that can be understood without the conversation.
Replace pronouns and references (it, they, that one, "the second one", "then") with what they refer to, using the conversation.
Keep the meaning AND the key detail the follow-up depends on (a contrast such as "instead of AWS", a time period, a name). Do NOT generalize it.
Do NOT answer it. Do NOT add new requests or details. If the message is already standalone, output it unchanged.
Output ONLY the question on a single line.

Example
Conversation:
User: Does the on-prem infrastructure use AWS?
Assistant: No, it does not use AWS.
LAST MESSAGE: then it uses what?
Standalone question: What does the on-prem infrastructure use instead of AWS?

Now the real conversation.

Conversation:
{convo}

LAST MESSAGE: {question}

Standalone question:"""


def parse_rewrite(raw: str, original: str):
    """Returns (question_to_use, changed). Falls back to the original on anything odd."""
    line = next((ln.strip() for ln in str(raw).splitlines() if ln.strip()), "")
    line = re.sub(r"^(?:standalone question|question)\s*:\s*", "", line, flags=re.I).strip().strip('"').strip("'").strip()
    if not line or len(line) > MAX_REWRITE_CHARS or line.lower() == "unchanged":
        return original, False
    if _norm(line) == _norm(original):
        return original, False
    return line, True