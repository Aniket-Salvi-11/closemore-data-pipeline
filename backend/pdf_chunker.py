"""
pdf_chunker.py -- the chunking functions from process_s3_bucket.py, copied UNCHANGED so they can be
imported (process_s3_bucket.py starts processing the bucket as soon as it is imported).

Use:  chunks = chunk_pdf("file.pdf")   ->  [{"page": int, "text": str, "group": str|None}, ...]
"""
import re
from collections import Counter

import pdfplumber

GAP_THRESHOLD = 15
BOILERPLATE_PAGE_THRESHOLD = 3
HEADING_FONT_MARGIN = 1.5
TARGET_WORDS = 300
COLOR_DIFF_THRESHOLD = 0.08


# ---------------------------------------------------------------------------
# Chunking logic (general -- not specific to any one document's wording),
# same as chunk_pdf_v9.py
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
    """Strips a trailing page number (with or without a 'Page' label) so a
    footer/header that differs only by page number still matches across pages."""
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
        print("  WARNING: no heading/section boundaries detected -- falling back to "
              "plain word-count chunking. Deal/section structure could not be identified.")
        for c in chunks:
            c["group"] = "UNSTRUCTURED (no heading detected)"

    return chunks


def chunk_pdf(pdf_path):
    all_lines = extract_line_data(pdf_path)
    known_headers = find_repeated_first_lines(all_lines)
    body_size = find_body_font_size(all_lines, known_headers)
    body_color = find_body_color(all_lines, known_headers)
    return build_chunks(all_lines, known_headers, body_size, body_color)
