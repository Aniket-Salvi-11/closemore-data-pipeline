# CloseMore AI Copilot: architecture and file guide

How the Copilot works, how it connects to the CloseMore website, and what every file in this folder does.
For setup steps see `HANDOFF_FOR_MAIN_DEVELOPER.md` and `docs/`.

## 1. The system

```
 Browser (CloseMore website, logged-in user)
   closemore-copilot.js (chat widget, Shadow DOM)
      |  POST /api/copilot/ask, /api/copilot/feedback       same domain, login cookie, JSON
      v
 Website backend (yours, any language)
      |  checks the login, adds X-Copilot-Service-Key + X-Copilot-User-Id (from YOUR session)
      |  after a PDF upload / delete: POST /internal/index, /internal/remove (service key)
      v
 AI Copilot service (this folder: backend/, Python 3.11, FastAPI, one Docker container, one instance)
      |                      |                               |
      | SQL as copilot_app   | HTTP (OpenAI-style chat)      | AWS SDK
      v                      v                               v
 closemore_next          two llama.cpp model servers     S3 (website PDFs, read only)
 (PostgreSQL, row-level  "brain"   = fine-tuned 8B       S3 Vectors (document search index)
  security for the       "sql_rag" = base 8B
  Copilot's role only)
```

**Trust boundaries**
- The browser never reaches the AI service, never holds a secret, and never sends a user id.
- The website backend is the only caller. It proves itself with `COPILOT_SERVICE_KEY` and says which user is asking.
- The AI service decides nothing about permissions on its own. It signs the user id (`COPILOT_RBAC_SECRET`), and
  **PostgreSQL row-level security** returns only the rows that user may see. Even a wrong SQL query from the model
  cannot read more.

## 2. What happens to one question

`POST /v1/ask {question, session_id}` (`backend/server.py`):

1. **Who is asking.** `copilot_rbac.get_current_user()` → `website_connector.get_website_user()` checks the service
   key and reads `X-Copilot-User-Id` (or a JWT). Unknown or inactive users get `401`.
2. **Input guardrails** (`guardrails.py`). These are rules, with no model call: prompt injection, probing for
   secrets or system details, attempts to change data, toxic language and oversized messages are blocked with a
   fixed reply. Real CRM names are never treated as bad words.
3. **Conversation state** (`session_store.py`, `conversation.py`). It handles answers to "which one did you mean?"
   (letters A, B, …), "Shall I try again?" yes/no, and a short server-side memory of earlier turns for follow-ups
   ("and his deals?").
4. **Understanding** (`understander.py`). One call to the brain model returns JSON: the route
   (`CHAT | SQL | RAG | BOTH`), whether the message depends on earlier turns, a standalone rewrite of the question,
   the names it mentions, a safety flag, and:
   - **relevance**: an *irrelevant* question (weather, poems, general knowledge) gets a fixed "I can only help
     with your CRM data and documents" reply; an *ambiguous* one gets a follow-up question from Cleo instead of
     a guess. Missing = relevant (normal pipeline).
   - **BOTH split**: for a CRM + document question, the CRM part and the document part as two questions, so
     each side only gets its own part and only CRM names are looked up in the CRM. If a company or product
     named in a SQL question is not in the CRM, code upgrades it to BOTH and sends that part to the documents.
5. **Names → ids** (`entity_lookup.py`). People, deals, companies and products are looked up in the database (exact
   match first, then a spelling-tolerant match). If two people share a name, the user gets a lettered "which one?"
   list.
6. **SQL route.**
   - `sql_templates.py`: reviewed, fixed SQL for the most common questions. No model call.
   - Otherwise the sql_rag model writes SQL. Before it runs, it is checked by `helper.py` (clean-up),
     `guardrails.py` (SQL rules), `schema_check.py` (tables and columns exist in `schema.json`) and the RBAC SQL guard
     (`copilot_rbac.check_sql`: one plain `SELECT` on allowed tables). PostgreSQL `EXPLAIN` runs as well.
   - It runs through `copilot_rbac` on a **read-only connection as `copilot_app`, with the signed user identity**;
     row-level security filters the rows.
   - A problem, an error or zero rows gets at most one model fix and one second run.
7. **RAG route.** The question is embedded locally (sentence-transformers). S3 Vectors returns the nearest
   passages, already filtered to the documents this user may see (`copilot_docs.py`, region rules). Passages that
   are too far away are dropped. The model answers only from the passages kept, and sources (file, page) are
   attached.
8. **Fallback** (`FALLBACK_ENABLED`). If SQL finds nothing, the documents are searched once. If the documents have
   nothing, the CRM is tried once. Both use the same per-user rules.
9. **Answer** (`answer_text.py`, `result_view.py`).
   - Rows become a `table` (up to `TABLE_MAX_ROWS`, default 200, sent; the widget shows 50 at a time) and, when the
     shape suits, a `chart`. Both are chosen by rules, not by the model.
   - The text above a table is one short line written by code, or by the model and then checked: no invented names
     or numbers, no leaked prompt.
   - `scope` says who the answer was for. Choices and letters drive the "which one?" lists.
10. **Logging** (`session_logger.py`, `copilot_rbac.audit`). One log file per chat session in `LOG_DIR` and one
    audit line per request (`audit.jsonl`). They contain real questions: restrict access and delete after a fixed
    period.

Errors never crash the chat. Database down, model unreachable or timeout give a fixed friendly message with
HTTP 200 and `route: "ERROR"`. Only permission problems are HTTP errors (401/403/404).

**Documents from the website.** The website stores a PDF in its S3 bucket and calls `POST /internal/index`.
`copilot_docs.index_from_s3` then:
1. checks that the owner may upload into that region;
2. records the document (`rbac.doc_create`, status `processing`);
3. reads the PDF from S3 (max 20 MB, must be a PDF);
4. in the background, cuts it into passages (`pdf_chunker.py`), embeds them and writes them to S3 Vectors with the
   region;
5. sets the status to `ready` (or `failed` with a reason).

`POST /internal/remove` deletes the vectors and the record. The PDF stays in the website's bucket.

## 3. Who sees what (enforced in the database)

| Role | Deals | Contacts | Documents |
|---|---|---|---|
| System admin | all of the company | all | all |
| Sales admin / Executive, no region | all of the company | all | all |
| Sales admin / Executive, with regions | their regions | contacts of those deals | their regions |
| Sales rep | their regions, and only deals they own or are on the team of | contacts of those deals | their regions |

- Always limited to the user's own organization and to active users.
- The rules live in the `rbac` schema created by `db/prod_migration.sql`. They apply **only to the Copilot's
  database role**, so the main app's own access is unchanged.
- Details: `docs/DATABASE_HANDOFF.md` §2–3.

## 4. Runtime facts that matter for operations

| Fact | Consequence |
|---|---|
| One question at a time | Others wait in line. Proxy timeout about 150 s. |
| Conversation memory and "who may rate which answer" are in process memory | Run **exactly one instance**. A restart loses ongoing follow-up context; rating an older answer then returns 404. |
| The embedding model downloads on first start | The first start needs internet (Hugging Face) or a pre-filled model cache. Startup takes longer. |
| Models are remote (`SQL_RAG_URL`, `BRAIN_URL`) | `GET /health` reports whether both answer. Keep them on the private network. |
| `RBAC_MODE=production`, `DOCUMENT_UPLOADS=off` | The demo user picker (`/demo/users`, `X-Demo-User`) and the AI app's own upload endpoints are off. |
| `PGSSLMODE=require` | Database connections are encrypted. The database must accept SSL. |

## 5. Every file

### Root

| File | What it does |
|---|---|
| `HANDOFF_FOR_MAIN_DEVELOPER.md` | the handover letter: what you get, what to do, what is open |
| `ARCHITECTURE.md` | this file |
| `README.md` | short overview and who owns which part |
| `INTEGRATION_CHANGES.md` | how this integration version was made from the AI team's testing system (changes, tests, scans) |
| `Dockerfile` | builds the AI service image: Python 3.11, copies `backend/` only, runs as a non-root user, health check on `/health`, `uvicorn server:app` on port 8000 |
| `requirements.txt` | Python packages of the AI service |
| `.env.example` | every setting, with empty secrets; copy to `.env` (never commit) |
| `.dockerignore` | keeps `.env`, logs, PDFs, `frontend/`, `db/`, `archive/` out of the image |
| `.gitignore` | keeps `.env*`, logs, caches, build output, PDFs and models out of git |
| `logs/` | empty; the service writes session logs and the audit log here (`LOG_DIR`, `RBAC_AUDIT_DIR`) |

### `backend/` (the AI service)

| File | What it does |
|---|---|
| `server.py` | the FastAPI app and the whole question pipeline (section 2); endpoints `/ask`, `/v1/ask`, `/feedback`, `/v1/feedback`, `/health`; loads the embedding model and the S3 Vectors client |
| `website_connector.py` | **the website's file.** `get_website_user()` (service key + user id header, or JWT) and the endpoints `/internal/index` and `/internal/remove` |
| `copilot_rbac.py` | who is asking and what they may see: user loading, signed identity, read-only per-user connections, SQL guard, scope labels, audit log, `GET /me` (and `/demo/users`, off in production). **Do not change.** |
| `copilot_docs.py` | documents: index from the website's S3, remove, and the region-filtered vector search; the AI app's own `/documents` endpoints (off in production) |
| `understander.py` | first model call per question: route, follow-up detection, standalone rewrite, names, safety (JSON) |
| `entity_lookup.py` | finds people, deals, products and companies named in a question, in the database; spelling-tolerant; "which one?" candidates |
| `sql_templates.py` | fixed, reviewed SQL for the most common questions (no model call) |
| `helper.py` | SQL clean-up of model output: strip text around the SQL, fix dialect, quote identifiers |
| `schema_check.py` | checks generated SQL against `schema.json` before it runs (unknown tables, columns, aliases) |
| `schema_format.py` | turns `schema.json` into the compact text the SQL model sees |
| `schema.json` | the CRM tables and columns the Copilot may query, plus a few category values (stages, roles). **Regenerate from your database** with `build_schema.py`. |
| `build_schema.py` | builds `schema.json` from the live database (`--apply` replaces it; the old one is kept as `schema_old.json`) |
| `guardrails.py` | input rules (injection, probing, write intent, toxicity, size), SQL rules (one read-only statement, no system catalogs, LIMIT added) and output rules (prompt leaks, internal URLs); no model calls. Extra blocked words: `blocked_words.txt` if `BLOCKED_WORDS_FILE` points to one |
| `conversation.py` | chat-history helpers: cleaning, "Shall I try again?", yes/no, repeat detection |
| `session_store.py` | server-side memory of each chat's recent turns (by `session_id`), in process memory |
| `session_logger.py` | one log file per chat session: guard decisions, model calls, SQL, sources, timing |
| `answer_text.py` | the text above a result: code-written sentences, the rows the model may see, checks on the model's answer |
| `result_view.py` | turns rows into the response's `table` and `chart` (chosen by rules) |
| `pdf_chunker.py` | cuts a PDF into passages with page numbers (used when indexing website documents) |
| `db_connection.py` | loads `.env` and opens a database connection from `POSTGRES_*` (used by `build_schema.py`; SSL by `PGSSLMODE`) |
| `test_contract.py` | **the website contract:** request and response fields, routes, connector functions and headers must never change; run after every upgrade (6 tests) |
| `test_server.py` | behaviour tests of the whole pipeline with fake models, database and AWS (150 tests) |
| `test_phase4_parts.py` | tests for `answer_text`, `session_store`, `understander` (12 tests) |
| `test_guardrails.py` | tests for `guardrails.py` (81 checks) |
| `test_stubs.py` | the fake database, models and AWS used by the tests (no network needed) |
| `rbac_baseline_functions.json`, `rbac_baseline_lines.txt` | frozen copies of the RBAC-related code in `server.py`; `test_server.py` checks it has not changed |

### `db/` (database changes for `closemore_next`)

| File | What it does |
|---|---|
| `prod_migration.sql` | adds the Copilot's roles (`copilot_app`, `copilot_ro`, `copilot_rules_owner`), the `rbac` schema (signing secret, rules), Copilot-only policies, and `copilot_documents`. Additions only. Run as superuser, first on a copy. |
| `prod_rollback.sql` | removes everything the migration added |
| `test_prod_migration.py` | on a local **test** server with a schema-only copy: runs the migration twice, checks every user sees exactly what the rules allow, that forged identities get nothing, that secrets and passwords are unreadable, that the main app's view is identical before, after and after rollback, and that rollback is complete. Never point it at the shared server. |
| `demo_reference/` | the AI team's scripts for their private, masked demo database (`01_…sql`–`05_…sql`, `make_demo_copy.py`). Reference only: **never run on the live database.** |

### `docs/`

| File | For |
|---|---|
| `START_HERE_MAIN_DEVELOPER.md` | reading order and what to build |
| `INTEGRATION_GUIDE.md` | connector, database, settings, running, security checklist, upgrades |
| `DATABASE_HANDOFF.md` | the database migration: what it adds, the rules, how to apply, check and undo, decisions for the team |
| `SECRETS_HANDOVER.md` | every secret: what it is, who creates it, how; AWS permissions |
| `WEBSITE_FRONTEND_GUIDE.md` | the website proxy (rules, pseudocode, curl checks) and how the chat behaves |
| `WIDGET_INTEGRATION.md` | building the widget, the `<script>` tag, `reset()` on logout, CSP |
| `API_CONTRACT.md` | every endpoint's request and response |
| `FRONTEND_HANDOFF_letters_multi_select.md` | display rules for "which one?" lists, letters and people chips |

### `frontend/` (the chat widget)

The source of `closemore-copilot.js`, built with `npm install && npm run build:widget` (React, Vite, Tailwind).
The output is one file, `dist-widget/closemore-copilot.js`, with styles and images inside.

| Path | What it does |
|---|---|
| `src/widget/main.tsx` | widget entry: reads the `<script>` attributes (`data-api-base`, `data-position`, `data-fonts`, `data-auto`), mounts the chat in a Shadow DOM, exposes `window.CloseMoreCopilot` (`open`, `close`, `toggle`, `reset`, `init`, `destroy`) |
| `src/widget/prepare-css.ts` | adapts the stylesheet for the Shadow DOM (no effect on the website's CSS, and the other way round; `rem` becomes `px` in values only, never in class names) |
| `src/widget/no-mock.ts` | replaces the simulated answers in the website build, so sample data can never ship |
| `src/components/copilot/` | `CopilotWidget` (Cleo's face button, greeting bubble once per tab, open/close and resize animations, normal / wide / full-screen sizes, bottom-right or bottom-left) and `CopilotPanel` (the chat panel: Cleo header, conversation, input) |
| `src/components/chat/` | the chat pieces: message list item, composer, answer text (safe Markdown), choice lists, people chips, result tables (sort, search, copy, fullscreen), charts, source chips, thumbs up/down |
| `src/components/ui/` | standard UI building blocks (shadcn/ui); only those the widget imports are bundled |
| `src/hooks/use-chat.ts` | the conversation: `session_id`, sending, one question at a time, saving the chat in sessionStorage for the tab |
| `src/lib/api-service.ts` | the only network code: `POST {apiBase}/ask` and `/feedback` with the login cookie; error handling (401, 4xx `detail`, 5xx/timeout with Retry; 150 s timeout) |
| `src/lib/runtime-config.ts` | where requests go (`data-api-base`, default `/api/copilot`) and which corner Cleo uses (`data-position`) |
| `src/lib/result-data.ts`, `table-view.ts`, `chart-layout.ts`, `copy-text.ts`, `people.ts`, `cascade.ts`, `route-badge.ts`, `row-number-pref.ts`, `thinking-stages.ts`, `format-message-meta.ts`, `assets.ts`, `portal-container.tsx`, `utils.ts` | display helpers: tables, charts, copying, letters, animations, badges, loading text, time, built-in images, pop-up placement |
| `src/lib/mock-api.ts`, `mock-rbac.ts`, `mock-users.ts`, `demo-users.ts` | sample answers for local development only (`VITE_USE_MOCK_API=true`); replaced by `no-mock.ts` in the website build |
| `src/routes/`, `router.tsx`, `start.ts`, `server.ts`, `routeTree.gen.ts`, `lib/error-*.ts`, `lib/lovable-error-reporting.ts` | a small development page (`npx vite dev`) that shows the widget on a stand-in website |
| `src/test/`, `*.test.ts(x)`, `vitest.config.ts` | frontend tests (`npx vitest run`) |
| `widget-demo/index.html` | test page with deliberately hostile CSS, to check the built widget is not affected |
| `vite.widget.config.ts` | the widget build: one file, ignores `.env` files, never includes mock data |
| `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `components.json`, `.prettierrc`, `.prettierignore` | build, type check, lint and format settings |
| `package.json`, `package-lock.json` | dependencies and scripts (`build:widget`, `test`, `lint`) |
| `public/` | Cleo's pictures (`cleo_face.png`, `cleo_body.png`), logos and icons (bundled into the widget) |

### `archive/`

Old scripts, experiments, evaluation tools, the old Lambda ingestion pipeline and the testing system's demo screens.
Not used, not deployed (excluded from the Docker image). See `archive/README.md`.
