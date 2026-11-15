# CloseMore AI Copilot: adding the chat to the website

For the website team. The chat is **one JavaScript file**. It shows a round CloseMore icon in the
bottom-right corner; clicking it opens the chat panel, and clicking again (or ✕, or Esc) closes it.

## 1. Build the file

In the Copilot frontend project:

```
npm install
npm run build:widget
```

Result: `dist-widget/closemore-copilot.js` (about 1.1 MB, 360 KB gzipped). React, styles and images are
inside it. Settings in `.env` / `.env.local` are ignored on purpose, so mock mode or a local API
address can never end up in this file.

## 2. Add it to the website

Copy the file to the website's static files (for example `/copilot/closemore-copilot.js`) and add one
tag to the page layout, **only for logged-in users**:

```html
<script src="/copilot/closemore-copilot.js" data-api-base="/api/copilot" defer></script>
```

| Attribute | Meaning | Default |
|---|---|---|
| `data-api-base` | Where the website's Copilot endpoints are (section 3) | `/api/copilot` |
| `data-fonts` | `"false"` = don't load the DM Sans font from Google Fonts (system font is used) | load |
| `data-auto` | `"false"` = don't start automatically; call `CloseMoreCopilot.init({ apiBase })` yourself | start |

Page API (`window.CloseMoreCopilot`):

| Call | When |
|---|---|
| `reset()` | **On logout.** Forgets this browser tab's conversation and removes the chat. Required, so the next person on the same browser never sees the previous chat. |
| `open()` / `close()` / `toggle()` | Optional, e.g. an "Ask AI" link in a menu. |
| `init({ apiBase, loadFonts })` | Only with `data-auto="false"`. |
| `destroy()` | Remove the chat from the page. |

The chat lives inside a Shadow DOM: the website's CSS cannot change it, and its CSS cannot change the
website. It sits above the page (`z-index: 2147483000`). On phones the panel covers the screen.

## 3. Endpoints the website backend provides

The browser only calls these two, on the website's own domain, with the normal login cookie
(`credentials: "include"`). It never sends a user id and never talks to the AI service.

| Browser calls | Website backend forwards to | Adds |
|---|---|---|
| `POST {api-base}/ask` body `{ question, session_id }` | `POST {AI}/v1/ask` | `X-Copilot-Service-Key`, `X-Copilot-User-Id` (from ITS session) |
| `POST {api-base}/feedback` body `{ request_id, rating, comment?, session_id? }` | `POST {AI}/v1/feedback` | same two headers |

Pass the body and the AI's JSON answer through unchanged, with the same status code. Timeout at least
120 s. See `WEBSITE_FRONTEND_GUIDE.md` from the AI team for the full proxy rules.

What the chat shows for errors:

| Status from your endpoint | Shown |
|---|---|
| 401 | "Please log in again." |
| other 4xx with `{ "detail": "..." }` | the `detail` text (as plain text) |
| 5xx, timeout, network | "The assistant is not available right now. Please try again." + Retry |

## 4. Content Security Policy (only if the website uses one)

- `script-src`: the place you host `closemore-copilot.js`.
- `style-src`: `'unsafe-inline'` (the chat adds its own `<style>` elements), plus
  `https://fonts.googleapis.com` unless `data-fonts="false"`.
- `font-src`: `https://fonts.gstatic.com` unless `data-fonts="false"`.
- `img-src`: `data:` (icons are built in).
- `connect-src`: the website's own domain (or the `data-api-base` domain).

## 5. Not part of the website chat

No user/role picker, no `X-Demo-User`, no document upload (the website has its own upload; its backend
tells the AI with `/internal/index` and `/internal/remove`).

## 6. Trying it locally

- `npx vite dev` → a stand-in website page with the chat. With `VITE_USE_MOCK_API=true` in `.env.local`
  it answers with sample data, no backend needed.
- `npm run build:widget`, then open `widget-demo/index.html` through any local web server from the
  project folder: a test page with deliberately odd CSS, to check the chat isn't affected.
  (`WIDGET_MOCK=true npm run build:widget` builds a test file with sample answers; never deploy that one.)
