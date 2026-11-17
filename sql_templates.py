"""
sql_templates.py -- fixed, reviewed SQL for the questions people ask most. No model call, answered in milliseconds.

A question uses a template only when (1) it matches a template's pattern AND (2) every word of the question is either
part of that template's vocabulary or a harmless filler word. Any extra word (another filter such as "for Acme",
"in Mumbai") means the template could silently ignore part of the question, so it is NOT used and the question goes to
the normal SQL model instead.

match(question) -> Match | None.  For person templates the caller resolves the name (entity_lookup) and calls
match.build(entity) to get the SQL. All generated SQL still passes the safety validator, the schema check and
PostgreSQL EXPLAIN before it runs; if anything is off the caller falls back to the SQL model.
"""

import re
from dataclasses import dataclass
from typing import Callable, Optional

_COMMON_RAW = """a an the me my our us please show tell give list display get find what which who is are was were do does
did have has can you i we all each every of for in on at to from with along and or by per it its their there this that
how many much also kindly details info information about s any some crm data database db record records system"""
_TITLES = {"sir", "mr", "mrs", "ms", "dr", "madam", "mam", "maam", "ji"}


def _n(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


_COMMON = {_n(w) for w in _COMMON_RAW.split()}


def _vocab(words: str):
    return {_n(w) for w in words.split()}


def lit(value) -> str:
    return "'" + str(value).replace("'", "''") + "'"


@dataclass
class Match:
    name: str
    sql: Optional[str] = None
    needs_person: bool = False
    person_text: str = ""
    person_kinds: tuple = ("user",)
    build: Optional[Callable] = None        # build(entity) -> sql, for person templates
    empty_is_final: bool = True             # False: zero rows is not trusted, fall back to the SQL model
    not_found_is_final: bool = True         # False: the name may not be a CRM user (a company...): use the SQL model
    self_ref: bool = False                  # True: build(entity) with the person ASKING (the logged-in user)


_SOURCE_TAIL = re.compile(r"\s+(?:from|in|using|via|inside|according to|as per)\s+(?:the\s+|our\s+|my\s+)?"
                          r"(?:crm|database|db|system)(?:\s+(?:data|records|database))?$")


def _prep(question: str) -> str:
    q = question.lower().replace("\u2019", "'").replace("`", "'").strip()
    q = re.sub(r"[\s]+", " ", q)
    q = re.sub(r"[?.!,;:\s]+$", "", q)
    # "... from CRM data" only names the data source (every template already reads the CRM): drop it before matching
    return re.sub(r"[?.!,;:\s]+$", "", _SOURCE_TAIL.sub("", q))


def _tokens(q: str):
    return re.findall(r"[a-z0-9]+", q)


def _covered(tokens, vocab, slot_text="") -> bool:
    slot = {_n(t) for t in _tokens(slot_text)} | _TITLES
    return all(t.isdigit() or _n(t) in vocab or _n(t) in _COMMON or _n(t) in slot for t in tokens)


def _clean_name(raw: str) -> str:
    name = raw.strip(" .'-")
    name = re.sub(r"'s$", "", name)
    name = re.sub(r"\b(?:currently|right now|now|today|please|sir|mam|madam|all|every|complete|full|entire|whole)\b\s*$", "", name).strip()
    return name


# ---------------------------------------------------------------- templates without a person
def _owner_deal_counts():
    return ('SELECT u."First_Name", u."Last_Name", COUNT(d."Deal_ID") AS "Deals" FROM "deals" d '
            'JOIN "users" u ON u."User_ID" = d."Owner_ID" GROUP BY u."User_ID", u."First_Name", u."Last_Name" '
            'ORDER BY "Deals" DESC, u."First_Name"')


def _top_owners(n):
    return ('SELECT u."First_Name", u."Last_Name", COALESCE(SUM(d."Deal_Value"), 0) AS "Total_Deal_Value" FROM "deals" d '
            'JOIN "users" u ON u."User_ID" = d."Owner_ID" GROUP BY u."User_ID", u."First_Name", u."Last_Name" '
            f'ORDER BY "Total_Deal_Value" DESC LIMIT {n}')


_DIMENSIONS = {"stage": "Current_Stage", "status": "Status", "deal type": "Deal_Type", "type": "Deal_Type",
               "sale type": "Sale_Type", "source": "Deal_Source", "region": "Region", "territory": "Territory_Name"}
_PERIODS = {
    "this month": ("DATE_TRUNC('month', CURRENT_DATE)", "DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'"),
    "current month": ("DATE_TRUNC('month', CURRENT_DATE)", "DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'"),
    "next month": ("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'", "DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 months'"),
    "last month": ("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'", "DATE_TRUNC('month', CURRENT_DATE)"),
    "previous month": ("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'", "DATE_TRUNC('month', CURRENT_DATE)"),
    "this quarter": ("DATE_TRUNC('quarter', CURRENT_DATE)", "DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months'"),
    "current quarter": ("DATE_TRUNC('quarter', CURRENT_DATE)", "DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months'"),
    "next quarter": ("DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months'", "DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '6 months'"),
    "this year": ("DATE_TRUNC('year', CURRENT_DATE)", "DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year'"),
    "current year": ("DATE_TRUNC('year', CURRENT_DATE)", "DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year'"),
}
_VALUE_WORDS = re.compile(r"\b(value|worth|amount|revenue|total|sum)\b")

_V_COUNTS = _vocab("deal owner how many number count per by each every does do have has wise")
_V_TOP = _vocab("owner total sum top highest lowest ordered order rank ranked sorted biggest best deal value worth amount revenue by "
                "from to including include their first last name names and")
_V_GROUP = _vocab("deal how many number count by per each every grouped group wise breakdown split across stage status type sale source "
                  "region territory value worth amount revenue total sum")
_V_CLOSING = _vocab("deal closing close closes due expected date this current next last previous month quarter year")
_V_CONTACTS = _vocab("deal contact associated name each along and their primary")
_V_OWNERS = _vocab("deal name owner and their each")
_V_TOTAL = _vocab("total deal value sum how much worth pipeline overall combined")
_V_COUNT = _vocab("how many number count deal are there do we have total exist currently")
_V_NAME_CONTAINS = _vocab("deal whose with having name contain includes include like is starts start")


def _match_plain(q: str, tokens) -> Optional[Match]:
    has = lambda w: any(_n(t) == _n(w) for t in tokens)
    counting = bool(re.search(r"\b(?:how many|number of|count)\b", q))

    # deals per owner
    if has("owner") and has("deal") and not _VALUE_WORDS.search(q) and (
            counting or re.search(r"\b(?:per|by|each|every)\s+owner\b|\bowner[- ]wise\b", q)) \
            and _covered(tokens, _V_COUNTS):
        return Match("owner_deal_counts", sql=_owner_deal_counts())

    # top / ordered owners by total deal value
    if has("owner") and _VALUE_WORDS.search(q) and re.search(r"\b(total|sum|top|highest|ordered|rank\w*|sorted|biggest|best)\b", q) \
            and _covered(tokens, _V_TOP):
        m = re.search(r"\btop\s+(\d{1,2})\b", q)
        n = max(1, min(50, int(m.group(1)))) if m else (5 if re.search(r"\btop\b", q) else 50)
        return Match("top_owners_by_value", sql=_top_owners(n))

    # deals grouped by a category column
    if has("deal"):
        m = re.search(r"\b(?:by|per|each|every|grouped by|group by|breakdown by|split by|across)\s+(?:the\s+)?"
                      r"(stage|status|deal type|sale type|type|source|region|territory)s?\b|\b(stage|status|region|source)[- ]wise\b", q)
        if m and _covered(tokens, _V_GROUP):
            dim = _DIMENSIONS[(m.group(1) or m.group(2)).strip()]
            if _VALUE_WORDS.search(q):
                return Match("deals_grouped", sql=(f'SELECT d."{dim}" AS "{dim}", COALESCE(SUM(d."Deal_Value"), 0) AS "Total_Deal_Value" '
                                                   f'FROM "deals" d GROUP BY d."{dim}" ORDER BY "Total_Deal_Value" DESC'))
            return Match("deals_grouped", sql=(f'SELECT d."{dim}" AS "{dim}", COUNT(*) AS "Deals" FROM "deals" d '
                                               f'GROUP BY d."{dim}" ORDER BY "Deals" DESC'))

    # deals closing in a period
    pm = re.search(r"\b(this month|current month|next month|last month|previous month|this quarter|current quarter|next quarter|this year|current year)\b", q)
    if pm and has("deal") and re.search(r"\b(clos(?:ing|e|es)|due|expected)\b", q) and not re.search(r"\bclosed\b", q) \
            and _covered(tokens, _V_CLOSING):
        start, end = _PERIODS[pm.group(1)]
        return Match("deals_closing", sql=('SELECT d."Deal_Name", d."Current_Stage", d."Deal_Value", '
                                           'd."Expected_Close_Date"::date AS "Expected_Close_Date" FROM "deals" d '
                                           f'WHERE d."Expected_Close_Date"::date >= {start} AND d."Expected_Close_Date"::date < {end} '
                                           'ORDER BY d."Expected_Close_Date"::date'))

    # deals with contacts / owners
    if has("deal") and has("contact") and not counting and _covered(tokens, _V_CONTACTS):
        return Match("deals_with_contacts", sql=('SELECT d."Deal_Name", c."First_Name", c."Last_Name" FROM "deals" d '
                                                 'LEFT JOIN "contacts" c ON c."Contact_ID" = d."Associated_Contact_ID" ORDER BY d."Deal_Name"'))
    if has("deal") and has("owner") and not counting and _covered(tokens, _V_OWNERS):
        return Match("deals_with_owner", sql=('SELECT d."Deal_Name", u."First_Name", u."Last_Name" FROM "deals" d '
                                              'LEFT JOIN "users" u ON u."User_ID" = d."Owner_ID" ORDER BY d."Deal_Name"'))

    # deal name search
    m = re.search(r"\bdeals?\s+(?:whose\s+|with\s+|having\s+)?(?:the\s+)?name\s+(?:contains?|has|includes?|like|is|starts? with)\s+(?P<text>.+)$", q)
    if m:
        text = re.sub(r"[%_\"']", "", m.group("text")).strip()
        if text and len(text) <= 60 and _covered(tokens[: len(tokens) - len(_tokens(m.group("text")))], _V_NAME_CONTAINS):
            return Match("deals_name_contains", sql=('SELECT d."Deal_Name", d."Current_Stage", d."Status", d."Deal_Value" FROM "deals" d '
                                                     f'WHERE d."Deal_Name" ILIKE {lit("%" + text + "%")} ORDER BY d."Deal_Name"'))

    # totals
    if re.search(r"\btotal\b.*\bdeal value\b|\bsum of (?:all )?deal value|\bhow much\b.*\bdeals?\b.*\b(?:worth|value)", q) \
            and not has("owner") and _covered(tokens, _V_TOTAL):
        return Match("total_deal_value", sql='SELECT COALESCE(SUM(d."Deal_Value"), 0) AS "Total_Deal_Value" FROM "deals" d')
    if counting and has("deal") and _covered(tokens, _V_COUNT):
        return Match("count_deals", sql='SELECT COUNT(*) AS "Deals" FROM "deals"')
    return None


# ---------------------------------------------------------------- templates with a person
_NAME = r"(?P<name>[a-z][a-z.'\- ]{1,40}?)"
_WORKING = r"(?:currently\s+)?(?:working on|handling|managing|responsible for|looking after)"
_DEAL_PATTERNS = [
    rf"\bwhat\s+(?:deals?\s+)?(?:is|are)\s+{_NAME}\s+{_WORKING}$",
    rf"\bwhat\s+{_NAME}\s+(?:is|are)\s+{_WORKING}$",
    rf"\b(?:on\s+)?(?:what|which)\s+deals?\s+(?:is\s+|are\s+)?{_NAME}\s+(?:is\s+|are\s+)?{_WORKING}$",
    rf"\bdeals?\b.{{0,30}}?\b(?:owned by|owns? by|assigned to|handled by|managed by|belonging to)\s+(?P<name>[a-z][a-z.'\- ]{{1,40}})$",
    rf"\bdeals?\s+(?:that\s+|which\s+)?{_NAME}\s+owns?$",
    rf"\bdeals?\s+with\s+{_NAME}\s+as\s+(?:the\s+)?owner$",
    rf"^{_NAME}'s\s+deals?$",
    rf"\bdeals?\s+of\s+(?P<name>[a-z][a-z.'\- ]{{1,40}})$",
    rf"^(?:show|list|get|give|display)(?:\s+me)?(?:\s+(?:all|the))?\s+{_NAME}(?:'s)?\s+deals?(?:\s+(?:data|details|info|information|list))?$",
    rf"^{_NAME}(?:'s)?\s+deals?\s+(?:data|details|info|information|list)$",
]
_OVERVIEW_PATTERNS = [   # "show Priya Nair data", "Priya Nair details", "tell me about Priya Nair", "who is Priya Nair"
    rf"^(?:show|give|get|display)(?:\s+me)?(?:\s+(?:all|the))?\s+{_NAME}(?:'s)?\s+(?:data|details|info|information|profile|summary|overview)$",
    rf"^{_NAME}(?:'s)?\s+(?:data|details|info|information|profile|summary|overview)$",
    rf"^tell\s+(?:me\s+)?about\s+{_NAME}$",
    rf"^(?:show|give|get|display)(?:\s+me)?(?:\s+(?:all|the|complete|full|entire|whole))?\s+(?:data|details|info|information|profile|overview|summary)"
    rf"\s+(?:of|for|about|on)\s+(?:(?:all|every|both)\s+(?:the\s+)?)?{_NAME}$",
    rf"^(?:show\s+|tell\s+)?(?:me\s+)?everything\s+(?:about|on|of|for)\s+(?:(?:all|every|both)\s+(?:the\s+)?)?{_NAME}$",
    rf"^who\s+is\s+{_NAME}$",
]
_TASK_PATTERNS = [
    rf"\btasks?\b.{{0,20}}?\b(?:assigned to|of|for|owned by|belonging to)\s+(?P<name>[a-z][a-z.'\- ]{{1,40}})$",
    rf"\b(?:what|which)\s+tasks?\s+(?:does|do|is|are)\s+{_NAME}\s+(?:have|has|got|assigned|pending)$",
    rf"^{_NAME}'s\s+(?:pending\s+|open\s+)?tasks?$",
]
_V_PERSON_DEALS = _vocab("deal owned own owns owner as the handles assigned handled managed belonging working handling managing responsible looking after currently opportunity "
                         "data details info information list display")
# Words that FILTER the deals (status, size, time). When the name captured from the question contains one ("show Priya
# Nair's open deals" captured "priya nair's open"), the template would silently drop the filter and list every deal:
# the question goes to the SQL model instead, which can filter.
_FILTER_WORDS = _vocab("open won lost closed active inactive pending new stalled stuck big bigger biggest large larger largest "
                       "small smaller smallest top highest lowest latest recent old older oldest this last next month quarter "
                       "year week today yesterday tomorrow value stage status above below over under more less")
_V_OVERVIEW = _vocab("data details info information profile summary overview tell about who display complete full entire whole everything both")
_V_PERSON_TASKS = _vocab("task assigned owned belonging pending open got currently")


def _person_deals_sql(entity):
    return ('SELECT d."Deal_Name", d."Current_Stage", d."Status", d."Deal_Value", d."Expected_Close_Date" FROM "deals" d '
            f'WHERE d."Owner_ID" = {lit(entity.id)} ORDER BY d."Deal_Value" DESC NULLS LAST')


def _person_tasks_sql(entity):
    return ('SELECT t."Task_Title", t."Status", t."Due_Date" FROM "tasks" t '
            f'WHERE t."Assigned_To" = {lit(entity.id)} ORDER BY t."Due_Date" NULLS LAST')


def _person_overview_sql(entity):
    """Who the person is and what THIS user can see of their work (row-level security filters the counts)."""
    return ('SELECT u."First_Name", u."Last_Name", u."Role", u."Region", '
            '(SELECT COUNT(*) FROM "deals" d WHERE d."Owner_ID" = u."User_ID") AS "Deals", '
            '(SELECT COALESCE(SUM(d."Deal_Value"), 0) FROM "deals" d WHERE d."Owner_ID" = u."User_ID") AS "Total_Deal_Value", '
            '(SELECT COUNT(*) FROM "contacts" c WHERE c."Owner_ID" = u."User_ID") AS "Contacts" '
            f'FROM "users" u WHERE u."User_ID" = {lit(entity.id)}')


def _match_person(q: str, tokens) -> Optional[Match]:
    for patterns, vocab, name, builder, final in (
            (_TASK_PATTERNS, _V_PERSON_TASKS, "tasks_by_user", _person_tasks_sql, False),
            (_DEAL_PATTERNS, _V_PERSON_DEALS, "deals_by_owner", _person_deals_sql, True),
            (_OVERVIEW_PATTERNS, _V_OVERVIEW, "person_overview", _person_overview_sql, True)):
        for p in patterns:
            m = re.search(p, q)
            if not m:
                continue
            person = _clean_name(m.group("name"))
            if person and name != "tasks_by_user" and any(_n(t) in _FILTER_WORDS for t in _tokens(person)):
                return None          # a filter word inside the "name": not a plain list of this person's deals
            if person and _covered(tokens, vocab, person):
                return Match(name, needs_person=True, person_text=person, build=builder, empty_is_final=final,
                             not_found_is_final=(name != "person_overview"))
    return None


# ---------------------------------------------------------------- questions about the person asking ("my deals")
# "my deals" = deals the person owns OR where they are on the deal team. "deals I own" = owned only;
# "deals where I am on the team / part of" = deal team only. The person is the logged-in user (never a typed name).
_SELF = re.compile(r"\b(?:my|mine|myself)\b|\bi\b|\bi'm\b|\bi'?ve\b|\b(?:to|by|for|with|about|of)\s+me\b")
_V_SELF = _vocab("deal task my mine myself me i i'm m ve am own owned owning owner team member part involved on in "
                 "currently assigned working handling managing where which what all show list "
                 "data details info information profile summary overview everything about tell give complete full entire whole")
_SELF_OVERVIEW = re.compile(r"\b(?:data|details|info|information|profile|summary|overview|everything)\b")
_TEAM = re.compile(r"\b(?:team|member|part of|involved)\b")
_OWN = re.compile(r"\b(?:own|owned|owning|owner)\b")


def refers_to_self(question: str) -> bool:
    """True when the question is about the person asking (my / mine / I / assigned to me ...). "show me" alone is not."""
    return bool(_SELF.search(_prep(question)))


def _self_deals_where(uid, team_only=False, owned_only=False):
    owner = f'd."Owner_ID" = {uid}'
    team = f'EXISTS (SELECT 1 FROM "deal_team_members" t WHERE t."Deal_ID" = d."Deal_ID" AND t."User_ID" = {uid})'
    return owner if owned_only else (team if team_only else f"({owner} OR {team})")


def _my_deals_sql(entity):
    uid = lit(entity.id)
    return ('SELECT d."Deal_Name", d."Current_Stage", d."Status", d."Deal_Value", d."Expected_Close_Date", '
            f'CASE WHEN d."Owner_ID" = {uid} THEN \'Owner\' ELSE \'Deal team\' END AS "My_Role" FROM "deals" d '
            f'WHERE {_self_deals_where(uid)} ORDER BY d."Deal_Value" DESC NULLS LAST')


def _my_team_deals_sql(entity):
    uid = lit(entity.id)
    return ('SELECT d."Deal_Name", d."Current_Stage", d."Status", d."Deal_Value", d."Expected_Close_Date" FROM "deals" d '
            f'WHERE {_self_deals_where(uid, team_only=True)} ORDER BY d."Deal_Value" DESC NULLS LAST')


def _my_deals_count_sql(entity):
    return f'SELECT COUNT(*) AS "Deals" FROM "deals" d WHERE {_self_deals_where(lit(entity.id))}'


def _match_self(q: str, tokens) -> Optional[Match]:
    """Only when every word is covered (anything extra, e.g. "update" or "this quarter", goes to the SQL model)."""
    if not _covered(tokens, _V_SELF):
        return None
    has = lambda w: any(_n(t) == _n(w) for t in tokens)
    if not has("deal") and _SELF_OVERVIEW.search(q):      # "my data", "my profile", "everything about me"
        return Match("my_overview", self_ref=True, build=_person_overview_sql)
    if not has("deal"):                 # tasks are not available to the Copilot (not in the RBAC table list)
        return None
    if re.search(r"\b(?:how many|number of|count)\b", q):
        return None if (_TEAM.search(q) or _OWN.search(q)) else Match("my_deals_count", self_ref=True, build=_my_deals_count_sql)
    if _TEAM.search(q) and not _OWN.search(q):
        return Match("my_team_deals", self_ref=True, build=_my_team_deals_sql)
    if _OWN.search(q) and not _TEAM.search(q):
        return Match("my_owned_deals", self_ref=True, build=_person_deals_sql)
    return Match("my_deals", self_ref=True, build=_my_deals_sql)


def match(question: str) -> Optional[Match]:
    q = _prep(question)
    if not q or len(q) > 300:
        return None
    tokens = _tokens(q)
    if _SELF.search(q):              # about the person asking: never a template that ignores "my" (e.g. a count of ALL deals)
        return _match_self(q, tokens)
    return _match_person(q, tokens) or _match_plain(q, tokens)


def person_text_is_plausible_name(text: str) -> bool:
    """False when the 'name' is only filler/domain words (e.g. 'all open'), so the caller should not say 'not found'."""
    stop = _COMMON | _vocab("open won lost lead stage status deal owner task new pending closed active")
    toks = _tokens(text.lower())
    return bool(toks) and not all(_n(t) in stop for t in toks)