"""
DEMO ACT 1 -- Ingestion automation, live.

Story: query for a deal that doesn't exist in the system yet -> upload its
PDF to S3 -> query again -> now it's there, automatically, with no manual
script run.

Run this in two parts during the demo:
    python demo_act1_ingestion.py before   <-- run BEFORE uploading the PDF
    (upload the PDF to S3 here, live, in front of the room)
    python demo_act1_ingestion.py after    <-- run AFTER uploading

This is presentation output, not debug logs -- deliberately terse and
clearly sectioned so the room can follow it without you narrating over
raw CloudWatch text.
"""

import sys
import time

from retrieval_core import retrieve_chunks

DEMO_QUESTION = "What is the deal value and stage for the Skyline Manufacturing deal?"


def banner(text):
    width = 70
    print("\n" + "=" * width)
    print(text.center(width))
    print("=" * width + "\n")


def run_query(question):
    print(f'Question: "{question}"\n')
    t0 = time.time()
    chunks = retrieve_chunks(question, top_k=5)
    elapsed = time.time() - t0

    if not chunks:
        print("  -> NO RESULTS FOUND in the knowledge base.\n")
        print(f"  (searched in {elapsed:.2f}s)")
        return

    print(f"  -> {len(chunks)} matching chunk(s) found (in {elapsed:.2f}s):\n")
    for i, hit in enumerate(chunks, start=1):
        meta = hit.get("metadata", {})
        print(f"  [{i}] {meta.get('source_file')} (page {meta.get('page')}, distance {hit.get('distance'):.4f})")
        text_preview = (meta.get("text", "")[:150] + "...") if len(meta.get("text", "")) > 150 else meta.get("text", "")
        print(f"      \"{text_preview}\"\n")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else None

    if mode == "before":
        banner("ACT 1 -- STEP 1: QUERY BEFORE UPLOAD")
        print("Asking the system about a deal it has never seen...\n")
        run_query(DEMO_QUESTION)
        print("\n>>> Now upload the deal PDF to S3 (AI/ prefix) and wait for processing. <<<")
        print(">>> Then run: python demo_act1_ingestion.py after <<<\n")

    elif mode == "after":
        banner("ACT 1 -- STEP 2: QUERY AFTER UPLOAD")
        print("Same question, asked again after the new PDF was ingested...\n")
        run_query(DEMO_QUESTION)
        print("\nNo manual script was run to process that file -- S3 upload")
        print("triggered the Lambda automatically, end to end.\n")

    else:
        print("Usage: python demo_act1_ingestion.py [before|after]")
        sys.exit(1)
