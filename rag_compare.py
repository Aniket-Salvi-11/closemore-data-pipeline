"""
rag_compare.py -- batch RAG approach comparison. Read-only: changes nothing in the system.

Runs every question of a test set under every approach (mode:topk[:max_distance]) through the REAL server.py
functions (same ones rag_lab.py uses), scores each run with cheap exact metrics, prints a comparison table and
saves RAGAS-ready files.

Test set (jsonl, one object per line; see testset_template.jsonl):
  id, question, answerable (true/false), expected_doc (substring of document name), expected_page (optional),
  must_include (list of words/phrases a correct answer contains), reference_answer (for RAGAS)

Usage (backend folder, venv active, model servers up):
    python rag_compare.py testset.jsonl
    python rag_compare.py testset.jsonl --approaches judge:3,judge:5,judge:8,levels:5
    python rag_compare.py testset.jsonl --approaches judge:5:0.8,judge:5:0.9 --limit 10 --user seed-u-1

Metrics per approach:
  hit@k        right document (and page, if given) is among the chunks given to the model
  MRR          1/rank of first right chunk
  answer_ok    answerable Qs: accepted answer contains all must_include terms
  NID_acc      unanswerable Qs: system correctly said "not in the documents"
  judge_acc    judge verdict agrees with ground truth (answer good -> YES, answer bad -> NO)
  cite_ok      answer cites only existing sources (and at least one)
  avg_sec      seconds per question
Outputs (logs/compare_<time>/): results.jsonl, summary.csv, ragas_<approach>.jsonl (question, answer, contexts, ground_truth)
"""
import argparse, csv, json, os, re, sys, time

os.environ.setdefault("WARM_MODELS", "0")
os.environ.setdefault("WARM_ENTITY_INDEX", "0")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import server  # noqa: E402


def load_testset(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(f"{path} line {n}: bad JSON ({e})")
            if "question" not in r:
                sys.exit(f"{path} line {n}: missing 'question'")
            r.setdefault("id", f"q{len(rows) + 1}")
            r.setdefault("answerable", True)
            rows.append(r)
    return rows


def parse_approach(s):
    p = s.split(":")
    mode = p[0]
    if mode not in ("judge", "levels"):
        sys.exit(f"bad approach {s!r}: mode must be judge or levels")
    topk = int(p[1]) if len(p) > 1 and p[1] else server.TOP_K
    dist = float(p[2]) if len(p) > 2 and p[2] else server.RAG_MAX_DISTANCE
    return {"name": s, "mode": mode, "topk": topk, "dist": dist}


def hit_rank(chunks, q):
    """rank (1-based) of first chunk from the expected doc/page, or None"""
    doc = (q.get("expected_doc") or "").lower()
    page = q.get("expected_page")
    if not doc:
        return None
    for i, h in enumerate(chunks, 1):
        m = h.get("metadata") or {}
        name = str(server._display_name(m.get("source_file")) or "").lower()
        if doc in name and (page is None or str(m.get("page")) == str(page)):
            return i
    return None


def contains_all(answer, terms):
    a = " ".join(answer.lower().split())
    return all(any(alt.strip().lower() in a for alt in t.split("|")) for t in terms)   # "2M|2 million" = either


def one_run(q, ap, a):
    server.RAG_MODE, server.TOP_K, server.RAG_MAX_DISTANCE = ap["mode"], ap["topk"], ap["dist"]
    r = {"id": q["id"], "category": q.get("category", ""), "approach": ap["name"], "question": q["question"], "answerable": q["answerable"]}
    t0 = time.time()
    chunks, used = server._retrieve(q["question"])
    r["chunks"] = [{"rank": i, "distance": h.get("distance"),
                    "document": server._display_name((h.get("metadata") or {}).get("source_file")),
                    "page": (h.get("metadata") or {}).get("page"),
                    "text": str((h.get("metadata") or {}).get("text") or "")} for i, h in enumerate(chunks, 1)]
    rank = hit_rank(chunks, q)
    r["hit_rank"] = rank
    r["expected"] = bool(q.get("expected_doc"))
    r["answer"], r["verdict"], r["cited"], r["error"] = "", None, [], None
    if not chunks:
        r["decision"] = "not_in_docs"
    else:
        try:
            ans = server.run_rag_answer(used, chunks)
        except server.LLMError as e:
            ans, r["error"] = "", f"{e.kind}: {e}"
        r["answer"] = ans
        r["cited"] = sorted(server.answer_text.cited_sources(ans))
        nid = server.NOT_IN_DOCS in ans.upper().replace(" ", "_") or not ans.strip()
        if nid:
            r["decision"] = "not_in_docs"
        elif ap["mode"] == "judge":
            passages = "\n".join(f"[{i}] " + " ".join(str((h.get('metadata') or {}).get('text') or '').split())[:500]
                                 for i, h in enumerate(chunks, 1))
            prompt = server._JUDGE_PROMPT.format(question=used, passages=passages, answer=ans[:1500])
            try:
                raw, _ = server.generate_ex(server.RAG_JUDGE_URL, prompt, max_new_tokens=3, purpose="rag_judge")
                m = re.match(r"^\W*(YES|NO)\b", str(raw).strip().upper())
                r["verdict"] = m.group(1).lower() if m else "unclear"
            except server.LLMError:
                r["verdict"] = "unclear"
            ok = r["verdict"] == "yes" or (r["verdict"] == "unclear" and server.RAG_JUDGE_ON_ERROR != "reject")
            r["decision"] = "accepted" if ok else "rejected"
        else:
            r["decision"] = "accepted"
        if a.final and r["decision"] == "accepted":
            try:
                r["final_answer"] = server.synthesize_answer(used, None, ans)
                r["final_problems"] = server.answer_text.source_problems(r["final_answer"], ans)
            except server.LLMError as e:
                r["final_problems"] = [f"{e.kind}"]
    r["seconds"] = round(time.time() - t0, 2)

    # ---- scoring against ground truth
    shown = r["decision"] == "accepted"
    r["said_nid"] = not shown
    terms = q.get("must_include") or []
    answered = bool(r["answer"].strip()) and r["decision"] != "not_in_docs"   # model produced a real answer
    if q["answerable"]:
        good = (answered and contains_all(r["answer"], terms)) if terms else None
        r["answer_ok"] = (shown and good) if good is not None else None
    else:
        good = False                      # any real answer to an unanswerable question is wrong
        r["answer_ok"] = not shown        # correct = nothing shown to the user
    r["answer_good"] = good
    # judge is correct when YES goes with a good answer and NO with a bad one
    r["judge_correct"] = ((r["verdict"] == "yes") == bool(good)) if (r["verdict"] in ("yes", "no") and good is not None) else None
    bad_cite = [c for c in r["cited"] if c < 1 or c > len(chunks)]
    r["cite_ok"] = (bool(r["cited"]) and not bad_cite) if r["decision"] == "accepted" else None
    return r


def pct(vals):
    v = [x for x in vals if x is not None]
    return f"{100 * sum(map(bool, v)) / len(v):5.1f}%" if v else "   n/a"


def summarize(results, approaches):
    cols = ["approach", "n", "hit@k", "MRR", "answer_ok", "NID_acc", "judge_acc", "cite_ok", "avg_sec"]
    rows = []
    for ap in approaches:
        rs = [r for r in results if r["approach"] == ap["name"]]
        ans_rs = [r for r in rs if r["answerable"]]
        un_rs = [r for r in rs if not r["answerable"]]
        mrr_vals = [(1 / r["hit_rank"] if r["hit_rank"] else 0.0) for r in ans_rs if r["expected"]]
        rows.append({
            "approach": ap["name"], "n": len(rs),
            "hit@k": pct([r["hit_rank"] is not None for r in ans_rs if r["expected"]]),
            "MRR": f"{sum(mrr_vals) / len(mrr_vals):.2f}" if mrr_vals else "n/a",
            "answer_ok": pct([r["answer_ok"] for r in ans_rs]),
            "NID_acc": pct([r["answer_ok"] for r in un_rs]),
            "judge_acc": pct([r["judge_correct"] for r in rs]) if ap["mode"] == "judge" else "  -",
            "cite_ok": pct([r["cite_ok"] for r in rs]),
            "avg_sec": f"{sum(r['seconds'] for r in rs) / max(len(rs), 1):.1f}",
        })
    print("\n" + " | ".join(f"{c:<10}" for c in cols))
    print("-" * (13 * len(cols)))
    for r in rows:
        print(" | ".join(f"{str(r[c]):<10}" for c in cols))
    cats = sorted({r["category"] for r in results if r["category"]})
    if cats:
        print("\nanswer_ok by question category (unanswerable: NID_acc)")
        print(f"{'category':<14}" + "".join(f"{ap['name']:<12}" for ap in approaches))
        for c in cats:
            line = f"{c:<14}"
            for ap in approaches:
                line += f"{pct([r['answer_ok'] for r in results if r['approach'] == ap['name'] and r['category'] == c]):<12}"
            print(line)
    return cols, rows


def main():
    ap_ = argparse.ArgumentParser(description="RAG approach comparison (read-only)")
    ap_.add_argument("testset")
    ap_.add_argument("--approaches", default="judge:5,levels:5")
    ap_.add_argument("--user", default=os.environ.get("RAG_LAB_USER", "seed-u-1"))
    ap_.add_argument("--limit", type=int)
    ap_.add_argument("--final", action="store_true", help="also run the final rewrite and check its citations")
    ap_.add_argument("--outdir", default=os.path.join(HERE, "logs", f"compare_{time.strftime('%Y%m%d-%H%M%S')}"))
    a = ap_.parse_args()

    user = server.rbac.load_user(a.user)
    if user is None:
        sys.exit(f"User {a.user!r} not found or not active.")
    server.rbac.set_request_user(user)
    tests = load_testset(a.testset)[: a.limit]
    approaches = [parse_approach(s) for s in a.approaches.split(",") if s.strip()]
    os.makedirs(a.outdir, exist_ok=True)
    defaults = (server.RAG_MODE, server.TOP_K, server.RAG_MAX_DISTANCE)
    print(f"user {user.user_id} ({user.role_label}, full view={user.is_full_view}) | {len(tests)} questions x {len(approaches)} approaches")

    results = []
    try:
        with open(os.path.join(a.outdir, "results.jsonl"), "w", encoding="utf-8") as fout:
            for ap in approaches:
                print(f"\n=== approach {ap['name']}  (mode {ap['mode']}, top-k {ap['topk']}, max distance {ap['dist']}) ===")
                for q in tests:
                    r = one_run(q, ap, a)
                    results.append(r)
                    fout.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
                    fout.flush()
                    top = ", ".join(f"{c['document'][:18]}p{c['page']}={round(c['distance'] or 0, 2)}" for c in r["chunks"][:3])
                    print(f"[{r['id']}] {r['decision']:<12} verdict={r['verdict'] or '-':<7} hit_rank={r['hit_rank']} "
                          f"cites={r['cited']} {r['seconds']}s | top3: {top}" + (f" | ERROR {r['error']}" if r["error"] else ""))
    finally:
        server.RAG_MODE, server.TOP_K, server.RAG_MAX_DISTANCE = defaults

    cols, rows = summarize(results, approaches)
    with open(os.path.join(a.outdir, "summary.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    by_q = {t["id"]: t for t in tests}
    for ap in approaches:
        fn = os.path.join(a.outdir, "ragas_" + re.sub(r"[^\w.-]", "_", ap["name"]) + ".jsonl")
        with open(fn, "w", encoding="utf-8") as f:
            for r in results:
                if r["approach"] == ap["name"] and r["answer"].strip():
                    f.write(json.dumps({"question": r["question"], "answer": r.get("final_answer") or r["answer"],
                                        "contexts": [c["text"] for c in r["chunks"]],
                                        "ground_truth": by_q[r["id"]].get("reference_answer", "")}, ensure_ascii=False) + "\n")
    print(f"\nsaved to {a.outdir}  (results.jsonl, summary.csv, ragas_*.jsonl)")


if __name__ == "__main__":
    main()
