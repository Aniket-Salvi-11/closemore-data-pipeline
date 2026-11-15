# CloseMore AI Copilot: API contract (v1)

This is what the CloseMore website talks to. It never changes shape. New fields can be added, but they are
always optional, so a website built against this page keeps working after every AI upgrade.
`backend/test_contract.py` checks this on every test run.

All calls go **from the website backend to the AI service, server to server**, over HTTPS on a private network.
The browser never calls the AI service directly and never sends a user id.

## Authentication (every call)

| Header | Value |
|---|---|
| `X-Copilot-Service-Key` | the shared secret (`COPILOT_SERVICE_KEY`, at least 32 characters) |
| `X-Copilot-User-Id` | `users."User_ID"` of the logged-in user, taken from the website's own session |

(Alternative, if chosen: `Authorization: Bearer <website login token>`, see `WEBSITE_AUTH_MODE=jwt` in
`website_connector.py`.)

What the user may see is decided by the AI service from that user id (role, regions, row-level security in the
database). The website does not filter anything.

| Status | Meaning |
|---|---|
| 401 | missing/wrong secret, no user id, or the user is unknown or inactive |
| 400 | bad request (for example an empty question) |
| 403 / 404 | the user may not see or change that item (404 when they may not even know it exists) |
| 500 | internal error; the body is `{"detail": "Internal server error."}` and never contains details |

## POST /v1/ask

(`/ask` is the same endpoint and stays available.)

Request:
```json
{
  "question": "tell me about Aman, Priya and Meera",
  "session_id": "a-stable-id-per-chat-window",
  "history": []
}
```
- `question` (required): what the user typed, or the `value` of a button they clicked.
- `session_id` (strongly recommended): one id per chat conversation: 8 to 64 characters of letters, digits, `-` and `_` (a UUID fits). The AI keeps the
  conversation (follow-ups, "which one?" answers, letters) on its side under this id.
- `history` (optional, legacy): `[{"role": "user"|"assistant", "content": "..."}]`. Not needed when
  `session_id` is sent.

Response (always present: `question`, `route`, `answer`; everything else is optional and may be `null`):

| Field | Type | Meaning |
|---|---|---|
| `question` | string | the question as answered |
| `route` | string | `SQL` (CRM data), `RAG` (documents), `BOTH`, `CHAT` |
| `answer` | string | the text to show (may contain line breaks) |
| `sql` | string | the query used (shown only to admins when `RBAC_SHOW_SQL=admins`) |
| `sql_error` | string | why the data could not be read |
| `table` | object | `{columns, rows, truncated}`, a result table |
| `tables` | list | several titled tables: `[{title, columns, rows, truncated}]` |
| `chart` | object | chart spec for `table` (bar or line) |
| `scope` | object | who answered and what they can see, for the "Answered for: …" label |
| `sources` | list | documents behind a document answer (only ones this user may see) |
| `choices` | list | buttons: `[{label, value, kind, letter?, group?}]`; send `value` as the next `question` |
| `choice_prompt` | string | short line to show above the buttons |
| `people` | list | people in this answer: `[{letter, name, label, ...}]`; table column `Person` holds the letter |
| `people_more` | list | people from the same list not in this answer (faded "+N more" chips) |
| `request_id` | string | id of this answer, for feedback |
| `elapsed_ms` | int | time the AI took |

How to display choices, letters, people chips and tables is in `FRONTEND_HANDOFF_letters_multi_select.md`.
Answers can take 5 to 60 seconds (local models), so use a timeout of at least 120 seconds and show a
"thinking" state.

## POST /v1/feedback

```json
{"request_id": "…", "rating": "up" | "down" | "none", "comment": "optional", "session_id": "optional"}
```
A user can only rate their own answers (404 otherwise).

## GET /health

`{"status": "ok", "brain_endpoint": …, "sql_rag_endpoint": …}`. No login needed; use it for load balancer checks.

## Documents uploaded on the website

### POST /internal/index
Call this after the website has stored a PDF in its S3 bucket (`WEBSITE_DOCS_BUCKET`, under `WEBSITE_DOCS_PREFIX`).
Header: `X-Copilot-Service-Key` only.
```json
{"doc_id": "the website's id", "owner_user_id": "seed-u-5", "filename": "Proposal.pdf",
 "region": "Indore", "s3_key": "documents/....pdf"}
```
- `region`: who may find it. A region name, or `System` for every region. The owner must be allowed to upload
  into that region (the same rule as uploads in the AI app), otherwise 403.
- Reply `202 {"doc_id", "status": "processing"}`. Indexing runs in the background; the document is searchable
  when its status is `ready` (column `Status` in `copilot_documents`), or `failed` with a reason.
- 400 file outside the documents folder, 404 file not found in S3 or unknown owner, 409 `doc_id` already
  indexed (remove it first to re-index), 413 larger than 20 MB, 415 not a PDF.

### POST /internal/remove
```json
{"doc_id": "…", "requested_by_user_id": "the person deleting it"}
```
Only the uploader or a system admin may remove it (403/404 otherwise). The PDF stays in the website's bucket;
only the search index is removed. Reply `200 {"doc_id", "status": "removed"}`.
