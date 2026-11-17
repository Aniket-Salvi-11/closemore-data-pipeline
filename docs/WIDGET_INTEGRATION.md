# Cleo (CloseMore AI Copilot): adding the chat to the website

For the website team. The chat assistant is called **Cleo**, and the whole chat is **one JavaScript file**.
It shows Cleo's round face in the bottom-right corner of every logged-in page; clicking it opens the chat
panel, and ✕ or Esc closes it.

## 1. Build the file

In the Copilot frontend project:

```
npm install
npm run build:widget
```

Result: `dist-widget/closemore-copilot.js` (about 1.1 MB, 350 KB gzipped). React, styles and images (Cleo's
pictures included) are inside it. Settings in `.env` / `.env.local` are ignored on purpose, so mock mode or a
local API address can never end up in this file.

## 2. Add it to the website

Copy the file to the website's static files (for example `/copilot/closemore-copilot.js`) and add one tag to
the **shared layout of the logged-in pages** (the template every page after login uses):

```html
<script src="/copilot/closemore-copilot.js" data-api-base="/api/copilot" defer></script>
```

- Cleo then appears on **every page after login**, with no other work per page.
- **Never put the tag on the login page or other public pages** (sign-up, password reset). Cleo is only for
  logged-in users; without a login every question would only get "Please log in again."

| Attribute | Meaning | Default |
|---|---|---|
| `data-api-base` | Where the website's Copilot endpoints are (section 3) | `/api/copilot` |
| `data-position` | `"left"` = bottom-left corner, e.g. if the website already uses the bottom-right corner (cookie banner, another chat, "back to top") | bottom-right |
| `data-fonts` | `"false"` = don't load the DM Sans font from Google Fonts (system font is used) | load |
| `data-auto` | `"false"` = don't start automatically; call `CloseMoreCopilot.init({ apiBase, position })` yourself | start |

Page API (`window.CloseMoreCopilot`):

| Call | When |
|---|---|
| `reset()` | **On logout.** Forgets this browser tab's conversation, closes the chat and removes it. Required, so the next person on the same browser never sees the previous chat. |
| `open()` / `close()` / `toggle()` | Optional, e.g. an "Ask Cleo" link in a menu. |
| `init({ apiBase, loadFonts, position })` | Only with `data-auto="false"`. |
| `destroy()` | Remove the chat from the page. |

### How Cleo behaves across pages

| | |
|---|---|
| Greeting bubble ("Hi, I'm Cleo…") | Once per browser tab, a moment after the first page loads; never again on later pages |
| Panel open when the user clicks a website link | Stays open on the next page, with the same conversation, opened at the newest message |
| Panel size (normal 400 × 680 / wide / full screen) | Chosen with the size button in Cleo's header; remembered on the next page. On phones the panel always fills the screen |
| Animations (floating button, open, close, resize) | Follow the visitor's "reduce motion" setting: off for people who asked their system for less motion |
| A question still being answered when the user leaves the page | The answer is not shown on the next page; the user asks again |

Everything is kept per browser tab (sessionStorage): two tabs are two conversations.

The chat lives inside a Shadow DOM: the website's CSS cannot change it, and its CSS cannot change the
website. It sits above the page (`z-index: 2147483000`).

## 3. Endpoints the website backend provides

The browser only calls these two, on the website's own domain, with the normal login cookie
(`credentials: "include"`). It never sends a user id and never talks to the AI service.

| Browser calls | Website backend forwards to | Adds |
|---|---|---|
| `POST {api-base}/ask` body `{ question, session_id }` | `POST {AI}/v1/ask` | `X-Copilot-Service-Key`, `X-Copilot-User-Id` (from ITS session) |
| `POST {api-base}/feedback` body `{ request_id, rating, comment?, session_id? }` | `POST {AI}/v1/feedback` | same two headers |

Pass the body and the AI's JSON answer through unchanged, with the same status code. Timeout about 150 s.
See `WEBSITE_FRONTEND_GUIDE.md` for the full proxy rules.

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
- `img-src`: `data:` (Cleo's pictures and icons are built in).
- `connect-src`: the website's own domain (or the `data-api-base` domain).

## 5. Not part of the website chat

No user/role picker, no `X-Demo-User`, no document upload (the website has its own upload; its backend
tells the AI with `/internal/index` and `/internal/remove`).

## 6. Trying it locally

- `npx vite dev` → a stand-in website page with Cleo. With `VITE_USE_MOCK_API=true` in `.env.local`
  it answers with sample data, no backend needed.
- `npm run build:widget`, then open `widget-demo/index.html` through any local web server from the
  project folder: a test page with deliberately odd CSS, to check Cleo isn't affected.
  (`WIDGET_MOCK=true npm run build:widget` builds a test file with sample answers; never deploy that one.)
