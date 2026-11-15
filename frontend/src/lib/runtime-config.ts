/**
 * Where the chat sends its requests. Set once by the widget (or the dev page) at start-up.
 *
 * Production: the website's own backend endpoints (same domain, normal login cookie), e.g.
 *   POST /api/copilot/ask       -> the website adds the service key and the logged-in user id
 *   POST /api/copilot/feedback  -> same
 * The browser never talks to the AI service directly and never sends a user id.
 */
export interface CopilotConfig {
  /** Base path or URL of the website's Copilot endpoints, without a trailing slash. */
  apiBase: string;
}

const envBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();

let config: CopilotConfig = {
  apiBase: (envBase || "/api/copilot").replace(/\/+$/, ""),
};

export function getConfig(): CopilotConfig {
  return config;
}

export function setConfig(next: Partial<CopilotConfig>): void {
  config = {
    ...config,
    ...(next.apiBase ? { apiBase: next.apiBase.trim().replace(/\/+$/, "") } : {}),
  };
}
