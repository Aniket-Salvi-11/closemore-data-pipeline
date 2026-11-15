# CloseMore AI Copilot: integration guide for the website team

## 1. How it fits together

```
Browser (CloseMore website)
   |  the website's own login, as today
   v
Website backend  -- HTTPS, private network, X-Copilot-Service-Key + X-Copilot-User-Id -->  AI Copilot service
   |                                                                                      |  website_connector.py
   |  stores uploaded PDFs in S3, then POST /internal/index  ------------------------------>  |  copilot_rbac.py (who sees what)
   v                                                                                      v
Live CRM PostgreSQL  <-------- read only, as role copilot_app, row-level security --------  AI files
```

- The AI Copilot runs as its **own service** (Python, FastAPI). It is not copied into the website code.
- The website backend is its only caller. The chat window calls the website backend, which calls `/v1/ask`.
- `docs/API_CONTRACT.md` is the full request/response reference.

## 2. The connector: the only file you edit

`backend/website_connector.py` is the single meeting point:

| You may change | You must not change |
|---|---|
| the inside of `get_website_user()` (how the logged-in user is found) | function names, arguments, return values |
| settings in `.env` | the endpoints `/internal/index`, `/internal/remove` or their fields |

When the AI team ships a new version, **keep your `website_connector.py` and your `.env`** and replace everything
else. Before go-live, the AI team reviews your version of the connector once.

Login options (set `WEBSITE_AUTH_MODE`):
- `service` (recommended): your backend sends `X-Copilot-Service-Key` and `X-Copilot-User-Id` (taken from your
  server-side session). Nothing to code in the connector.
- `jwt`: requests carry your login token; set `WEBSITE_JWT_KEY`, `WEBSITE_JWT_ALGORITHMS`, and
  `WEBSITE_JWT_USER_CLAIM` if the user id is not in `sub`.

## 3. Database changes (once, on the live database)

Everything is in **`docs/DATABASE_HANDOFF.md`** with the scripts `prod_migration.sql` / `prod_rollback.sql`.
In short: a separate read-only login `copilot_app`, the access rules in a new `rbac` schema, and policies that apply
**only to the Copilot's role**. The main app's tables, rows and policies are not changed (tested).
Then regenerate `backend/schema.json` from the live database (table and column names, plus a few category values
such as stages and roles):
```
cd backend
python build_schema.py            # writes schema_new.json and prints what changed compared with schema.json
python build_schema.py --apply    # replaces schema.json (old one kept as schema_old.json)
```
It reads the `POSTGRES_*` settings from `.env`; use the `copilot_app` login there, so the schema contains exactly what
the Copilot may read. Run it again whenever the CRM's tables change.

## 4. Settings

Copy `.env.example` to `.env` (never commit it). For the website integration these must be set:
```
RBAC_MODE=production          # turns off the demo user picker
DOCUMENT_UPLOADS=off          # the website uploads documents; the AI app's own upload endpoints are off
WEBSITE_AUTH_MODE=service
COPILOT_SERVICE_KEY=<64 random characters>     # e.g. python -c "import secrets;print(secrets.token_urlsafe(48))"
COPILOT_RBAC_SECRET=<read from the database: select secret from rbac.app_secret;  (see DATABASE_HANDOFF.md; do not generate your own)>
WEBSITE_DOCS_BUCKET=<your bucket>
WEBSITE_DOCS_PREFIX=<your folder>/
RBAC_LOOKUP_USER=<an active system admin user id of your organization>
RBAC_SHOW_SQL=admins
CORS_ORIGINS=<not needed for server-to-server calls; leave empty>
```

## 5. Running

```
docker build -t closemore-copilot:1.0 .
docker run --env-file .env -p 8000:8000 closemore-copilot:1.0
```
or without Docker: `cd backend && uvicorn server:app --host 0.0.0.0 --port 8000`.

It also needs the two llama.cpp model servers (`SQL_RAG_URL`, `BRAIN_URL`) and the embedding model, which is
downloaded on first start.

**Capacity:** the service answers one question at a time; others wait in line. Plan for this during the pilot.

**Run exactly one instance** (one container, one process; the `Dockerfile` already starts one). The conversation
memory (for follow-ups like "and his deals?") and the list of answers that may be rated live in the service's memory:
- with two or more instances behind a load balancer, follow-ups and thumbs up/down fail at random;
- after a restart, ongoing chats lose their context, and rating an older answer returns `404`. New questions work
  normally.

Do not add `--workers` to the start command.

## 6. Security checklist (all must be true before go-live)

- [ ] The AI service is reachable **only** from the website backend (private network / security group), never
      from the internet.
- [ ] HTTPS between the website backend and the AI service.
- [ ] `X-Copilot-User-Id` comes from the website's server-side session, never from anything the browser sent.
- [ ] `COPILOT_SERVICE_KEY` is a long random value and `COPILOT_RBAC_SECRET` is the value of `rbac.app_secret`, both stored in a secrets store or the
      server environment, not in git or in the Docker image.
- [ ] All keys that were ever shown in screenshots or committed are rotated (AWS keys, database password).
- [ ] The database user in `.env` is `copilot_app` (read only), never the main app's login.
- [ ] `copilot_app` may connect only from the AI server (`pg_hba.conf` / firewall).
- [ ] `region` sent to `/internal/index` comes from the website's database, not from the browser.
- [ ] Logs (`LOG_DIR`) are readable only by admins and deleted after a fixed time; they contain real questions.
- [ ] Per-user rate limits on the chat in the website backend.
- [ ] The checks in `DATABASE_HANDOFF.md` §5 passed on the copy of the live database; a sales rep, an admin and a
      system admin each tried the chat and saw only their own data.
- [ ] `PGSSLMODE=require` (or `verify-full`) and the database accepts SSL.
- [ ] Exactly one instance of the AI service runs (§5).

## 7. Upgrades

1. The AI team publishes a new version (tag / Docker image).
2. You replace all files **except** `backend/website_connector.py`, `backend/schema.json` (generated from your
   database, §3) and `.env`. If the release notes say the schema format changed, run `python build_schema.py --apply`
   again instead of keeping the old one.
3. Run `python backend/test_contract.py`. If it passes, nothing you depend on changed.
4. Restart the service.

If an upgrade ever needs something from you (a new setting or connector function), it is listed in the release
notes, and existing functions keep working.
