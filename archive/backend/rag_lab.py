"""
rag_lab.py -- a standalone RAG test bench. Changes nothing in the system; read-only.

It imports the real server.py and calls exactly the functions the server uses for a document question, printing
every step in the terminal:

  1. settings in force (RAG mode, top-k, distance limits, model endpoints, the user)
  2. the RAW vector search: every hit with rank, cosine distance, document, page, and kept / dropped (and why)
  3. the spelling help (if it ran) and the FINAL chunks given to the model, numbered Source 1..N as in the answer
  4. the base model's answer (time, tokens), and whether it said NOT_IN_DOCUMENTS
  5. the judge (fine-tuned model): raw output, verdict YES / NO, plus a one-sentence REASON (asked only here, for you)
  6. the decision the server would take (answer shown, or fallback / "not in the documents")
  7. optionally (--final) the last rewrite step, and whether its (Source N) citations match the chips

Access: by default it runs as seed-u-1 (Asha, system admin = full view) through the NORMAL RBAC path, so every
document in the organization is searchable. --user <id> runs as anyone else (e.g. a sales rep) to compare.

Usage (backend folder, venv active, model servers up):
    python rag_lab.py "does on-prem infrastructure use AWS?"
    python rag_lab.py "does on-pren infatructure use AWS?" --final --show-prompt
    python rag_lab.py --user seed-u-5 "what discount does the Indore proposal offer?"
    python rag_lab.py                                   # interactive: type questions, empty line to quit
Options:
    --mode judge|levels     override RAG_MODE for this run       --topk N        chunks to keep (default: server TOP_K)
    --max-distance 0.85     override the "too far" limit          --no-reason     skip the judge's reason call
    --show-prompt           print the full prompts sent           --final         also run the final rewrite step
Every run is also saved to logs/rag_lab_<time>.jsonl.
"""
import argparse
import json
import os
import sys
import time

os.environ.setdefault("WARM_MODELS", "0")             # no start-up model call
os.environ.setdefault("WARM_ENTITY_INDEX", "0")       # no name index (not needed for documents)
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import server                                          # noqa: E402  (the real backend: same functions, same settings)

LINE = "-" * 100


def head(title):
    print(f"\n{'=' * 100}\n{title}\n{'=' * 100}")


def short(text, n=160):
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def ask_model(url, prompt, tokens, purpose):
    t0 = time.time()
    try:
        text, info = server.generate_ex(url, prompt, max_new_tokens=tokens, purpose=purpose)
        return str(text), round(time.time() - t0, 2), info, None
    except server.LLMError as e:
        return "", round(time.time() - t0, 2), {}, f"{e.kind}: {short(e, 120)}"


_REASON_PROMPT = """You checked an answer written from document passages and your verdict was: {verdict}.

Question: {question}

Passages:
{passages}

Answer: {answer}

In ONE short sentence, say why the verdict is {verdict} (which passage supports the answer, or what is missing or wrong).
Reason:"""


def run(question, a):
    rec = server.session_logger.start("rag-lab-session", question)   # collects the server's own step events
    out = {"question": question, "user": a.user, "time": time.strftime("%Y-%m-%d %H:%M:%S")}
    user = server.rbac.load_user(a.user)
    if user is None:
        print(f"User {a.user!r} not found or not active.")
        return None
    server.rbac.set_request_user(user)
    if a.mode:
        server.RAG_MODE = a.mode
    if a.max_distance is not None:
        server.RAG_MAX_DISTANCE = a.max_distance
    if a.topk:
        server.TOP_K = a.topk

    head(f"QUESTION: {question}")
    print(f"user          : {user.user_id}  {user.name}  ({user.role_label}, full view={user.is_full_view}, regions={user.regions or '-'})")
    print(f"RAG mode      : {server.RAG_MODE}   top-k: {server.TOP_K}   too far above: {server.RAG_MAX_DISTANCE}   "
          f"'relevant' level (levels mode): {server.RAG_STRONG_DISTANCE}")
    print(f"base model    : {server.SQL_RAG_URL}")
    print(f"judge model   : {server.RAG_JUDGE_URL}   (on judge error: {server.RAG_JUDGE_ON_ERROR})")
    print(f"vector index  : {getattr(server.docs, 'DOCS_INDEX', '?')}   legacy index: {getattr(server.docs, 'LEGACY_INDEX', '') or '(off)'}"
          f"   spelling help: {server.SPELL_FIX_ENABLED}")

    # ---- 1. raw vector search (what docs.search returns before any filtering)
    head("1. RAW VECTOR SEARCH (before any filtering)")
    t0 = time.time()
    vec = server.embed_model.encode([question], normalize_embeddings=True)[0].tolist()
    t_embed = time.time() - t0
    t0 = time.time()
    raw = server.docs.search(user, vec, server.TOP_K + 3)
    t_search = time.time() - t0
    print(f"embedding {t_embed * 1000:.0f} ms, search {t_search * 1000:.0f} ms, {len(raw)} hit(s)\n")
    print(f"{'rank':>4}  {'distance':>8}  {'status':<22} {'document':<38} {'page':>4}  text")
    seen, raw_rows = set(), []
    for i, h in enumerate(raw, 1):
        m = h.get("metadata") or {}
        d = h.get("distance")
        text = " ".join(str(m.get("text") or "").split())
        if text in seen:
            status = "dropped: duplicate"
        elif d is not None and d > server.RAG_MAX_DISTANCE:
            status = f"dropped: > {server.RAG_MAX_DISTANCE}"
        elif server.RAG_MODE != "judge" and d is not None and d > server.RAG_STRONG_DISTANCE:
            status = "kept: weak match"
        else:
            status = "kept"
        seen.add(text)
        doc = server._display_name(m.get("source_file"))
        print(f"{i:>4}  {d if d is None else round(d, 4):>8}  {status:<22} {short(doc, 37):<38} {str(m.get('page')):>4}  {short(text, 70)}")
        raw_rows.append({"rank": i, "distance": d, "status": status, "document": doc, "page": m.get("page"),
                         "doc_id": m.get("doc_id"), "text": text[:300]})
    out["raw_hits"] = raw_rows

    # ---- 2. the server's own retrieval (top-k, limit, spelling help)
    head("2. CHUNKS GIVEN TO THE MODEL (the server's own retrieval, incl. spelling help)")
    chunks, used = server._retrieve(question)
    if used != question:
        print(f"spelling help corrected the question to: {used!r}")
    if not chunks:
        print("NO CHUNKS left -> the server answers \"" + server.conv.NO_DOCS_MSG + "\" (no model call).")
    for i, h in enumerate(chunks, 1):
        m = h.get("metadata") or {}
        print(f"\n[Source {i}]  distance {round(h.get('distance') or 0, 4)}   {server._display_name(m.get('source_file'))}, page {m.get('page')}"
              f"{'   (weak match)' if server._is_weak(h) else ''}")
        print(f"   {short(m.get('text'), 400)}")
    out["chunks"] = [{"source": i, "distance": h.get("distance"), "document": server._display_name((h.get("metadata") or {}).get("source_file")),
                      "page": (h.get("metadata") or {}).get("page")} for i, h in enumerate(chunks, 1)]
    out["question_used"] = used
    if not chunks:
        out["decision"] = "no chunks -> not in the documents"
        return finish(out, rec, a)

    # ---- 3. base model answer
    head("3. BASE MODEL ANSWER")
    if a.show_prompt:
        print("(the exact prompt is built inside server.run_rag_answer; shown here as sent)")
    t0 = time.time()
    captured = {}
    real = server.generate_ex

    def spy(url, prompt, max_new_tokens=0, purpose=""):
        captured.setdefault(purpose, prompt)
        return real(url, prompt, max_new_tokens=max_new_tokens, purpose=purpose)
    server.generate_ex = spy
    try:
        answer = server.run_rag_answer(used, chunks)
    except server.LLMError as e:
        answer = ""
        print(f"MODEL ERROR: {e.kind}: {e}")
    finally:
        server.generate_ex = real
    t_base = round(time.time() - t0, 2)
    if a.show_prompt and "rag_answer" in captured:
        print(f"{LINE}\nPROMPT:\n{captured['rag_answer']}\n{LINE}")
    print(f"time {t_base} s")
    print(f"answer:\n{answer}")
    cited = sorted(server.answer_text.cited_sources(answer))
    print(f"\ncites sources: {cited or 'none'}   (available: 1..{len(chunks)})")
    out.update(base_answer=answer, base_seconds=t_base, base_cites=cited)

    not_in_docs = server.NOT_IN_DOCS in answer.upper().replace(" ", "_") or not answer.strip()
    if server.RAG_MODE == "judge" and not_in_docs:
        print("\n-> the base model said NOT_IN_DOCUMENTS: no judge call; the server answers \"not in the documents\" "
              "(or falls back to the CRM for a CRM question).")
        out["decision"] = "base model: NOT_IN_DOCUMENTS"
        return finish(out, rec, a)

    # ---- 4. judge
    if server.RAG_MODE == "judge":
        head("4. JUDGE (fine-tuned model): does the answer really answer the question from these passages?")
        passages = "\n".join(f"[{i}] " + short((h.get("metadata") or {}).get("text"), 500) for i, h in enumerate(chunks, 1))
        prompt = server._JUDGE_PROMPT.format(question=used, passages=passages, answer=answer[:1500])
        if a.show_prompt:
            print(f"{LINE}\nPROMPT:\n{prompt}\n{LINE}")
        raw_v, t_j, _info, err = ask_model(server.RAG_JUDGE_URL, prompt, 3, "rag_judge")
        verdict = "unclear"
        if not err:
            import re
            mm = re.match(r"^\W*(YES|NO)\b", raw_v.strip().upper())
            verdict = mm.group(1).lower() if mm else "unclear"
        print(f"time {t_j} s   raw output: {raw_v!r}   ->  verdict: {verdict.upper()}" + (f"   ERROR {err}" if err else ""))
        reason = None
        if not a.no_reason and verdict in ("yes", "no"):
            rp = _REASON_PROMPT.format(verdict=verdict.upper(), question=used, passages=passages, answer=answer[:1500])
            reason, t_r, _i, err_r = ask_model(server.RAG_JUDGE_URL, rp, 60, "rag_judge_reason")
            print(f"reason (asked only in this lab, {t_r} s): {short(reason, 400) if not err_r else 'ERROR ' + err_r}")
        accepted = verdict == "yes" or (verdict == "unclear" and server.RAG_JUDGE_ON_ERROR != "reject")
        out.update(judge_raw=raw_v, judge_verdict=verdict, judge_seconds=t_j, judge_reason=reason)
        head("5. DECISION (what the server does)")
        if accepted:
            print("ANSWER ACCEPTED -> shown to the user with source chips " + str(cited or "(all retrieved)"))
            out["decision"] = f"accepted (judge {verdict})"
        else:
            print("ANSWER REJECTED -> not shown. The server says \"not in the documents\", or falls back to the CRM if the "
                  "question mentions deals / owners / contacts / products or names a CRM person.")
            out["decision"] = f"rejected (judge {verdict})"
            return finish(out, rec, a)
    else:
        head("4. DECISION (levels mode: no judge)")
        print("ANSWER USED as written (weak matches were labelled in the prompt).")
        out["decision"] = "used (levels mode)"

    # ---- optional final rewrite
    if a.final:
        head("6. FINAL REWRITE (fine-tuned model) + citation check")
        t0 = time.time()
        final = server.synthesize_answer(used, None, answer)
        t_f = round(time.time() - t0, 2)
        problems = server.answer_text.source_problems(final, answer)
        print(f"time {t_f} s\nfinal answer shown to the user:\n{final}")
        print(f"\ncitation check: {'OK' if not problems else problems}  "
              f"(if the rewrite drops the citations, the server shows the base answer instead)")
        out.update(final_answer=final, final_seconds=t_f, final_problems=problems)
    return finish(out, rec, a)


def finish(out, rec, a):
    print(f"\n{LINE}\nserver step events:")
    for e in rec.events:
        data = {k: v for k, v in e.items() if k not in ("t_ms", "kind")}
        print(f"  +{e['t_ms'] / 1000:5.1f}s  {e['kind']:<16} {short(json.dumps(data, ensure_ascii=False, default=str), 150)}")
    out["events"] = rec.events
    try:
        os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
        with open(a.out, "a", encoding="utf-8") as f:
            f.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
        print(f"saved to {a.out}")
    except Exception as e:
        print(f"(could not save: {e})")
    return out


def main():
    ap = argparse.ArgumentParser(description="RAG test bench (read-only)")
    ap.add_argument("question", nargs="*")
    ap.add_argument("--user", default=os.environ.get("RAG_LAB_USER", "seed-u-1"), help="user id (default seed-u-1 = system admin)")
    ap.add_argument("--mode", choices=["judge", "levels"])
    ap.add_argument("--topk", type=int)
    ap.add_argument("--max-distance", type=float)
    ap.add_argument("--no-reason", action="store_true")
    ap.add_argument("--show-prompt", action="store_true")
    ap.add_argument("--final", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "logs", f"rag_lab_{time.strftime('%Y%m%d-%H%M%S')}.jsonl"))
    a = ap.parse_args()
    if a.question:
        run(" ".join(a.question), a)
        return
    print("RAG lab -- type a question (empty line to quit)")
    while True:
        try:
            q = input("\nquestion> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            break
        run(q, a)


if __name__ == "__main__":
    main()
