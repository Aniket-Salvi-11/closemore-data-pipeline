# CloseMore AI Copilot: start here (for the website's main developer)

The AI Copilot is a chat assistant inside the CloseMore website. Users ask questions in plain words; it answers
from the CRM data they are allowed to see and from uploaded documents. This page tells you what to read, what to
build, and in which order.

## 1. The picture

```
Browser: closemore-copilot.js (chat widget)
   |  POST /api/copilot/ask, /api/copilot/feedback   (website domain, login cookie)
   v
Website backend (yours)  -- adds X-Copilot-Service-Key + X-Copilot-User-Id (from YOUR session) -->  AI service
   |  after a PDF upload / delete: POST /internal/index, /internal/remove  ------------------------>  (Python)
   v                                                                                                   |
closemore_next (PostgreSQL)  <------ read only, login copilot_app, row-level rules for the Copilot -----+
```

- The AI service runs on its own (Python/FastAPI, Docker). It is **not** copied into the website code.
- The browser never talks to the AI service and never sends a user id.
- The AI service never uses the main app's database login.

## 2. What to read, in order

| # | Document | What it is for |
|---|---|---|
| 0 | `ARCHITECTURE.md` (project root) | how the AI service works inside, and what every file and folder is |
| 1 | `docs/INTEGRATION_GUIDE.md` | how it fits together, settings, running, security checklist, upgrades |
| 2 | `docs/DATABASE_HANDOFF.md` + `db/prod_migration.sql` | the database changes (only additions; nothing of the main app changes) |
| 2a | `docs/SECRETS_HANDOVER.md` | every secret: what it is, who creates it, how (no values; production uses new secrets) |
| 3 | `docs/WEBSITE_FRONTEND_GUIDE.md` | the website backend proxy (rules, pseudocode, curl checks for any stack) and the chat's behaviour |
| 4 | `docs/WIDGET_INTEGRATION.md` | adding the chat widget: build, one `<script>` tag, `reset()` on logout, CSP |
| 5 | `docs/API_CONTRACT.md` | exact request / response of every endpoint |
| 6 | `docs/FRONTEND_HANDOFF_letters_multi_select.md` | details of choice lists, letters and people chips (already built into the widget) |

## 3. What you build (website side)

1. **Database (once):** run `db/prod_migration.sql` on a copy of the live database, check it (section 5 of
   `DATABASE_HANDOFF.md`), get team approval, run it on `closemore_next`. Set the `copilot_app` password and read
   the signing secret.
   Then regenerate `backend/schema.json` with `backend/build_schema.py` (`INTEGRATION_GUIDE.md` §3).
   `db/demo_reference/` holds the AI team's demo-database scripts: **never run them on the live database**.
2. **AI service:** deploy it (`Dockerfile`), fill `.env` from `.env.example` (secrets: `SECRETS_HANDOVER.md`), keep
   it on a private network that only your backend can reach, and run **exactly one instance**
   (`INTEGRATION_GUIDE.md` §5). Check `GET /health`.
3. **Proxy:** `POST /api/copilot/ask` and `POST /api/copilot/feedback` in your backend, in any language: logged-in
   users only, adds the two headers from your own session, passes body **and status (errors too)** through,
   timeout about 150 s, rate limit per user, CSRF exemption if your framework needs it
   (`WEBSITE_FRONTEND_GUIDE.md` §2).
4. **Widget:** build `closemore-copilot.js`, add the `<script>` tag for logged-in users, call
   `CloseMoreCopilot.reset()` on logout.
5. **Documents:** after a PDF upload to S3, call `/internal/index` (region from your database, or `System` for
   every region); on delete, call `/internal/remove`. Showing the indexing status on your upload screen is not
   available yet (`WEBSITE_FRONTEND_GUIDE.md` §5).
6. **Connector (only if needed):** `backend/website_connector.py` is the one AI file you may edit (inside the
   functions only), e.g. to switch to JWT login. Keep your copy and your `.env` on every AI upgrade.

## 4. Before go-live

- [ ] Every item of the security checklist in `INTEGRATION_GUIDE.md` §6.
- [ ] A sales rep, a sales admin and a system admin each tried the chat and saw only their own data.
- [ ] A document uploaded on the website appears in answers (with sources) for the right region only.
- [ ] `python backend/test_contract.py` passes on the deployed version.
- [ ] Keys that were ever shared in screenshots or chat are rotated.

## 5. What we need from you

- A fresh schema dump if `closemore_next` changed since 5 Nov 2026 (`pg_dump --schema-only --no-owner`).
- Your backend's language / framework and login method (session or JWT), so we can review your proxy once.
- The S3 bucket and folder where the website stores uploaded PDFs.
- The team's answers to the six decisions in `DATABASE_HANDOFF.md` §8.

## 6. Upgrades later

The AI team ships new versions. You replace every file **except** `backend/website_connector.py`,
`backend/schema.json` and `.env`, run `python backend/test_contract.py`, and restart. The API and the connector never change shape; new fields are
optional.
