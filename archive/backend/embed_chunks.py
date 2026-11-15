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

# --- Step 1: chunk the PDF (same as before) ---
reader = PdfReader("sample_closemore_doc.pdf")
records = []
for page_num, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    for c in chunk_text(text):
        records.append({"page": page_num, "text": c})

print(f"Chunked into {len(records)} pieces")

# --- Step 2: load the embedding model ---
print("Loading model (first run downloads it from Hugging Face, ~80MB)...")
model = SentenceTransformer("all-MiniLM-L6-v2")

# --- Step 3: embed all chunks at once ---
texts = [r["text"] for r in records]
embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)

print(f"\nEmbedded {len(embeddings)} chunks")
print(f"Each vector has {len(embeddings[0])} dimensions")
print(f"\nFirst 5 numbers of chunk 0's vector: {embeddings[0][:5]}")