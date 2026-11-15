"""
Manual/backfill entry point: scans the whole SOURCE_PREFIX and processes
every PDF found. Per-file logic now lives in pipeline_core.py, shared with
lambda_handler.py so both paths stay in sync.

Note on behavior: re-running this over a file that was already ingested
will VERSION it (append new vectors, keep old ones), not replace it -- see
pipeline_core.py's manifest docstring for details.
"""

import logging

from pipeline_core import process_file, get_s3_client, SOURCE_BUCKET, SOURCE_PREFIX

logger = logging.getLogger()
logging.basicConfig(level=logging.INFO)


def main():
    s3 = get_s3_client()
    response = s3.list_objects_v2(Bucket=SOURCE_BUCKET, Prefix=SOURCE_PREFIX)
    pdf_keys = [
        obj["Key"] for obj in response.get("Contents", [])
        if obj["Key"].lower().endswith(".pdf")
    ]
    logger.info(f"Found {len(pdf_keys)} PDF files under {SOURCE_PREFIX} in {SOURCE_BUCKET}")

    for key in pdf_keys:
        logger.info(f"Processing: {key}")
        try:
            result = process_file(SOURCE_BUCKET, key)
            logger.info(f"  -> {result}")
        except Exception as e:
            logger.error(f"  FAILED: {key}: {e}", exc_info=True)

    logger.info("Done.")


if __name__ == "__main__":
    main()
