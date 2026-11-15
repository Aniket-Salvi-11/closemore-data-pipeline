# CloseMore AI Copilot: database changes for the shared database (`closemore_next`)

For the main developer. This explains what the Copilot needs in the shared database, why, and how to apply,
check and undo it. The scripts are in this folder:

| File | What it is |
|---|---|
| `prod_migration.sql` | adds everything the Copilot needs (safe to run more than once) |
| `prod_rollback.sql` | removes all of it again |
| `test_prod_migration.py` | the test we ran: your schema + made-up data, 97 checks |

## 1. In one paragraph

The AI writes SQL to answer questions. So that a mistake in the AI can never show a user data they may not see,
the Copilot logs in with its **own, limited database user** (`copilot_app`) and the **database itself** applies the
"who sees what" rules to every query it runs. The main app keeps its own login, its own policies and its own
behaviour: **nothing the main app uses is changed or removed.**

## 2. What the migration adds

| Added | Purpose |
|---|---|
| role `copilot_app` (login) | the only login the AI service uses. Read-only sessions, 30 s query timeout, no superuser, cannot bypass row security |
| role `copilot_ro` (no login) | the read grants `copilot_app` gets |
| role `copilot_rules_owner` (no login) | owns the rule functions so they can look up the asking user's role and region. It can only read `users`, `deals`, `deal_team_members`, `deal_contacts`, `organization_regions` and manage `copilot_documents` |
| schema `rbac` | a signing secret, the signed-identity functions and the access rules (`can_see_deal`, `can_see_contact`, …) |
| two policies per Copilot table, **for `copilot_ro` only** | `copilot_allow` (permissive) + `copilot_rules` (restrictive). Postgres requires every restrictive policy to pass, so the Copilot sees exactly the Copilot rules, whatever the existing policies would allow |
| table `copilot_documents` + `rbac.doc_*` functions | the list of documents indexed for the Copilot (owner, region, status) |

**Tables the Copilot can read:** deals, deal_team_members, deal_contacts, line_items, contacts, users, pipelines,
deal_types, products, organization_regions, organizations.
**Never readable by the Copilot:** `users.Password`, avatars, `auth_sessions`, `organization_invitations`, billing
and subscription tables, `organizations` billing columns, the signing secret.

**Not changed:** no CRM row is updated, no trigger is added to CRM tables, no existing policy is dropped or edited,
nothing is revoked from the main app, `set_config()` is untouched.

## 3. The access rules (same as the AI demo)

| Role | Deals | Contacts | Documents |
|---|---|---|---|
| System admin (`System_Admin` or `Admin`) | all deals of the company | all | all |
| Sales admin / Executive, no region | all deals of the company | all | all |
| Sales admin / Executive, with regions | deals in their regions | contacts of those deals | their regions |
| Sales rep | deals in their regions **that they own or are on the team of** | contacts of those deals | their regions |

- Everything is limited to the user's own company (`Organization_ID`) and to **active** users.
- Regions are compared ignoring case and spaces (`east `, `EAST`, `East` are the same). **No data is cleaned.**
- A deal with no region counts as its owner's first region (on the demo copy those regions were filled in the same
  way; here nothing is written).

## 4. How to apply (in this order)

1. **Fresh schema.** If the database changed since 5 Nov, send the AI team a new schema dump first
   (`pg_dump --schema-only --no-owner`). The migration also stops by itself if a table it needs is missing or has
   row level security switched off.
2. **Backup** the database.
3. **Run on a copy** of the live database first (same server version, real data):
   ```
   psql -h <host> -p <port> -U <superuser> -d <copy> -v ON_ERROR_STOP=1 -f prod_migration.sql
   ```
   It must be run by a **superuser** (it creates a role that may bypass row security for the rule functions).
4. **Check on the copy** (section 5). Use the main app against the copy: screens must show what they showed before.
5. **Team approval**, then run the same command on `closemore_next`.
6. **Set the Copilot's password** (choose a long random one; it goes only into the AI service's `.env`):
   ```sql
   alter role copilot_app password '<long random password>';
   ```
7. **Read the signing secret once** and give it to whoever configures the AI service (it goes into
   `COPILOT_RBAC_SECRET`; never into git or chat):
   ```sql
   select secret from rbac.app_secret;
   ```
8. **AI service `.env`:** `COPILOT_DB_HOST/PORT/NAME` = this database, `COPILOT_DB_USER=copilot_app`,
   `COPILOT_DB_PASSWORD`, `COPILOT_RBAC_SECRET`, `RBAC_LOOKUP_USER=<User_ID of an active system admin>`.
   The AI service must **never** be given the main app's database login.
9. **Network:** allow `copilot_app` to connect only from the AI server (`pg_hba.conf` / firewall).

## 5. How to check

As a superuser:
```sql
select policyname, tablename, roles, permissive from pg_policies where policyname like 'copilot%';   -- 23 rows
select count(*) from pg_policies;                       -- your previous count + 23 (37 + 23 = 60 on the 5 Nov schema)
```
As `copilot_app` (psql login with its password):
```sql
select count(*) from deals;                             -- 0: no signed identity means nothing visible
select "Password" from users;                           -- permission denied
select * from auth_sessions;                            -- permission denied
insert into deal_types values ('x','x',true,0,gen_random_uuid());   -- read-only transaction error
```
Then from the AI service: a sales rep, a sales admin and a system admin each ask "show my deals" and get only
what the table in section 3 says.

## 6. How to undo

```
psql -h <host> -p <port> -U <superuser> -d closemore_next -v ON_ERROR_STOP=1 -f prod_rollback.sql
```
Removes the policies, the `rbac` schema, `copilot_documents` and the three roles. The main app's tables, rows and
policies are untouched (tested). Roles belong to the whole server: if another database on the same server uses a
`copilot_*` role, the rollback keeps the role and says so.

## 7. What we tested (on PostgreSQL 16 locally; your server is 17)

Your 5 Nov schema loaded locally (32 tables, 37 policies), the main app's login owning the tables as on the
server, made-up data for 2 companies and 11 users (system admin, legacy `Admin`, sales admin with a messy region,
executives with and without region, reps, a rep with no region, an inactive user). **97/97 checks passed:**
- migration runs twice; rollback runs twice; migration again after rollback;
- every user sees exactly the deals, contacts, team rows, line items and users the rules allow;
- no identity, a forged signature, changing the user id, `app.bypass_rls = true` and the main app's own settings
  give the Copilot nothing extra;
- passwords, login tokens, invitations, billing and the secret are unreadable; nothing is writable;
- **the main app's view is identical** before the migration, after it, and after rollback (row counts per table for
  three different main-app sessions); the main app can still add any deal team member (no new trigger);
- documents: upload only into allowed regions, visible only to the right users.

Also run: the AI service code itself against the migrated schema (login, deals, `/v1/ask`, document index and
remove): 7/7.

**Not tested:** your real data, PostgreSQL 17 itself, the main app's real screens. Step 3–4 (a copy of the live
database) covers these.

## 8. Decisions for the team (not blockers)

1. **Personal fields.** The Copilot can read users' phone numbers and office/residential addresses (as in the
   demo). If it should not, remove those columns from the `grant select (...) on public.users` line.
2. **Deals with no region.** Counted as the owner's first region (section 3). If the team prefers "visible only to
   full-view admins", change `rbac.deal_region`.
3. **`Admin` vs `System_Admin`.** The main app's policies only recognise `'Admin'`; the data uses `System_Admin`.
   The Copilot accepts both. The main app may not treat system admins as admins.
4. **Different deal rules.** In the main app an owner sees their deal even outside their region; in the Copilot a
   sales rep needs the region too. Until the main app's policy is aligned, the CRM screens and the Copilot can show
   a sales rep different deals.
5. **Region spelling.** Not cleaned by this script (the Copilot ignores case and spaces). A dropdown from
   `organization_regions` in the CRM would stop new messy values.
6. **Database exposure.** The dump command connects to the database on a public IP. If that port is open to the
   internet, limit it to known servers.
