import csv
import boto3
import ollama
from sentence_transformers import SentenceTransformer

VECTOR_BUCKET = "vector-s3-bucket"
INDEX_NAME = "closemore-docs"
EMBED_MODEL = "all-MiniLM-L6-v2"
LLM_MODEL = "llama3:8b"
TOP_K = 5
EVAL_FILE = "eval_questions.csv"

REFUSAL_MARKERS = [
    "does not mention", "not mentioned", "cannot find", "can't find",
    "no information", "does not contain", "not contain enough",
    "cannot answer", "can't answer", "not able to answer",
]

model = SentenceTransformer(EMBED_MODEL)
s3vectors = boto3.client("s3vectors")


def retrieve_chunks(question, top_k=TOP_K):
    q_vector = model.encode([question], normalize_embeddings=True)[0].tolist()
    response = s3vectors.query_vectors(
        vectorBucketName=VECTOR_BUCKET,
        indexName=INDEX_NAME,
        queryVector={"float32": q_vector},
        topK=top_k,
        returnMetadata=True,
        returnDistance=True,
    )
    return response.get("vectors", [])


def build_prompt(question, chunks):
    context_blocks = []
    for i, hit in enumerate(chunks, start=1):
        meta = hit.get("metadata", {})
        context_blocks.append(f"[Source {i}: {meta.get('source_file')}, page {meta.get('page')}]\n{meta.get('text', '')}")
    context = "\n\n".join(context_blocks)

    return f"""Answer the question using ONLY the context below. Each [Source N] block may come from a DIFFERENT document describing a DIFFERENT deal or proposal -- do not merge facts across different source documents as if they describe one thing. If the sources describe different deals, say so explicitly and answer per-source, or ask which one the user means.

Do NOT perform any arithmetic, summing, or multi-step calculations yourself -- language models are unreliable at this and can silently produce wrong totals. If the question requires combining, adding, or comparing multiple numeric figures, instead: state each individual figure exactly as written in its source, label which source and page it came from, and explicitly say that these figures have not been combined and a separate calculation would be needed for any total.

If the context doesn't contain enough information to answer, say so clearly instead of guessing.

Context:
{context}

Question: {question}

Answer:"""


def check_retrieval(chunks, expected_source_contains):
    if not expected_source_contains:
        return "SKIP"
    for hit in chunks:
        if expected_source_contains.lower() in hit.get("metadata", {}).get("source_file", "").lower():
            return "PASS"
    return "FAIL"


def check_answer_keywords(answer, expected_keywords):
    if not expected_keywords:
        return "SKIP", []
    required = [k.strip() for k in expected_keywords.split("|") if k.strip()]
    found = [k for k in required if k.lower() in answer.lower()]
    missing = [k for k in required if k not in found]
    if not missing:
        return "PASS", missing
    if found:
        return "PARTIAL", missing
    return "FAIL", missing


def check_refusal(answer):
    lower = answer.lower()
    return "PASS" if any(marker in lower for marker in REFUSAL_MARKERS) else "FAIL"


def run_eval():
    with open(EVAL_FILE, newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    results = []
    for row in rows:
        qid = row["id"]
        question = row["question"]
        expected_behavior = row["expected_behavior"].strip()
        expected_keywords = row["expected_keywords"].strip()
        expected_source = row["expected_source_contains"].strip()

        chunks = retrieve_chunks(question)
        if not chunks:
            answer = ""
        else:
            prompt = build_prompt(question, chunks)
            response = ollama.generate(model=LLM_MODEL, prompt=prompt, options={"num_ctx": 8192, "temperature": 0})
            answer = response["response"].strip()

        retrieval_verdict = check_retrieval(chunks, expected_source)

        if expected_behavior == "refuse":
            content_verdict = check_refusal(answer)
            missing = []
        else:
            content_verdict, missing = check_answer_keywords(answer, expected_keywords)

        overall = "PASS" if content_verdict in ("PASS", "SKIP") and retrieval_verdict in ("PASS", "SKIP") else \
                  ("PARTIAL" if content_verdict == "PARTIAL" else "FAIL")

        results.append({
            "id": qid, "question": question, "answer": answer,
            "retrieval_verdict": retrieval_verdict, "content_verdict": content_verdict,
            "missing_keywords": missing, "overall": overall,
        })

        print(f"\n{'=' * 80}")
        print(f"[{qid}] {question}")
        print(f"Expected behavior: {expected_behavior}")
        print(f"\nAnswer:\n{answer}")
        print(f"\nRetrieved sources:")
        for hit in chunks:
            meta = hit.get("metadata", {})
            print(f"  - {meta.get('source_file')} (page {meta.get('page')}, distance {hit['distance']:.4f})")
        print(f"\nRetrieval check: {retrieval_verdict}")
        print(f"Content check: {content_verdict}" + (f"  (missing: {missing})" if missing else ""))
        print(f"OVERALL: {overall}")

    print(f"\n{'=' * 80}")
    print("SUMMARY")
    print(f"{'=' * 80}")
    for r in results:
        print(f"  [{r['id']}] {r['overall']:8s}  retrieval={r['retrieval_verdict']:6s}  content={r['content_verdict']:8s}  {r['question'][:50]}")

    pass_count = sum(1 for r in results if r["overall"] == "PASS")
    print(f"\n{pass_count}/{len(results)} passed")
    print("\nNote: PASS here means required facts/sources were found -- always read the full")
    print("answers above too, since keyword-matching can't catch subtly wrong explanations")
    print("or numbers that are present but misattributed (as we found earlier with source Q2).")


if __name__ == "__main__":
    run_eval()