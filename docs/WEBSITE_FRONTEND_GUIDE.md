# CloseMore website: adding the AI Copilot chat (frontend + backend proxy)

What the website team builds so users can chat with the AI Copilot inside the CloseMore website.

> **The chat window is already built.** It is the widget `closemore-copilot.js` (see `WIDGET_INTEGRATION.md`):
> it already does everything in section 3 below. **You build only section 2 (the backend proxy) and section 5
> (document hooks), and add the widget's `<script>` tag.** Section 3 stays here as the reference for what the
> widget does, so you can test it.
Field details: `API_CONTRACT.md`. Display details for lists and letters: `FRONTEND_HANDOFF_letters_multi_select.md`.

## 1. The flow

```
Chat window (browser)  --->  Website backend: POST /api/copilot/ask  --->  AI service: POST /v1/ask
   only question +            checks the login, adds the secret              answers as that user
   session_id                 and the user id from ITS OWN session
```

The browser never talks to the AI service, never sees `COPILOT_SERVICE_KEY`, and never sends a user id.

## 2. Website backend: two proxy endpoints and two document hooks

Build these in whatever language and framework the website backend already uses. The AI service only sees plain
HTTP + JSON.

| Website side (your names) | Called by | Forwards to | Adds |
|---|---|---|---|
| `POST /api/copilot/ask` | the chat widget (browser) | `POST {AI}/v1/ask` | `X-Copilot-Service-Key`, `X-Copilot-User-Id` |
| `POST /api/copilot/feedback` | the chat widget (browser) | `POST {AI}/v1/feedback` | same two headers |
| after a document upload | your backend (server side) | `POST {AI}/internal/index` | `X-Copilot-Service-Key` |
| after a document delete | your backend (server side) | `POST {AI}/internal/remove` | `X-Copilot-Service-Key` |

`{AI}` is the AI service's private address, e.g. `http://copilot.internal:8000`. Keep it in your config, never in
browser code.

### 2.1 Rules for the two proxy endpoints

1. **Logged-in users only.** If there is no valid session, answer `401` yourself and do not call the AI.
2. **The user id comes from your server-side session or token check** (`users."User_ID"`), never from the request
   body, a query parameter or a browser header.
3. **Headers:** send only `Content-Type: application/json`, `X-Copilot-Service-Key` (from your secrets store) and
   `X-Copilot-User-Id`. Do not forward the browser's cookies or headers. Any `X-Copilot-*` header the browser sent
   must be ignored.
4. **Body in, body out, unchanged:** send the browser's JSON body (`question`, `session_id`) as it is. Return the AI's
   JSON body as it is.
5. **Status code out, unchanged, for errors too.** Many HTTP client libraries throw an exception on 4xx/5xx by
   default. Catch it, or turn that behaviour off, and return the AI's status code and JSON body. Otherwise the
   user sees "not available" instead of "Please log in again" (401) or the AI's own message (`detail` on 400/404).
6. **Timeout: about 150 seconds** (the widget gives up after 150 s). If the AI does not answer in time, return
   `504`; the widget then shows "The assistant is not available right now" and a Retry button. Questions are
   answered one at a time, so a question can wait behind another user's.
7. **Rate limit per user**, e.g. 10 questions per minute. Answer `429` with `{"detail": "Too many questions. Please
   wait a minute."}`; the widget shows the `detail` text.
8. **CSRF:** the widget sends `POST` with the login cookie (`credentials: "include"`) and `Content-Type:
   application/json`, but **no CSRF token**. If your framework checks CSRF tokens on cookie sessions, exempt these
   two endpoints (JSON only, same site, logged-in session; also check the `Origin` header is your own site).
   Or tell the AI team how your framework expects the token, and the widget will send it.
9. **Logging:** log `request_id`, user id, status and duration. Log the question text only if your policy allows it.

### 2.2 The proxy in pseudocode

```
on POST /api/copilot/ask (same for /feedback -> /v1/feedback):
    user_id = session.current_user_id()            # your login; NOT from the request
    if not user_id: return 401 {"detail": "Please log in again."}
    if rate_limited(user_id): return 429 {"detail": "Too many questions. Please wait a minute."}
    response = http.post(AI + "/v1/ask",
                         body = request.raw_body,
                         headers = {"Content-Type": "application/json",
                                    "X-Copilot-Service-Key": secret("COPILOT_SERVICE_KEY"),
                                    "X-Copilot-User-Id": user_id},
                         timeout = 150 s,
                         throw_on_error_status = false)
    on timeout / connection error: return 504 {"detail": "The assistant is not available right now."}
    return response.status, response.body (Content-Type: application/json)
```

### 2.3 Check your proxy (any stack)

Run these with a real logged-in session cookie from your site (`<cookie>`):

```
# 1. normal question -> 200 and JSON with "answer" (or "choice_prompt"), "route", "request_id"
curl -i https://<your-site>/api/copilot/ask -H "Content-Type: application/json" \
     --cookie "<cookie>" -d '{"question":"hello","session_id":"proxy-test-1"}'

# 2. no login -> 401 (from your own check)
curl -i https://<your-site>/api/copilot/ask -H "Content-Type: application/json" \
     -d '{"question":"hello","session_id":"proxy-test-2"}'

# 3. error passed through -> 404 {"detail":"Answer not found."} (NOT 500)
curl -i https://<your-site>/api/copilot/feedback -H "Content-Type: application/json" \
     --cookie "<cookie>" -d '{"request_id":"does-not-exist","rating":"up"}'

# 4. bad input passed through -> 400/422 with the AI's JSON body (NOT 500)
curl -i https://<your-site>/api/copilot/feedback -H "Content-Type: application/json" \
     --cookie "<cookie>" -d '{"request_id":"x","rating":"maybe"}'
```

Tell the AI team your backend's language and framework; they will review your proxy once and can send an example
in that language.

## 3. Chat window (already built into the widget; reference only)

### 3.1 Sending
- One `session_id` per conversation: a random id (for example `crypto.randomUUID()`), created when a chat starts,
  kept while the chat is open (sessionStorage is fine), new one for "New chat".
- Send `{ "question": "...", "session_id": "..." }`. Do not send `history`.
- While waiting: show a typing/"thinking" indicator and disable the send button (one question at a time per chat).
- A button click sends its `value` as the next `question`, exactly like typed text.

### 3.2 Showing an answer (top to bottom)

| If the response has | Show |
|---|---|
| `scope` | a small label "Answered for: …" (who and what they can see) |
| `choice_prompt` + `choices` | the prompt line **instead of** `answer`, then the choice list (3.3) |
| otherwise `answer` | the text, keeping line breaks. The widget renders simple Markdown (bold, lists, `code`, links that open in a new tab with `rel="noopener noreferrer"`) as React elements; raw HTML and images are skipped. Never insert it as HTML. |
| `people` | key chips `A = Aman Kapoor · Sales rep · Indore` above the table |
| `people_more` | a collapsed "+N more" chip that expands to faded chips |
| `table` | one table (3.4) |
| `tables` | several tables, each with its `title` |
| `chart` | the chart above or below `table` (bar or line) |
| `sources` | "Sources" chips: file name and page |
| `choices` without `kind: option` | normal buttons (follow-ups like "Show their deals") |
| `request_id` | thumbs up / down (3.6) |

`route` (`SQL`, `RAG`, `BOTH`, `CHAT`) can be shown as a small badge: "From CRM data", "From documents".
Ignore fields you don't know: new optional fields may appear later.

### 3.3 "Which one?" lists (letters A–Z)
- `kind: "option"` rows are a **checklist**: letter badge + label. `group` adds a heading ("Aman", "Priya").
- Clicking a row sends its letter. Ticking 2+ rows shows **Show selected (n)** which sends `A, C`.
  `kind: "all"` is the "All N" / "Both" button and sends `all`.
- With groups, enable **Show selected** only when every group has a tick.
- `choice_prompt` may start with "(1 of 3)" when the AI asks name by name; nothing special to do.
- Buttons work only on the **latest** answer; disable them on older messages.
- One neutral colour for all letter badges.
- Full rules and examples: `FRONTEND_HANDOFF_letters_multi_select.md` sections 1 to 3c.

### 3.4 Tables
- `columns` + `rows`; `truncated: true` means more rows exist than shown: say "Showing first N rows".
- A first column named **Person**, **Deal**, **Contact** or **Product** holds a letter: render it as the same
  letter badge.
- Recommended: column sorting, a search box for 6+ rows, a `#` row number column, paging at 50 rows,
  a Copy button, horizontal scroll for wide tables. Dates arrive as `YYYY-MM-DD`.
- Values are plain text and numbers: render as text, never as HTML.

### 3.5 Charts
- `chart` comes only with `table`: up to 25 bars or 50 line points.
- Fixed bar width with sideways scroll when bars don't fit; keep the y-axis fixed; full labels in tooltips.

### 3.6 Feedback
- Thumbs up / down on each answer: `POST /api/copilot/feedback` with
  `{ "request_id": "...", "rating": "up" | "down" | "none", "comment": "optional" }`.
  `none` = the user removed their rating. Only the asker can rate their own answer.

### 3.7 Errors and empty states

| Situation | Show |
|---|---|
| 401 from your proxy | "Please log in again." |
| 4xx with `detail` | the `detail` text |
| 5xx / timeout / network | "The assistant is not available right now. Please try again." plus a Retry button that resends the same question |
| empty input | do not send |

## 4. Remove / do not build

The AI's own test app has things the website must **not** have:
- the role / user picker and the `X-Demo-User` header (users are who they are logged in as);
- the AI app's document upload page (use the website's existing upload; the backend calls `/internal/index`);
- anything that lets the browser choose a user, region or role.

## 5. Documents (website upload screen)
- After a successful upload to S3, your backend calls `/internal/index` with `doc_id`, `owner_user_id` (the
  uploader), `filename`, `region` and `s3_key` (inside `WEBSITE_DOCS_BUCKET` / `WEBSITE_DOCS_PREFIX`).
  - `region` comes **from your database**, never from the browser: a region name, or `System` for every region.
    The owner must be allowed to upload into that region; otherwise the AI answers `403`.
  - The reply is `202 {"doc_id", "status": "processing"}`. Indexing runs in the background (longer for big PDFs)
    and ends as `ready`, or `failed` with a reason.
  - Errors: `409` = this `doc_id` is already indexed (remove it first), `413` = larger than 20 MB, `415` = not a PDF.
    Full list in `API_CONTRACT.md`.
- **Showing "Processing / Ready / Failed" on your upload screen is not available yet.** The status is stored in
  `copilot_documents."Status"` / `"Status_Detail"`, but that table is protected for the Copilot's database role only,
  so your main app's database login cannot read it. The AI team will add a way to read it (a status call with the
  service key, or a read grant for your role). Until then, show "Uploaded", and do not promise users that the
  document is already searchable.
- On delete, your backend calls `/internal/remove` with `doc_id` and `requested_by_user_id` (the user deleting it:
  the uploader or a system admin). The PDF stays in your bucket; only the search index is removed.

## 6. Security checklist for the frontend
- [ ] AI answers, table cells, labels and source names are rendered as **text**, never `innerHTML` /
      `dangerouslySetInnerHTML` (answers can include text from uploaded documents).
- [ ] No AI service URL, secret or user id in browser code, local storage or network calls.
- [ ] Links in answers (if any) open only after the user clicks, with `rel="noopener noreferrer"`.
- [ ] The chat is available only to logged-in users.
- [ ] The proxy logs only `request_id`, user id and status, not the question text, unless your policy allows it.

## 7. Done when
- A sales rep, an admin and a system admin each see only their own data in the chat.
- A question about three first names that several users share in your data (for example "tell me about Aman,
  Priya and Rahul", using names that really occur more than once) shows one lettered checklist; picking letters
  gives one answer with key chips and a Person column.
- Follow-up buttons and typed letters ("deals of C") work in the same chat.
- A document uploaded on the website appears in answers (with Sources) after it is Ready, and only for users
  of that region.
- Thumbs up/down are saved.
