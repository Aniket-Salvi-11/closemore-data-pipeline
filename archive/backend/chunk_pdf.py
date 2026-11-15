from pypdf import PdfReader

def chunk_text(text, chunk_size=60, overlap=15):
    """Sliding-window chunker over words. Overlap keeps ideas from being cut in half at chunk boundaries."""
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

reader = PdfReader("sample_closemore_doc.pdf")
records = []
for page_num, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    for c in chunk_text(text):
        records.append({"page": page_num, "text": c})

print(f"Total chunks: {len(records)}\n")
for i, r in enumerate(records):
    print(f"--- chunk {i} (page {r['page']}, {len(r['text'].split())} words) ---")
    print(r["text"])
    print()