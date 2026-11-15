"""
Lambda entry point. Triggered by an S3 Event Notification
(s3:ObjectCreated:*, prefix "AI/", suffix ".pdf") on the dev-closemore
bucket. Processes exactly the file(s) named in the event -- normally one,
but S3 can batch multiple records into a single event, so we loop.

Failure handling (current, deliberately minimal): on error, we log clearly
with the source key and re-raise. For async S3->Lambda invocations, Lambda
automatically retries a failed invocation (default: 2 retries with a delay)
before giving up. There is no DLQ or notification configured yet -- if a
file fails all retries, the only record is in CloudWatch Logs. This was a
deliberate starting choice; adding an SQS DLQ or SNS failure topic later
does not require reworking this handler, only adding a "DestinationConfig"
(OnFailure) to the Lambda's event invoke config.
"""

import logging
import urllib.parse

from pipeline_core import process_file, SOURCE_PREFIX

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    results = []
    errors = []

    for record in event.get("Records", []):
        try:
            bucket = record["s3"]["bucket"]["name"]
            # S3 event keys are URL-encoded (e.g. spaces as '+')
            raw_key = record["s3"]["object"]["key"]
            key = urllib.parse.unquote_plus(raw_key)
        except (KeyError, TypeError) as e:
            logger.error(f"Malformed S3 event record, skipping: {record!r} ({e})")
            errors.append({"record": record, "error": str(e)})
            continue

        # Belt-and-suspenders: the S3 Event Notification filter should
        # already restrict us to AI/*.pdf, but don't trust that blindly.
        if not key.startswith(SOURCE_PREFIX):
            logger.info(f"Skipping '{key}' -- not under prefix '{SOURCE_PREFIX}'")
            continue
        if not key.lower().endswith(".pdf"):
            logger.info(f"Skipping '{key}' -- not a .pdf file")
            continue

        try:
            result = process_file(bucket, key)
            results.append(result)
        except Exception as e:
            # Log clearly with the offending file identified, so a
            # corrupted PDF or one-off failure doesn't get lost silently.
            logger.error(f"FAILED processing s3://{bucket}/{key}: {e}", exc_info=True)
            errors.append({"source_file": key, "error": str(e)})

    if errors:
        # Re-raise so Lambda's built-in async retry kicks in. If some
        # records succeeded and some failed in the same batch, note that
        # succeeded ones already wrote their vectors/manifest -- a retry
        # will re-process the whole event, and successful files will just
        # get an extra version appended (safe, if slightly wasteful, given
        # the append-only versioning behavior).
        raise RuntimeError(f"{len(errors)} file(s) failed processing: {errors}")

    logger.info(f"Successfully processed {len(results)} file(s): {results}")
    return {"processed": results}
