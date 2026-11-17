/**
 * Where the chat sends its requests. Set once by the widget (or the dev page) at start-up.
 *
 * Production: the website's own backend endpoints (same domain, normal login cookie), e.g.
 *   POST /api/copilot/ask       -> the website adds the service key and the logged-in user id
 *   POST /api/copilot/feedback  -> same
 * The browser never talks to the AI service directly and never sends a user id.
 */
/** Which bottom corner Cleo's button and panel sit in (data-position on the script tag). */
export type CopilotPosition = "right" | "left";

export interface CopilotConfig {
  /** Base path or URL of the website's Copilot endpoints, without a trailing slash. */
  apiBase: string;
  /** Bottom-right (default) or bottom-left, e.g. when the website already uses the right corner. */
  position: CopilotPosition;
}

const envBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();

let config: CopilotConfig = {
  apiBase: (envBase || "/api/copilot").replace(/\/+$/, ""),
  position: "right",
};

export function getConfig(): CopilotConfig {
  return config;
}

/** "left" / "bottom-left" -> left; anything else (or nothing) -> right. */
export function parsePosition(value: string | null | undefined): CopilotPosition {
  return /^\s*(bottom-)?left\s*$/i.test(value ?? "") ? "left" : "right";
}

export function setConfig(next: Partial<CopilotConfig>): void {
  config = {
    ...config,
    ...(next.apiBase ? { apiBase: next.apiBase.trim().replace(/\/+$/, "") } : {}),
    ...(next.position ? { position: next.position } : {}),
  };
}
