# Handoff: CloseMore AI Copilot → CloseMore website

For the website's main developer, from the AI team. This folder is everything needed to add the AI Copilot chat to
the CloseMore website. Read this page first; it tells you what you have, what to do, and what is still open.

## What the Copilot is

A chat assistant inside the website. A logged-in user asks in plain words ("deals closing this month in Indore",
"what does the security policy say about passwords?"). It answers from the CRM data **that user may see** and from
uploaded PDFs of their region, with tables, charts and sources.

It is a separate service (Python, Docker). You do not copy AI code into the website. You add:
- a small proxy in your backend,
- one `<script>` tag in your pages,
- two calls after document upload and delete,
- a one-time database migration.

How it works inside, and what every file is: **`ARCHITECTURE.md`**.

## What you receive

| Folder / file | What it is | You… |
|---|---|---|
| `backend/` | the AI service | deploy it (`Dockerfile`); edit only `website_connector.py` (if needed) and regenerate `schema.json` |
| `frontend/` | source of the chat widget | build `closemore-copilot.js` (`npm install && npm run build:widget`) and host it |
| `db/` | database migration + rollback + test | run on a copy, check, then on `closemore_next` |
| `docs/` | the guides (reading order below) | read |
| `.env.example` | every setting, secrets empty | copy to `.env` on the server and fill in |
| `archive/` | old scripts, reference only | ignore (not deployed) |

**Not included on purpose:**
- **Secrets.** Production uses **new** secrets that your side creates. `docs/SECRETS_HANDOVER.md` lists each one:
  what it is, who creates it and how. None of the AI team's demo or test keys are valid for production.
- **Data and logs.** No customer documents, logs, test data or database dumps are in this folder.
- **The two model servers** (`SQL_RAG_URL`, `BRAIN_URL`). They run on their own server; the AI team gives you the
  private addresses.

## Your steps

| # | Step | Guide |
|---|---|---|
| 1 | Read `docs/START_HERE_MAIN_DEVELOPER.md`, then `docs/INTEGRATION_GUIDE.md` | — |
| 2 | **Database:** run `db/prod_migration.sql` on a copy of the live database, do the checks, get team approval, run it on `closemore_next`. Set the `copilot_app` password; read the signing secret. **Never run `db/demo_reference/`.** | `docs/DATABASE_HANDOFF.md` |
| 3 | **Schema:** `cd backend && python build_schema.py --apply` against your database | `INTEGRATION_GUIDE.md` §3 |
| 4 | **Secrets and settings:** create the new secrets, fill `.env` (`RBAC_MODE=production`, `DOCUMENT_UPLOADS=off`, `WEBSITE_AUTH_MODE=service`, `PGSSLMODE=require`) | `docs/SECRETS_HANDOVER.md`, `INTEGRATION_GUIDE.md` §4 |
| 5 | **Deploy the AI service:** one container, **one instance**, private network only, reachable only from your backend. Check `GET /health`. | `INTEGRATION_GUIDE.md` §5 |
| 6 | **Proxy** in your backend (any language): `POST /api/copilot/ask` and `/feedback`; user id from your session; status codes passed through (errors too); timeout about 150 s; rate limit; CSRF exemption if needed. Check it with the `curl` commands in the guide. | `docs/WEBSITE_FRONTEND_GUIDE.md` §2 |
| 7 | **Widget:** build it, host `closemore-copilot.js`, add the `<script>` tag for logged-in users only, call `CloseMoreCopilot.reset()` on logout, CSP if you use one | `docs/WIDGET_INTEGRATION.md` |
| 8 | **Documents:** after a PDF upload to S3 call `/internal/index`; after delete call `/internal/remove` | `WEBSITE_FRONTEND_GUIDE.md` §5, `docs/API_CONTRACT.md` |
| 9 | **Go-live checks:** security checklist; a sales rep, a sales admin and a system admin each see only their own data; `python backend/test_contract.py` passes on the deployed version | `INTEGRATION_GUIDE.md` §6 |

## Open items

| # | Item | Status |
|---|---|---|
| 1 | **Document status on your upload screen** ("Processing / Ready / Failed"). The status is stored in `copilot_documents`, which only the Copilot's database role can read. | The AI team will add a way for your backend to read it. Until then, show "Uploaded" (`WEBSITE_FRONTEND_GUIDE.md` §5). |
| 2 | **Six decisions for the team** (personal fields, deals without region, `Admin` vs `System_Admin`, deal rules, region spelling, database exposure) | Your team decides: `DATABASE_HANDOFF.md` §8 |
| 3 | **Proxy review** | Send us your backend's language/framework and login method; we review your proxy once and can send an example in your language |

**What we need from you:**
- your backend's language, framework and login method (session or JWT);
- the S3 bucket and folder where the website stores uploaded PDFs;
- a fresh schema dump (`pg_dump --schema-only --no-owner`) if `closemore_next` changed since 5 Nov 2026;
- the answers to `DATABASE_HANDOFF.md` §8.

## What has been tested

On the AI team's side, with simulated models, database and AWS (no network):

```
backend> python test_contract.py       6/6 passed      (the website contract)
backend> python test_server.py         150/150 passed  (pipeline behaviour, RBAC wiring, errors)
backend> python test_phase4_parts.py   12/12 passed
backend> python test_guardrails.py     81 checks passed, 0 failed
frontend> npx tsc --noEmit             0 errors
frontend> npx vitest run               191/191 passed
frontend> npm run build:widget         dist-widget/closemore-copilot.js  1,082.57 kB (gzip 349.61 kB)
```

- The widget build contains no sample data and no mock mode.
- A secret scan of this folder found no keys, tokens, passwords or real addresses (details in
  `INTEGRATION_CHANGES.md`).
- `prod_migration.sql` was tested by the AI team on PostgreSQL 16 with a schema copy (`DATABASE_HANDOFF.md` §7).
  Your server runs 17: run `db/test_prod_migration.py` on a test server first.

**Not tested here:** the real model servers, real S3 / S3 Vectors, your live database, the Docker image on your
servers, and the widget inside the real website. These are your integration tests (steps 5–9).

## Rules that keep upgrades easy

- The AI team ships new versions. Replace every file **except** `backend/website_connector.py`,
  `backend/schema.json` and `.env`, run `python backend/test_contract.py`, and restart.
- The request/response contract (`docs/API_CONTRACT.md`) and the connector functions never change shape. New
  fields are optional; ignore fields you don't know.
- Never change who-sees-what in the AI code. The rules live in the database (`rbac` schema) and
  `backend/copilot_rbac.py`. If the rules must change, ask the AI team.
