import boto3
import ollama
from sentence_transformers import SentenceTransformer

VECTOR_BUCKET = "vector-s3-bucket"
INDEX_NAME = "closemore-docs"
EMBED_MODEL = "all-MiniLM-L6-v2"
LLM_MODEL = "llama3:8b"
TOP_K = 5

# Edit this list to whatever questions you want to run in one pass
QUESTIONS = [
    "What is the total programme cost across all proposals?",
    "Compare the STEM Cloud infrastructure costs between the two proposals.",
    "Does the on-prem infrastructure use AWS?",
    "What is the total invoice amount for March 2026?",
    "What is the deal value for Acme Corp?",
    "What is RSP's annual revenue, and how does that compare to TATA ELXSI's revenue?",
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

    return f"""Answer the question using ONLY the context below. Each [Source N] block may come from a DIFFERENT document describing a DIFFERENT deal or proposal -- do not merge facts across different source documents as if they describe one thing. If the sources describe different deals, say so explicitly and answer per-source, or ask which one the user means. If the context doesn't contain enough information to answer, say so clearly instead of guessing.

Context:
{context}

Question: {question}

Answer:"""


def answer_question(question):
    chunks = retrieve_chunks(question)
    if not chunks:
        print("  No relevant chunks found in the vector store.")
        return

    prompt = build_prompt(question, chunks)
    response = ollama.generate(model=LLM_MODEL, prompt=prompt, options={"num_ctx": 8192})

    print(f"\nQuestion: {question}")
    print(f"\nAnswer: {response['response'].strip()}")
    print("\nSources:")
    for hit in chunks:
        meta = hit.get("metadata", {})
        print(f"  - {meta.get('source_file')} (page {meta.get('page')}, distance {hit['distance']:.4f})")
    print("-" * 80)


if __name__ == "__main__":
    for q in QUESTIONS:
        answer_question(q)