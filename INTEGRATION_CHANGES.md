# Integration changes

How this integration copy was made from the CloseMore AI Copilot testing system (2026-11-15), following
`CLAUDE_CODE_INTEGRATION_TASK.md`.

- **Source:** the testing system at `closemore-vector-rag/`, which is unchanged.
- **Inputs:** `handoff_in/` (backend, db, docs, root files from the AI team) and `phase15-update/` (the website
  chat widget).
- **This copy:** a separate folder with no git history (`git init` it fresh). `.env`, `.env.local`, `node_modules/`
  and `venv/` were never copied.

## Layout

| Folder | Contents |
|---|---|
| `backend/` | the AI service (`Dockerfile` copies only this folder) |
| `frontend/` | the chat app, formerly `clearanswer-chat-companion-main/`; `npm run build:widget` builds the website chat |
| `db/` | `prod_migration.sql`, `prod_rollback.sql`, `test_prod_migration.py`; `db/demo_reference/` holds the AI demo database scripts (do not run on live) |
| `docs/` | handoff documents for the main developer |
| `archive/` | not used by the integration; excluded from the Docker image |
| `logs/` | empty (`.gitkeep`) |

## Files replaced (22)

- **Backend, delivered (5):** `server.py`, `copilot_rbac.py`, `copilot_docs.py`, `session_store.py`,
  `test_server.py`. Each was compared with the testing version before it was replaced. The delivered files are the
  testing versions plus the integration changes only:
  - `/documents` is switched by `DOCUMENT_UPLOADS`;
  - the `website_connector` router is added;
  - `/v1/ask` and `/v1/feedback` aliases are added;
  - the website-login branch in `get_current_user`;
  - `index_from_s3` and `remove_indexed` in `copilot_docs.py`.
  Nothing from the testing versions was lost.
- **Root, delivered (2):** `Dockerfile` (the old Lambda one is in the archive), `requirements.txt`.
- **Frontend, phase15 (15):** `components/chat/ChatComposer.tsx`, `ChatMessage.tsx`, `JumpToLatest.test.tsx`,
  `PeoplePicker.test.tsx`; `components/ui/dialog.tsx`, `tooltip.tsx`; `hooks/use-chat.ts`, `use-near-bottom.ts`;
  `lib/api-service.ts`, `api-service.test.ts`; `routes/index.tsx`; `test/use-chat-history.test.tsx`,
  `use-chat-storage.test.tsx`.

## Files added (35)

- **`backend/` (2):** `website_connector.py`, `test_contract.py`.
- **`db/` (3):** `prod_migration.sql`, `prod_rollback.sql`, `test_prod_migration.py`.
- **`docs/` (8):** `API_CONTRACT.md`, `INTEGRATION_GUIDE.md`, `WEBSITE_FRONTEND_GUIDE.md`,
  `FRONTEND_HANDOFF_letters_multi_select.md`, `DATABASE_HANDOFF.md`, `WIDGET_INTEGRATION.md` (identical in
  `handoff_in` and `phase15-update`), `START_HERE_MAIN_DEVELOPER.md`, and **`SECRETS_HANDOVER.md`** (new: every
  secret, who creates it, no values).
- **Root (3):** `.env.example`, `.dockerignore`, `README.md`.
- **Frontend, phase15 (12):** `components/copilot/CopilotPanel.tsx`, `CopilotWidget.tsx`; `lib/assets.ts`,
  `mock-api.ts`, `portal-container.tsx`, `runtime-config.ts`; `widget/main.tsx`, `no-mock.ts`, `prepare-css.ts`,
  `widget.test.tsx`; `vite.widget.config.ts`; `widget-demo/index.html`.
- **Other (7):**
  - `archive/README.md`, `logs/.gitkeep`;
  - this file;
  - the demo database scripts moved (unchanged) from the root into `db/demo_reference/`: `01_clean_data.sql` …
    `05_documents.sql`, `make_demo_copy.py`. These are the 6 files the delivered `README.md` refers to.

## Files edited (11)

| File | Edit |
|---|---|
| `frontend/package.json` | added `"build:widget": "vite build --config vite.widget.config.ts"` |
| `.gitignore` | `logs/*` + `!logs/.gitkeep` (instead of `logs/`), added `dist*/`, `.pytest_cache/` |
| `.dockerignore` | added `archive/` |
| `requirements.txt` | the delivered comment "plus whatever your pdf_chunker.py imports" replaced by `pdfplumber>=0.11`. `pdf_chunker.py` imports `pdfplumber` and `copilot_docs.py` imports `pdf_chunker`, so without this line the image would not start. 0.11.10 is the version the tests ran with. |
| `docs/INTEGRATION_GUIDE.md` | §4 and the security checklist: `COPILOT_RBAC_SECRET` is read from `rbac.app_secret`, not generated. It said "another 64 random characters", which would make every query fail. |
| `backend/db_connection.py` | `sslmode="disable"` → `sslmode=os.getenv("PGSSLMODE", "require")`: database connections are encrypted by default |
| `.env.example` | added `PGSSLMODE=require`. libpq also applies it to the RBAC connection in `copilot_rbac.py`, so SSL is enforced there without changing the frozen RBAC code. |
| `backend/test_phase4_parts.py` | three real-looking e-mail addresses replaced by reserved test domains (`aman@alpha.example`, `aman@bravo.example`, `aman@charlie.example`, and "the charlie one"); same test logic |
| `archive/backend/test_endpoints.py` | the hardcoded public model-server IP replaced by `os.environ["SQL_RAG_URL"]` / `os.environ["BRAIN_URL"]` |
| `frontend/src/components/ui/table.tsx`, `frontend/src/routes/__root.tsx` | Prettier formatting only (these were the 2 lint errors) |

## Files archived (66, into `archive/`, relative paths kept)

- **`archive/backend/` (33):**
  - demo-database runners: `run_phase1.py`, `run_phase2.py`, `run_phase3.py`, `run_rbac_review.py`,
    `e2e_connector.py` (delivered; needs the demo database);
  - RAG and evaluation tools: `rag_lab.py`, `rag_compare.py`, `eval_harness.py`, `understander_cases.jsonl`;
  - early RAG experiments: `chunk_pdf.py`, `chunk_pdf_v9.py`, `embed_chunks.py`, `store_vectors.py`,
    `query_bucket.py`, `query_multi.py`;
  - demo scripts: `demo_act1_ingestion.py`, `demo_act2_orchestrator.py`;
  - one-off checks: `check_aws_rag_permissions.py`, `check_permissions_full.py`, `check_crm_db.py`,
    `check_demo_data.py`, `test_bedrock_llama.py`, `test_bedrock_models.py`, `test_s3vectors_query.py`,
    `test_endpoints.py`;
  - old versions: `server_rbac.diff`, `schema_old.json`;
  - the old S3 → Lambda ingestion pipeline: `lambda_handler.py`, `pipeline_core.py`, `process_s3_bucket.py`,
    `requirements_2.txt`, `Archive deploy/process_s3_bucket.py`.
- **`archive/Dockerfile.lambda`:** the Lambda image of that pipeline.
- **`archive/db/crm_schema_only.sql`:** CRM schema as of 5 Nov 2026, structure only.
- **`archive/frontend/` (30):**
  - the 17 paths from `phase15-delete-old-files.ps1`: `src/components/demo/` (5), `src/components/documents/` (6),
    `src/components/splash/` (2), `hooks/use-demo-users.ts`, `hooks/use-documents.ts` + test,
    `lib/active-user.ts` + test, `lib/demo-users-api.ts`, `lib/documents-api.ts` + test, `lib/documents-mock.ts`,
    `lib/documents-types.ts`, `lib/documents-validation.ts` + test, `lib/format-bytes.ts`,
    `test/splash-screen.test.tsx`;
  - `AGENTS.md`, `README.md` (Lovable notes), `bun.lock`, `bunfig.toml`.
- **`archive/README.md`:** "Not used by the website integration. Kept for reference. Do not deploy."

Before the frontend paths were archived, phase15 was applied to a scratch copy. Nothing left in it imports them,
and none of them is in the import graph of `src/widget/main.tsx`. After archiving, nothing in `backend/` imports an
archived file, and the type check, tests and widget build pass (below).

## Files deleted (integration copy only, after the user's "yes")

Every customer or private file was confirmed byte-identical in the testing folder before it was deleted.

| Size | Path |
|---|---|
| 6.3 MB | `logs/`: `audit.jsonl`, `feedback.jsonl`, `server.log` + 9 rotations, 186 `session_*.jsonl`, 4 `rag_lab_*.jsonl`, `compare_20261108-201543/` |
| 712 KB | `__pycache__/`, `backend/__pycache__/` |
| 3.8 MB | 7 PDFs: 2 customer proposals, 1 invoice, 2 downloaded copies of a proposal, 2 samples |
| 24 KB | `aws_rag_permissions_report.txt`, `crm_db_report.txt`, `demo_data_report.txt` |
| 28 KB | `testset_stem_proposals.jsonl`, `eval_questions.csv`, `questions.py` (they quote customer proposals) |
| 3 KB | `frontend/.lovable/`, `frontend/.vscode/`, empty root `package-lock.json` |

Also built and deleted again: `frontend/dist-widget/` (the main developer builds it).

## Test results (run 2026-11-15, after archiving and deleting)

```
backend> python test_contract.py       6/6 passed
backend> python test_server.py         150/150 passed
backend> python test_phase4_parts.py   12/12 passed
backend> python test_guardrails.py     81 checks passed, 0 failed.
frontend> npx tsc --noEmit             exit 0, 0 errors
frontend> npx vitest run               Test Files 25 passed (25), Tests 191 passed (191)
frontend> npm run build:widget         dist-widget/closemore-copilot.js  1,082.57 kB │ gzip: 349.61 kB  ✓ built
```

- **PyJWT:** it wasn't installed on this machine. It was installed into a temporary folder used only for these
  runs, and no global Python packages were changed.
- **`test_server.py` tracebacks:** it prints 6 tracebacks from tests that raise errors on purpose
  (`/_test_boom`, `KeyError("boom")`).
- **`npm run lint`:** 0 errors, 7 warnings (`react-refresh/only-export-components` in shadcn `ui/*` files and
  `portal-container.tsx`). The 2 Prettier errors that came over from the testing system were fixed by
  reformatting. All the results above were re-run after the fixes.

### Widget build checks

| Check | Result |
|---|---|
| `VITE_USE_MOCK_API` / `WIDGET_MOCK` set to `true` anywhere | **no**: only in docs, comments, a test that stubs it, and the build config that forces `false` |
| `localhost` / `127.0.0.1` in the built file | **1**: a library error message, `File URL host must be "localhost" or empty on darwin` (a bundled file-URL helper). Not an address the chat calls. |
| `mock` in the built file | **4**, in two places: `throw Error("Mock answers are not available in the website build.")` (the `widget/no-mock.ts` stand-in) and `VITE_USE_MOCK_API:"false"`. None of the 12 mock deal names from `mock-rbac.ts` / `mock-api.ts` is in the file. |

## Secret scan (whole copy, without `node_modules/`)

| Check | Hits |
|---|---|
| AWS access keys (`AKIA`/`ASIA…`) | none |
| `aws_secret` | variable names only: `.env.example` (empty), `server.py` / `test_stubs.py` / `e2e_connector.py` / `server_rbac.diff` (lists of names), `SECRETS_HANDOVER.md` |
| Tokens (`ghp_`, `github_pat_`, `sk-`, `xox*`, JWTs) | none |
| Private keys | none |
| Database URLs with passwords | `archive/backend/run_phase1.py:11`: placeholder `postgresql://user:pass@host:port/dbname` |
| Password values | `db/test_prod_migration.py:28-29,220`: `apppw` / `copilotpw` for a throwaway local test database (`localhost:5433`, `closemore_next_test`) |
| IP addresses with ports | `archive/backend/test_endpoints.py` had the model servers' public address hardcoded. **Fixed:** it now reads `SQL_RAG_URL` / `BRAIN_URL`. None left. |
| E-mail addresses | placeholders only (`example.com`, `x.com`, `demo.local`, `*.example`). The three real-looking addresses in `backend/test_phase4_parts.py` were **fixed** (replaced by `*.example`). |

The test-database passwords (`apppw` / `copilotpw`) are kept. `test_prod_migration.py` sets them itself on a
throwaway local test database (line 220), so they protect nothing real.

## Questions asked and answers

| Question | Answer |
|---|---|
| Separate folder or `integration` branch? | separate folder, no `.git` |
| Apply `phase15-update`? | yes; archive (not delete) the 17 old paths, show them first and confirm the widget doesn't use them |
| Demo database scripts | `db/demo_reference/` (as the delivered README says) |
| Lambda pipeline, `bun.lock`, Lovable notes | archive; `build_schema.py` stays in `backend/` (checked: no hardcoded host, user or password; it uses `db_connection.py`, which reads `.env`) |
| `crm_schema_only.sql` | archive |
| Reports with account, database and organization details; eval sets and PDFs with customer content | delete from this copy (originals stay in the testing system); the main developer gets `docs/SECRETS_HANDOVER.md` instead, with no values |
| `.lovable/` | not in the integration |
| Delete list (step 5) | "yes" |

## Fixed after the first report (user: "fix what is remaining")

The `COPILOT_RBAC_SECRET` instruction, the unencrypted database connection, the real-looking e-mail addresses, the
hardcoded model-server IP and the 2 lint errors. See "Files edited".

## Handoff docs review (2026-11-15)

| File | Change |
|---|---|
| `HANDOFF_FOR_MAIN_DEVELOPER.md` (new, root) | the handover letter: what is included and excluded, steps, open items, what was tested |
| `ARCHITECTURE.md` (new, root) | system diagram, the path of one question, who sees what, runtime facts, every file and what it does |
| `README.md` | points to the two new files; removed "Not included: `db_connection.py`, `pdf_chunker.py`" (both are included); added `schema.json`, `frontend/`, `archive/` rows |
| `docs/WEBSITE_FRONTEND_GUIDE.md` | §2 is now **stack-neutral**: the Java/Spring example became plain rules, pseudocode and `curl` checks. The old example threw on 4xx/5xx instead of passing the status through. Added: status codes passed through for errors too; timeout about 150 s (the widget waits 150 s), and 504 on timeout; 429 for the rate limit; **CSRF** (the widget sends no token); the heading said "three" endpoints, the table has four. §3.2 now describes the widget's safe Markdown rendering. §5: the `/internal/index` fields and errors, the `System` region, and the status read marked as not available yet (the old text said your backend can read `copilot_documents`, but row-level security stops it). §7: test names taken from the live data instead of demo personas. |
| `docs/INTEGRATION_GUIDE.md` | §3: how to regenerate `schema.json` (`build_schema.py`); §5: **run exactly one instance** (conversation memory and feedback are in process memory); §6: replaced `run_rbac_review.py` (archived, demo database only) with the `DATABASE_HANDOFF.md` §5 checks, and added SSL and single-instance items; §7: keep `schema.json` on upgrades |
| `docs/START_HERE_MAIN_DEVELOPER.md` | reading list now includes `ARCHITECTURE.md` and `SECRETS_HANDOVER.md`; steps mention `build_schema.py`, the `demo_reference/` warning, one instance, the proxy rules (any language, errors passed through, CSRF), the `System` region and the status read; upgrades keep `schema.json` |

Checked while reviewing (no change needed):
- the widget renders answers with `react-markdown` (`skipHtml`, no images; links use `noopener noreferrer`);
- the only `dangerouslySetInnerHTML` (`ui/chart.tsx`) writes colours from code with generated keys (`s0`, `s1`),
  so no AI text reaches it.

## Open points (left unchanged on purpose)

1. **"SAIL DEAL" / "Priya Gupta":** possibly a real deal and a real person. They appear in the model's prompt
   example (`backend/understander.py:68`), in `test_server.py`, in `test_phase4_parts.py` and in
   `archive/backend/understander_cases.jsonl`. Changing the prompt changes AI behaviour, so this is for the AI
   team: confirm they are demo data or rename them in all places together.
2. **`POSTGRES_*`:** `server.py` requires these variables at startup but does not connect with them.
   `SECRETS_HANDOVER.md` says to fill them with the `copilot_app` login, never the main app's. Removing the
   startup check would be an AI-team change.
3. **`localhost` in the widget file:** 1 hit, a library error message (see Widget build checks). It cannot be
   removed without patching a third-party library.
4. **`PGSSLMODE=require`:** this needs the shared database to accept SSL. If it does not, the AI service cannot
   connect until SSL is enabled on the database. That is intended; the alternative is a plain-text database
   connection.

## Not tested here

- The real llama model servers, real S3 / S3 Vectors, and the shared database. `test_server.py` uses fakes from
  `test_stubs.py`.
- `db/test_prod_migration.py`: needs a local PostgreSQL with a schema copy of `closemore_next`.
- The Docker image: it was not built.
- The widget inside the real website, and `widget-demo/index.html` in a browser.

## Cleo, relevance check, BOTH split and fixes (2026-11-17)

Brought over from the testing system (demo commit `4599898`), adapted for the website.

**Backend** (`backend/server.py`, `understander.py`, `sql_templates.py`, `test_phase4_parts.py`; applied as a
patch on top of the website-connector changes, nothing of the connector touched):
- The assistant is **Cleo** (`ASSISTANT_NAME=Cleo` in `.env.example`, also the code default).
- **Relevance check** in the orchestrator call: irrelevant -> fixed rejection, ambiguous -> follow-up question.
- **BOTH split**: CRM part and document part answered separately; only CRM names looked up in the CRM; kept
  through "which one?"; a company/product not in the CRM sends its part to the documents.
- **Fixes**: filter words ("open", "won", "this month") skip the fixed deals template; for BOTH answers with a
  table, the sentence about the rows is written by code (no miscounts).
- Orchestrator prompt about 2,340 tokens (test limit 2,400).

**Widget** (`frontend/`):
- Cleo's face button (floating, "Ask Cleo" tooltip), greeting bubble **once per tab**, Cleo header, Cleo avatar
  and empty-chat picture, "Powered by CloseMore", placeholder "Ask Cleo about your deals…".
- Panel sizes **normal 400 × 680 / wide / full screen**, with open, close and resize animations that follow
  the visitor's **reduce-motion** setting. Open/closed and size are kept when the user moves to another page;
  a restored chat opens at the newest message.
- New script option **`data-position="left"`** (bottom-left corner).
- "Which one?" lists: **Show selected** appears from the first tick.
- **Bug fix in `widget/prepare-css.ts`**: `rem` inside class names was converted too, so those rules matched
  nothing in the Shadow DOM (e.g. the wide panel width, table cell and chart tooltip widths). Now only values
  are converted.
- `docs/WIDGET_INTEGRATION.md` rewritten for Cleo: tag only in the logged-in layout (never on the login
  page), the new option, behaviour across pages.

**Checked:** backend contract 6/6, server 150/150, phase4 12/12, guardrails 81/81, relevance 11/11, split
12/12, small fixes 8/8; frontend 195/195 tests, type check clean; built widget 1,077 kB (no mock data, no
local address); browser check of the built widget on two test pages: 26/26 (button, greeting once, sizes,
answer, still open with the same chat on the next page, close animation, reduce motion, phone).
