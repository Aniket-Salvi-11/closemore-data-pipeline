/**
 * CloseMore AI Copilot — website widget.
 *
 * Add ONE script tag to the website's pages (for logged-in users only):
 *
 *   <script src="/copilot/closemore-copilot.js" data-api-base="/api/copilot" defer></script>
 *
 * It adds the round CloseMore icon in the bottom-right corner; clicking it opens the chat.
 * Everything lives inside a Shadow DOM, so the website's CSS and the chat's CSS never mix.
 *
 * Options (data attributes on the script tag):
 *   data-api-base   where the website's Copilot endpoints are (default "/api/copilot")
 *   data-fonts      "false" to skip loading the DM Sans font from Google Fonts
 *   data-auto       "false" to start it yourself with window.CloseMoreCopilot.init({...})
 *
 * Page API (window.CloseMoreCopilot): init(options), open(), close(), toggle(),
 * reset() (call on logout: forgets this tab's conversation), destroy().
 */
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopilotWidget, type CopilotControls } from "@/components/copilot/CopilotWidget";
import { clearStoredChat } from "@/hooks/use-chat";
import { PortalContainerProvider } from "@/lib/portal-container";
import { setConfig } from "@/lib/runtime-config";
import rawCss from "@/styles.css?inline";
import { prepareCss } from "./prepare-css";

interface InitOptions {
  apiBase?: string;
  loadFonts?: boolean;
}

const HOST_ID = "closemore-copilot";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Instrument+Serif:ital@0;1&display=swap";

let root: Root | null = null;
let controls: CopilotControls | null = null;

function addToHead(id: string, make: () => HTMLElement): void {
  if (document.getElementById(id)) return;
  const el = make();
  el.id = id;
  document.head.appendChild(el);
}

function init(options: InitOptions = {}): void {
  if (root) return; // already running
  if (options.apiBase) setConfig({ apiBase: options.apiBase });

  const { shadowCss, documentCss } = prepareCss(rawCss);
  addToHead("closemore-copilot-doc-css", () => {
    const style = document.createElement("style");
    style.textContent = documentCss;
    return style;
  });
  if (options.loadFonts !== false) {
    addToHead("closemore-copilot-fonts", () => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      return link;
    });
  }

  // The host element: fixed, on top of the website, and taking no space of its own.
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  // `all: initial` stops the website's inherited text styles from leaking into the chat.
  style.textContent = `:host{all:initial}\n${shadowCss}`;
  shadow.appendChild(style);

  const app = document.createElement("div");
  app.className = "font-sans text-foreground antialiased";
  app.style.cssText = "font-size:16px;line-height:1.5;";
  shadow.appendChild(app);

  root = createRoot(app);
  root.render(
    <StrictMode>
      <PortalContainerProvider container={app}>
        <CopilotWidget onReady={(c) => (controls = c)} />
      </PortalContainerProvider>
    </StrictMode>,
  );
}

function destroy(): void {
  root?.unmount();
  root = null;
  controls = null;
  document.getElementById(HOST_ID)?.remove();
}

const api = {
  init,
  open: () => controls?.open(),
  close: () => controls?.close(),
  toggle: () => controls?.toggle(),
  /** Call on logout: forgets this tab's conversation and closes the panel. */
  reset: () => {
    clearStoredChat();
    try {
      window.sessionStorage.removeItem("closemore-copilot-open");
    } catch {
      // ignore
    }
    destroy();
  },
  destroy,
};

declare global {
  interface Window {
    CloseMoreCopilot?: typeof api;
  }
}
window.CloseMoreCopilot = api;

// Auto-start from the script tag's data attributes.
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset["auto"] !== "false") {
  const start = () =>
    init({
      ...(script?.dataset["apiBase"] ? { apiBase: script.dataset["apiBase"] } : {}),
      loadFonts: script?.dataset["fonts"] !== "false",
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
