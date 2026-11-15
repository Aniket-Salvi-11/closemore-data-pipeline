# CloseMore AI Copilot: website integration

The AI chatbot service for the CloseMore website. It runs as its own service; the website backend calls it.

**Main developer: start with [`HANDOFF_FOR_MAIN_DEVELOPER.md`](HANDOFF_FOR_MAIN_DEVELOPER.md)** (what you receive,
what to do, what is still open). [`ARCHITECTURE.md`](ARCHITECTURE.md) explains how it works and what every file is.

Then read `docs/START_HERE_MAIN_DEVELOPER.md` and `docs/INTEGRATION_GUIDE.md` (setup, database changes, security
checklist, upgrades).
- API reference: `docs/API_CONTRACT.md`
- Website proxy and chat window: `docs/WEBSITE_FRONTEND_GUIDE.md`
- Secrets: `docs/SECRETS_HANDOVER.md`
- Chat display rules: `docs/FRONTEND_HANDOFF_letters_multi_select.md`

| Path | What it is | Who changes it |
|---|---|---|
| `backend/website_connector.py` | the one file that connects the website (login, uploaded documents) | website team (inside of functions only) |
| `backend/schema.json` | the CRM tables the Copilot may query, generated from your database with `backend/build_schema.py` | website team (regenerate when tables change) |
| `.env` (from `.env.example`) | settings and secrets, never committed | website team |
| `backend/` everything else | the AI | AI team only; replaced on every upgrade |
| `frontend/` | the chat widget source; `npm run build:widget` makes `closemore-copilot.js` | AI team |
| `db/` | `prod_migration.sql` / `prod_rollback.sql` for the shared database (see `docs/DATABASE_HANDOFF.md`); `demo_reference/` = the AI demo copy's scripts, **do not run on live** | website team, with the AI team |
| `archive/` | old scripts and experiments, for reference only; not deployed | nobody |

Not included: the two llama.cpp model servers (`SQL_RAG_URL`, `BRAIN_URL`). They run on their own server.

Checks:
```
cd backend
python test_contract.py     # the website contract: expected 6/6 passed
python test_server.py       # AI behaviour (simulated models): expected 150/150 passed
```
