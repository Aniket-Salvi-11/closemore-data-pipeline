# Secrets handover: CloseMore AI Copilot service

For the website's main developer. This file lists every secret the AI service needs: what it is, who creates it,
and where it goes. **It contains no values.**

## Ground rules

- **Production uses new secrets.** None of the AI team's demo or testing values (database passwords, AWS keys,
  signing secret) are handed over. They belong to the AI team's private demo database and test account and are never
  valid in production.
- Secrets go only into the AI service's environment (`.env` on the server, or your secrets store). Never put them in
  git, the Docker image (`.dockerignore` already excludes `.env*`), chat, tickets or screenshots.
- `.env.example` at the project root lists every setting. Copy it to `.env` and fill in the fields below. Every
  setting that is not listed here is a plain setting, not a secret.

## Secrets

| Variable | What it is | Who creates it (website side) | How |
|---|---|---|---|
| `COPILOT_DB_PASSWORD` | Password of `copilot_app`, the read-only database login the AI service uses. Row-level security filters every row by user. | Database administrator, after running `db/prod_migration.sql` | Choose a long random password, then `alter role copilot_app password '…';`. See `DATABASE_HANDOFF.md` §4 step 6. |
| `COPILOT_RBAC_SECRET` | Signing secret. The AI service signs each user ID with it, and the database rules check the signature. It **must equal** the value stored in the database. | Created **automatically by `prod_migration.sql`** (random 32 bytes in `rbac.app_secret`). The database administrator reads it once. | `select secret from rbac.app_secret;` (`DATABASE_HANDOFF.md` §4 step 7). **Do not generate your own value**: a different value makes every query fail. |
| `COPILOT_SERVICE_KEY` | Shared key between the website backend and the AI service. It is sent as `X-Copilot-Service-Key` on every call. | Website backend developer | At least 32 random characters, e.g. `python -c "import secrets;print(secrets.token_urlsafe(48))"`. Put the **same** value in the website backend's own secret store. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Access key of a **new IAM user created for the website's Copilot** (not the AI team's user). | Website's AWS administrator | Create a new IAM user, or better, use an instance/task role with no stored keys. The permissions it needs are listed below. |
| `POSTGRES_PASSWORD` (plus `POSTGRES_HOST/PORT/DB/USER`) | Database login in `db_connection.py`. `server.py` only checks at startup that these are set, and does not connect with them. `backend/build_schema.py` uses them to read table and column names. | Database administrator | Use the **`copilot_app` login here as well**, the same values as `COPILOT_DB_*`. The AI service must never be given the main app's database login (`DATABASE_HANDOFF.md` §4 step 8). |
| `WEBSITE_JWT_KEY` | Only if `WEBSITE_AUTH_MODE=jwt`: the public key (RS256) or shared secret used to verify the website's login token. | Website backend developer | With RS256, give the **public** key only. With `service` mode (the recommended one), leave it empty. |

## Not secret, but owned by the website side

| Variable | Value |
|---|---|
| `COPILOT_DB_HOST/PORT/NAME` | the shared CRM database (`closemore_next`) |
| `COPILOT_DB_USER` | `copilot_app` (already set) |
| `RBAC_LOOKUP_USER` | `User_ID` of an active system admin of your organization |
| `WEBSITE_DOCS_BUCKET`, `WEBSITE_DOCS_PREFIX` | where the website stores uploaded PDFs |
| `VECTOR_BUCKET`, `INDEX_NAME`, `DOCS_INDEX` | the S3 Vectors bucket and index for the website's documents |
| `SQL_RAG_URL`, `BRAIN_URL` | addresses of the two model servers (keep them on the private network) |

## AWS permissions for the new IAM user

From the calls the code makes (`backend/copilot_docs.py`, `backend/server.py`), with `DOCUMENT_UPLOADS=off`:

| Service | Actions | Resource |
|---|---|---|
| S3 | `s3:GetObject` | `arn:aws:s3:::<WEBSITE_DOCS_BUCKET>/<WEBSITE_DOCS_PREFIX>*` |
| S3 Vectors | `s3vectors:QueryVectors`, `s3vectors:GetVectors` (needed by queries that filter or return metadata), `s3vectors:PutVectors`, `s3vectors:DeleteVectors`, `s3vectors:GetIndex` | the vector bucket and its index |

`s3:PutObject` / `s3:DeleteObject` are only used by the AI app's own upload screen, which is off in the integration.

## Before go-live

- [ ] Every secret above is new and was created by the website side.
- [ ] `COPILOT_RBAC_SECRET` was read from `rbac.app_secret` in the **production** database.
- [ ] `COPILOT_SERVICE_KEY` is identical in the website backend and the AI service, and in nothing else.
- [ ] No `.env` file is in git or in the Docker image.
- [ ] `PGSSLMODE=require` (or `verify-full`) is set and the database accepts SSL, so passwords and data never
      travel unencrypted.
