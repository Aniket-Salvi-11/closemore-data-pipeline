"""Tests for the finished Phase 4 building blocks (no server needed): answer_text C/D, session_store, understander.
Run: python test_phase4_parts.py"""
import json
import answer_text as at
import session_store as ss
import understander as u


# ---------------- C and D (answer text)
def test_prompt_echoes_are_removed():
    assert at.clean_model_answer("Here's the main finding: We have 76 deals in total.\n\nThe full table of results is shown separately.") == "We have 76 deals in total."
    assert at.clean_model_answer("Priya Nair has been involved in 4 deals. \n\nThe full table of results is shown to you separately.") == "Priya Nair has been involved in 4 deals."
    assert at.clean_model_answer("Here is the answer directly to a CRM user:\n\nWe found 37 owners.") == "We found 37 owners."
    assert at.clean_model_answer("- a\n- b") == "- a\n- b"


def test_fallback_sentence_names_the_person_and_the_kind_of_row():
    cols = ["Name", "Deal_Name", "Current_Stage"]
    res = {"columns": ["First_Name", "Last_Name", "Deal_Name", "Current_Stage"], "rows": [("Priya", "Nair", "D1", "Lead"), ("Priya", "Nair", "D2", "Won")],
           "entities": ["Priya Nair (user)"]}
    assert at.build_summary(res, True) == "Found 2 deals for Priya Nair. The details are in the table."
    res["entities"] = ["SAIL DEAL (deal)"]
    assert at.build_summary(res, True) == "Found 2 deals. The details are in the table."


def test_restating_a_small_table_is_allowed_but_a_long_one_is_not():
    small = {"columns": ["Deal_Name", "Current_Stage"], "rows": [("Seed Deal 44", "Designed"), ("Seed Deal 28", "Post call")]}
    ans = "Priya Nair has 2 deals: Seed Deal 44 (Designed) and Seed Deal 28 (Post call)."
    assert "lists_rows" not in at.check(ans, "deals of Priya Nair", small, True)
    big = {"columns": ["Deal_Name"], "rows": [(f"Deal number {i}",) for i in range(8)]}
    ans2 = "Deals: " + ", ".join(f"Deal number {i}" for i in range(6))
    assert "lists_rows" in at.check(ans2, "all deals", big, True)


# ---------------- session_store
def test_history_is_compact_and_tiered():
    ss.reset_all()
    sid = "sess-store-0001"
    for i in range(8):
        ss.remember(sid, ss.TurnSummary(question=f"question {i}", route="SQL", status="rows", names=["Priya Gupta"], columns=["Deal Name"], rows=40 + i, top="SAIL DEAL"),
                    [("user", "seed-u-1", "Priya Gupta")])
    lines = ss.history_lines(sid, total=6, full=3)
    assert len(lines) == 6 and lines[0].startswith("Q: question 2") and "columns" not in lines[0] and "columns: Deal Name" in lines[-1]
    assert sum(len(l) for l in lines) < 900
    assert ss.mentioned(sid) == ["Priya Gupta"]
    assert ss.history_lines("bad id!", 6, 3) == [] and ss.valid_id("bad id!") is None


def test_store_is_bounded_and_isolated():
    ss.reset_all()
    ss.remember("sess-aaaaaaaa", ss.TurnSummary(question="a"))
    ss.remember("sess-bbbbbbbb", ss.TurnSummary(question="b"))
    assert ss.history_lines("sess-aaaaaaaa")[0].startswith("Q: a") and ss.history_lines("sess-bbbbbbbb")[0].startswith("Q: b")
    old = ss.MAX_SESSIONS
    ss.MAX_SESSIONS = 3
    try:
        for i in range(6):
            ss.remember(f"sess-limit-{i:03d}", ss.TurnSummary(question="x"))
        assert len(ss._sessions) <= 3
    finally:
        ss.MAX_SESSIONS = old


CANDS = [{"kind": "user", "id": "seed-u-23", "display": "Priya Nair", "detail": "seed.user23@example.com, Sales_Rep"},
         {"kind": "user", "id": "seed-u-15", "display": "Priya Nair", "detail": "seed.user15@example.com, Executive_Manager"}]
AMANS = [{"detail": "aman@taw.com, System_Admin"}, {"detail": "aman@rupick.com, System_Admin"}, {"detail": "aman@keron.com, System_Admin"}]


def test_which_one_replies():
    mc = ss.match_choice
    assert mc("seed.user15@example.com", CANDS, "Priya Nair") == [1]
    assert mc("the second one", CANDS, "Priya Nair") == [1] and mc("1", CANDS) == [0] and mc("first", CANDS) == [0]
    assert mc("last", CANDS) == [1]
    assert mc("all aman jain", AMANS, "Aman Jain") == [0, 1, 2] and mc("both", CANDS) == [0, 1]
    assert mc("aman@taw.com", AMANS, "Aman Jain") == [0]
    assert mc("the keron one", AMANS, "Aman Jain") == [2]
    assert mc("executive_manager", CANDS, "Priya Nair") == [1]
    # these are new questions, not answers
    for q in ("show all deals", "tell me deals", "how many deals does each owner have", "what is the total deal value", "7"):
        assert mc(q, CANDS, "Priya Nair") is None, q


def test_pending_is_consumed_once():
    ss.reset_all()
    sid = "sess-pend-0001"
    ss.set_pending(sid, {"question": "tell me about Priya Nair", "route": "SQL", "typed": "Priya Nair", "candidates": CANDS})
    assert ss.pop_pending(sid)["question"] == "tell me about Priya Nair"
    assert ss.pop_pending(sid) is None


# ---------------- understander
def test_every_few_shot_example_is_valid_json_the_parser_accepts():
    for hist, message, out in u.EXAMPLES:
        und = u.parse(out)
        assert und is not None and und.route in u.ROUTES, message
        json.loads(out)
    assert len(u.EXAMPLES) >= 12


def test_prompt_has_a_fixed_prefix_and_the_real_message_last():
    p1 = u.build_prompt("tell me about Priya Nair", ["Q: hi -> CHAT"], ["Priya Nair"])
    p2 = u.build_prompt("another question", [], [])
    assert p1.startswith(u.PREFIX) and p2.startswith(u.PREFIX)
    assert p1.rstrip().endswith("Message: tell me about Priya Nair\nJSON:")
    assert "Names mentioned so far: Priya Nair" in p1 and "(none)" in p2
    approx_tokens = len(u.PREFIX) / 3.5
    assert approx_tokens < 1800, approx_tokens          # keep the fixed part small enough for CPU


def test_parse_is_robust():
    good = '{"route":"sql","related":"true","question":"What deals does Priya Gupta have?","names":[{"name":"Priya Gupta","type":"user"}],"safety":"OK"}'
    a = u.parse("Sure! " + good + "\nextra words")
    assert a.route == "SQL" and a.related and a.names == [("Priya Gupta", "person")] and a.safety == "ok"
    assert u.parse("```json\n" + good + "\n```").route == "SQL"
    assert u.parse("SQL").route_only and u.parse("  rag.").route == "RAG"
    assert u.parse('{"route":"maybe"}') is None and u.parse("I cannot help") is None and u.parse('{"route":"SQL"') is None
    assert u.parse('{"route":"CHAT","safety":"weird"}').safety == "ok"
    names = u.parse('{"route":"SQL","names":["Vijay Sir","Vijay Sir", {"name":"Aman Jan","type":"employee"}, 5, ""]}').names
    assert names == [("Vijay", "person"), ("Aman Jan", "person")]


def test_validate_keeps_only_grounded_rewrites_and_names():
    hist = "Q: tell me about Priya Gupta -> SQL; about: Priya Gupta"
    und = u.parse('{"route":"SQL","related":true,"question":"What deals does Priya Gupta own?","names":[{"name":"Priya Gupta","type":"person"}]}')
    und = u.validate(und, "and her deals?", hist)
    assert und.related and und.question == "What deals does Priya Gupta own?" and und.names == [("Priya Gupta", "person")]
    bad = u.parse('{"route":"SQL","related":true,"question":"Delete every Acme invoice from Mumbai warehouse inventory report","names":[]}')
    bad = u.validate(bad, "and her deals?", hist)
    assert not bad.related and bad.question == "and her deals?" and "rewrite_rejected" in bad.warnings
    inv = u.validate(u.parse('{"route":"SQL","names":[{"name":"Karan Verma","type":"person"},{"name":"Aman Jain","type":"person"}]}'), "what is Aman Jan working on", "")
    assert inv.names == [("Aman Jain", "person")] and "name_not_in_text:Karan Verma" in inv.warnings     # a corrected typo is allowed, an invented name is not


def test_not_related_keeps_the_message_exactly():
    und = u.validate(u.parse('{"route":"SQL","related":false,"question":"something else entirely","names":[]}'), "How many deals are there?", "Q: x")
    assert und.question == "How many deals are there?" and not und.related


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for f in fns:
        try:
            f(); print("ok  ", f.__name__)
        except Exception as e:
            import traceback; failed += 1; print("FAIL", f.__name__, "->", repr(e)); traceback.print_exc(limit=2)
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
