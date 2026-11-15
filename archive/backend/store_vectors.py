import uuid
import boto3
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer

def chunk_text(text, chunk_size=60, overlap=15):
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        if end >= len(words):
            break
        start = end - overlap
    return chunks

# Chunk
reader = PdfReader("sample_closemore_doc.pdf")
records = []
for page_num, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    for c in chunk_text(text):
        records.append({"page": page_num, "text": c})

# Embed
model = SentenceTransformer("all-MiniLM-L6-v2")
texts = [r["text"] for r in records]
embeddings = model.encode(texts, normalize_embeddings=True)

# Build vector records for S3 Vectors
vectors = []
for rec, emb in zip(records, embeddings):
    vectors.append({
        "key": str(uuid.uuid4()),
        "data": {"float32": emb.tolist()},
        "metadata": {
            "page": rec["page"],
            "text": rec["text"],
        },
    })

# Store them
s3vectors = boto3.client("s3vectors")
response = s3vectors.put_vectors(
    vectorBucketName="vector-s3-bucket",
    indexName="closemore-docs",
    vectors=vectors,
)
print(f"Stored {len(vectors)} vectors")
print(response)