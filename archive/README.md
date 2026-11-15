# archive/

Not used by the website integration. Kept for reference. Do not deploy.

- `backend/`: the AI team's experiments, evaluation scripts, one-off AWS/database checks, demo-database runners,
  the old S3 -> Lambda ingestion pipeline (`lambda_handler.py`, `pipeline_core.py`, `process_s3_bucket.py`,
  `requirements_2.txt`) and `e2e_connector.py` (needs the AI team's private demo database).
- `Dockerfile.lambda`: the Lambda image of that old ingestion pipeline (not the Copilot service image).
- `db/crm_schema_only.sql`: CRM schema as of 5 Nov 2026 (structure only, no data).
- `frontend/`: the testing system's demo-only screens (user/role picker, documents panel and upload, splash screen)
  and old tool notes. The website chat (`frontend/src/widget/`) does not use any of them.
