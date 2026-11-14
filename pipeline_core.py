"""
Shared chunk -> embed -> store -> manifest logic used by both:
  - process_s3_bucket.py (manual/backfill full-bucket run)
  - lambda_handler.py (single-file, event-triggered run)

Versioning behavior: re-uploading a file with the same key does NOT delete
prior vectors. Each processing run appends a new "version" of vectors for
that source file; old and new vectors both remain live and searchable in
the S3 Vectors index. The manifest for a source file becomes a list of
version entries rather than a flat list of vector keys, so each version's
vectors can still be identified/deleted individually later if ever needed.
"""

import json
import re
import time
import uuid
import logging
from collections import Counter

import boto3
import pdfplumber
from sentence_transformers import SentenceTransformer

logger = logging.getLogger()
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)
logger.setLevel(logging.INFO)

SOURCE_BUCKET = "dev-closemore"
SOURCE_PREFIX = "AI/"
VECTOR_BUCKET = "vector-s3-bucket"
INDEX_NAME = "closemore-docs"
MANIFEST_PREFIX = "vector-manifests/"

MODEL_NAME = "all-MiniLM-L6-v2"

GAP_THRESHOLD = 15
BOILERPLATE_PAGE_THRESHOLD = 3
HEADING_FONT_MARGIN = 1.5
TARGET_WORDS = 300
COLOR_DIFF_THRESHOLD = 0.08

# ---------------------------------------------------------------------------
# Chunking logic (unchanged from process_s3_bucket.py -- general, not tied
# to any specific document's wording)
# ---------------------------------------------------------------------------


def line_in_any_table(top, bottom, table_bboxes):
    for (x0, t_top, x1, t_bottom) in table_bboxes:
        if top >= t_top - 1 and bottom <= t_bottom + 1:
            return True
    return False


def normalize_color(c):
    if c is None:
        return None
    if len(c) == 1:
        c = (c[0], c[0], c[0])
    return tuple(round(v, 2) for v in c[:3])


def colors_differ(c1, c2, threshold=COLOR_DIFF_THRESHOLD):
    if c1 is None or c2 is None:
        return False
    return max(abs(a - b) for a, b in zip(c1, c2)) > threshold


def normalize_edge_text(text):
    return re.sub(r"\s*(page\s*)?\d+\s*$", "", text.strip(), flags=re.IGNORECASE).strip()


def extract_line_data(pdf_path):
    all_lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            lines = page.extract_text_lines()
            chars = page.chars

            table_bboxes = []
            for t in page.find_tables():
                data = t.extract()
                non_empty = sum(1 for row in data for cell in row if cell and cell.strip())
                if non_empty >= 6:
                    table_bboxes.append(t.bbox)

            page_line_infos = []
            for line in lines:
                top = round(line["top"], 1)
                bottom = round(line["bottom"], 1)
                relevant = [c for c in chars if round(c["top"], 1) == top]

                sizes = [round(c["size"], 1) for c in relevant]
                size = max(sizes) if sizes else 0

                bold_count = sum(1 for c in relevant if "bold" in c["fontname"].lower())
                bold_fraction = bold_count / len(relevant) if relevant else 0

                norm_colors = [normalize_color(c.get("non_stroking_color")) for c in relevant]
                norm_colors = [c for c in norm_colors if c is not None]
                color_counts = Counter(norm_colors)
                majority_color, majority_n = color_counts.most_common(1)[0] if norm_colors else (None, 0)
                color_fraction = majority_n / len(norm_colors) if norm_colors else 0

                text_letters = re.sub(r"[^A-Za-z]", "", line["text"])
                is_all_caps = len(text_letters) >= 4 and text_letters.isupper()

                page_line_infos.append({
                    "text": line["text"], "top": top, "bottom": bottom, "size": size,
                    "is_bold": bold_fraction >= 0.8,
                    "color": majority_color, "color_fraction": color_fraction,
                    "is_all_caps": is_all_caps,
                    "in_table": line_in_any_table(top, bottom, table_bboxes),
                })
            all_lines.append({"page": page_num, "lines": page_line_infos})
    return all_lines


def find_repeated_first_lines(all_lines, min_pages=BOILERPLATE_PAGE_THRESHOLD):
    edge_line_pages = {}
    for page_data in all_lines:
        lines = page_data["lines"]
        if not lines:
            continue
        for line in (lines[0], lines[-1]):
            key = normalize_edge_text(line["text"])
            if key:
                edge_line_pages.setdefault(key, set()).add(page_data["page"])
    return {t for t, pages in edge_line_pages.items() if len(pages) >= min_pages}


def find_body_font_size(all_lines, known_headers):
    word_totals = Counter()
    for page_data in all_lines:
        for i, line in enumerate(page_data["lines"]):
            if i == 0 and line["text"].strip() in known_headers:
                continue
            word_totals[line["size"]] += len(line["text"].split())
    return word_totals.most_common(1)[0][0]


def find_body_color(all_lines, known_headers):
    word_totals = Counter()
    for page_data in all_lines:
        for i, line in enumerate(page_data["lines"]):
            if i == 0 and line["text"].strip() in known_headers:
                continue
            if line["color"] is not None and line["color_fraction"] >= 0.8:
                word_totals[line["color"]] += len(line["text"].split())
    return word_totals.most_common(1)[0][0] if word_totals else None


def build_chunks(all_lines, known_headers, body_size, body_color, target_words=TARGET_WORDS,
                  heading_font_margin=HEADING_FONT_MARGIN, gap_threshold=GAP_THRESHOLD):
    chunks = []
    current_texts, current_page, current_count, current_group = [], None, 0, None
    heading_accum_texts = []
    any_boundary_fired = False

    def close_chunk():
        nonlocal current_texts, current_page, current_count
        if current_texts:
            chunks.append({"page": current_page, "text": " ".join(current_texts), "group": current_group})
        current_texts, current_page, current_count = [], None, 0

    for page_data in all_lines:
        page_num = page_data["page"]
        page_line_count = len(page_data["lines"])
        prev_bottom = None
        for i, line in enumerate(page_data["lines"]):
            is_edge_line = (i == 0 or i == page_line_count - 1)
            is_repeat_header = (is_edge_line and normalize_edge_text(line["text"]) in known_headers)
            if is_repeat_header:
                prev_bottom = line["bottom"]
                heading_accum_texts = []
                continue

            is_page_number = line["text"].strip().isdigit() and len(line["text"].strip()) <= 3

            is_size_heading = line["size"] >= body_size + heading_font_margin
            is_bold_heading = line["is_bold"] and not line["in_table"]
            is_color_heading = (
                line["color_fraction"] >= 0.8 and not line["in_table"]
                and colors_differ(line["color"], body_color)
            )
            is_caps_heading = line["is_all_caps"] and not line["in_table"]

            is_boundary = (not is_page_number) and (
                is_size_heading or is_bold_heading or is_color_heading or is_caps_heading
            )

            gap = line["top"] - prev_bottom if prev_bottom is not None else 999

            if is_page_number:
                prev_bottom = line["bottom"]
                continue

            if is_boundary:
                any_boundary_fired = True
                if heading_accum_texts and gap <= gap_threshold:
                    heading_accum_texts.append(line["text"])
                else:
                    close_chunk()
                    heading_accum_texts = [line["text"]]
                current_group = " ".join(heading_accum_texts)
                if current_page is None:
                    current_page = page_num
                current_texts.append(line["text"])
                current_count += len(line["text"].split())
                prev_bottom = line["bottom"]
                continue

            heading_accum_texts = []
            word_count = len(line["text"].split())
            if current_count > 0 and current_count + word_count > target_words:
                close_chunk()
            if current_page is None:
                current_page = page_num
            current_texts.append(line["text"])
            current_count += word_count
            prev_bottom = line["bottom"]

    close_chunk()

    if not any_boundary_fired:
        logger.warning(
            "No heading/section boundaries detected -- falling back to plain "
            "word-count chunking. Deal/section structure could not be identified."
        )
        for c in chunks:
            c["group"] = "UNSTRUCTURED (no heading detected)"

    return chunks


def chunk_pdf(pdf_path):
    all_lines = extract_line_data(pdf_path)
    known_headers = find_repeated_first_lines(all_lines)
    body_size = find_body_font_size(all_lines, known_headers)
    body_color = find_body_color(all_lines, known_headers)
    return build_chunks(all_lines, known_headers, body_size, body_color)


# ---------------------------------------------------------------------------
# Manifest helpers (VERSIONING, not replace-on-reupload)
#
# Manifest shape (per source file), stored as JSON at
# vector-manifests/<safe-source-file>.json:
#
# {
#   "source_file": "AI/example.pdf",
#   "versions": [
#     {
#       "version": 1,
#       "ingested_at": "2026-09-07T10:15:00Z",
#       "vector_keys": ["<uuid>", "<uuid>", ...]
#     },
#     {
#       "version": 2,
#       "ingested_at": "2026-09-08T09:00:00Z",
#       "vector_keys": ["<uuid>", ...]
#     }
#   ]
# }
#
# Old versions' vectors are NEVER deleted automatically. This is a deliberate
# behavior change from the original manual script (which deleted-then-
# replaced on same-key reupload). Both old and new chunks stay queryable.
# ---------------------------------------------------------------------------


def manifest_key_for(source_file):
    safe_name = source_file.replace("/", "__")
    return f"{MANIFEST_PREFIX}{safe_name}.json"


def load_manifest(s3_client, source_file):
    try:
        obj = s3_client.get_object(Bucket=SOURCE_BUCKET, Key=manifest_key_for(source_file))
        return json.loads(obj["Body"].read())
    except s3_client.exceptions.NoSuchKey:
        return {"source_file": source_file, "versions": []}
    except s3_client.exceptions.ClientError:
        return {"source_file": source_file, "versions": []}


def save_manifest(s3_client, source_file, manifest):
    s3_client.put_object(
        Bucket=SOURCE_BUCKET,
        Key=manifest_key_for(source_file),
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
    )


def append_version_to_manifest(s3_client, source_file, new_vector_keys):
    manifest = load_manifest(s3_client, source_file)
    next_version = len(manifest["versions"]) + 1
    manifest["versions"].append({
        "version": next_version,
        "ingested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "vector_keys": new_vector_keys,
    })
    save_manifest(s3_client, source_file, manifest)
    return next_version


# ---------------------------------------------------------------------------
# Lazy singletons -- created once per Lambda execution environment (warm
# start reuses these across invocations) or once for the standalone script.
# ---------------------------------------------------------------------------

_s3_client = None
_s3vectors_client = None
_model = None


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def get_s3vectors_client():
    global _s3vectors_client
    if _s3vectors_client is None:
        _s3vectors_client = boto3.client("s3vectors")
    return _s3vectors_client


def get_model():
    global _model
    if _model is None:
        logger.info(f"Loading embedding model {MODEL_NAME} ...")
        _model = SentenceTransformer(MODEL_NAME)
    return _model


# ---------------------------------------------------------------------------
# Core per-file processing, shared by the Lambda handler and the standalone
# backfill script.
# ---------------------------------------------------------------------------

def process_file(bucket, key, local_download_path="/tmp/download.pdf"):
    """
    Downloads, chunks, embeds, and stores vectors for a single PDF, then
    appends a new version entry to that file's manifest.

    Returns a small result dict on success. Raises on failure -- callers
    (Lambda handler) are responsible for catching, logging clearly, and
    deciding whether to let the exception propagate (so Lambda's built-in
    retry behavior applies) or swallow it.
    """
    s3 = get_s3_client()
    s3vectors = get_s3vectors_client()
    model = get_model()

    logger.info(f"Downloading s3://{bucket}/{key}")
    s3.download_file(bucket, key, local_download_path)

    try:
        records = chunk_pdf(local_download_path)
    except Exception as e:
        raise RuntimeError(f"Failed to parse/chunk PDF '{key}': {e}") from e

    logger.info(f"{key}: {len(records)} chunk(s)")
    if not records:
        logger.warning(f"{key}: no chunks produced (empty or unparseable PDF) -- nothing to store")
        return {"source_file": key, "chunks": 0, "version": None}

    texts = [r["text"] for r in records]
    try:
        embeddings = model.encode(texts, normalize_embeddings=True)
    except Exception as e:
        raise RuntimeError(f"Failed to embed chunks for '{key}': {e}") from e

    vectors = []
    new_keys = []
    for rec, emb in zip(records, embeddings):
        vector_key = str(uuid.uuid4())
        new_keys.append(vector_key)
        vectors.append({
            "key": vector_key,
            "data": {"float32": emb.tolist()},
            "metadata": {
                "source_file": key,
                "page": rec["page"],
                "group": (rec["group"] or "")[:500],
                "text": rec["text"][:2000],
            },
        })

    logger.info(f"{key}: storing {len(vectors)} new vector(s) (versioned, prior vectors untouched)")
    try:
        for i in range(0, len(vectors), 500):
            batch = vectors[i:i + 500]
            s3vectors.put_vectors(vectorBucketName=VECTOR_BUCKET, indexName=INDEX_NAME, vectors=batch)
    except Exception as e:
        raise RuntimeError(f"Failed to store vectors for '{key}': {e}") from e

    version = append_version_to_manifest(s3, key, new_keys)
    logger.info(f"{key}: stored as version {version}")

    return {"source_file": key, "chunks": len(records), "version": version}
