/**
 * API service for the CloseMore AI Copilot.
 *
 * The chat talks ONLY to the website's own backend (see runtime-config.ts):
 *   POST {apiBase}/ask       body: { question, session_id }  ->  { answer, route, table, ... }
 *   POST {apiBase}/feedback  body: { request_id, rating, comment?, session_id? }
 * The website backend checks the login, adds the AI service key and the user id from ITS session,
 * and passes the AI's answer back unchanged. The AI keeps the conversation history itself, per
 * session_id, so no history is sent from the browser.
 *
 * No URLs of the AI service, secrets or user ids belong in this file.
 * Set VITE_USE_MOCK_API=true to use simulated answers during development.
 */

import { parsePeople, type PersonRef } from "@/lib/people";
import { mockAsk } from "@/lib/mock-api";
import { getConfig } from "@/lib/runtime-config";
import {
  parseChart,
  parseTable,
  type ResultChartSpec,
  type ResultTableData,
} from "@/lib/result-data";

/** Request settings. */
export const API_CONFIG = {
  /**
   * How long to wait before giving up (ms). The website proxy waits at least 120 s
   * (local models can take up to a minute), so the browser waits a bit longer.
   */
  timeoutMs: 150_000,
} as const;

/** When true, the UI runs on simulated answers (development only). */
export const USE_MOCK = import.meta.env["VITE_USE_MOCK_API"] === "true";

/** Shown for 401: the website session ended. */
export const LOGIN_AGAIN_MESSAGE = "Please log in again.";
/** Shown for 5xx, timeouts and network failures. */
export const UNAVAILABLE_MESSAGE = "The assistant is not available right now. Please try again.";

/**
 * Error message for a failed response, as the website guide asks:
 * 401 -> log in again; other 4xx -> the backend's `detail` text; 5xx -> a generic message.
 * Server text is shown as plain text (never HTML) and cut to a sensible length.
 */
async function errorMessageFor(response: Response): Promise<string> {
  if (response.status === 401) return LOGIN_AGAIN_MESSAGE;
  if (response.status >= 500) return UNAVAILABLE_MESSAGE;
  try {
    const data = await response.json();
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 300);
  } catch {
    // Not JSON: use the generic message below.
  }
  return "Your question couldn't be answered. Try rephrasing it.";
}

/** What the backend says it applied to this answer. Shown as a small caption, never sent back. */
export interface AnswerScope {
  label: string;
}

/** One document the answer relied on. `n` is the number the answer text cites ("Source 2"). */
export interface AnswerSource {
  n: number;
  document: string;
  /** First page is 1. */
  page: number | null;
  /** Same id as the Documents panel; null for older documents. */
  doc_id: string | null;
  /** Up to ~300 characters of the matching text. */
  snippet: string | null;
}

/** A clickable reply the backend offers when it asks "which one?". `value` is what gets sent. */
export interface AnswerChoice {
  label: string;
  value: string;
  /**
   * "option": a tickable row in a "which one?" list; "all": the All N / Both button;
   * "followup": a follow-up such as "Show their deals" that can be narrowed to selected letters.
   */
  kind?: "option" | "all" | "followup";
  /** For kind "followup": "deals", "contacts" or "everything". */
  action?: string;
  /** For kind "option": the letter (A, B, …). */
  letter?: string;
  /** For kind "option": which name the row answers ("Aman", "Neha Rao"), when several were unclear. */
  group?: string;
}

/** One titled table of an "everything about a person" answer. */
export interface TitledTable {
  title: string;
  table: ResultTableData;
}

export interface AskResponse {
  answer: string;
  /** Optional result rows to show under the answer. */
  table?: ResultTableData;
  /** Optional chart; only ever present together with `table`. */
  chart?: ResultChartSpec;
  /** Optional: whose data this answer covers, for example "Deals in East". */
  scope?: AnswerScope;
  /** Optional: which path answered ("sql", "rag" ...). Only used for a small badge. */
  route?: string;
  /** Optional: documents behind a document-based answer. Already filtered by the backend per user. */
  sources?: AnswerSource[];
  /** Optional: clickable replies for a "which one?" question. */
  choices?: AnswerChoice[];
  /** Optional: several titled tables (instead of `table` and `chart`). */
  tables?: TitledTable[];
  /** Optional: short question shown above "which one?" buttons instead of the answer text. */
  choice_prompt?: string;
  /** Optional: who each letter in a several-people answer is. */
  people?: PersonRef[];
  /** Optional: people from the "which one?" list who are not in this answer ("+N more"). */
  people_more?: PersonRef[];
  /** Optional: id of this answer, used to send 👍/👎 feedback. */
  request_id?: string;
  /** Optional: how long the backend took, in milliseconds. */
  elapsed_ms?: number;
}

/** Typed error so the UI can show a clear, friendly message. */
export class ApiError extends Error {
  status: number | undefined;

  constructor(message: string, status?: number | undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Reads the optional `sources` list. Bad entries are skipped; none left means no sources. */
export function parseSources(raw: unknown): AnswerSource[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerSource[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const n = r["n"];
    const document = r["document"];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) continue;
    if (typeof document !== "string" || !document.trim()) continue;
    const page = r["page"];
    const docId = r["doc_id"];
    const snippet = r["snippet"];
    out.push({
      n,
      document: document.trim(),
      page: typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : null,
      doc_id: typeof docId === "string" && docId ? docId : null,
      snippet: typeof snippet === "string" && snippet.trim() ? snippet.trim() : null,
    });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Reads the optional `tables` list. Bad entries are skipped; none left means no tables. */
export function parseTables(raw: unknown): TitledTable[] {
  if (!Array.isArray(raw)) return [];
  const out: TitledTable[] = [];
  for (const item of raw) {
    const table = parseTable(item);
    if (!table || table.rows.length === 0) continue;
    const title = (item as Record<string, unknown>)["title"];
    out.push({ title: typeof title === "string" ? title.trim() : "", table });
  }
  return out.slice(0, 12);
}

/** Reads the optional `choices` list. Bad entries are skipped; none left means no buttons. */
export function parseChoices(raw: unknown): AnswerChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerChoice[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const label = r["label"];
    const value = r["value"];
    if (typeof label !== "string" || !label.trim()) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    const rawKind = r["kind"];
    // "person" was the first name for "option"; both mean a tickable row.
    const kind =
      rawKind === "option" || rawKind === "person"
        ? "option"
        : rawKind === "all" || rawKind === "followup"
          ? rawKind
          : null;
    const action = r["action"];
    const letter = r["letter"];
    const group = r["group"];
    out.push({
      label: label.trim(),
      value: value.trim(),
      ...(kind ? { kind } : {}),
      ...(typeof letter === "string" && letter.trim() ? { letter: letter.trim() } : {}),
      ...(kind === "followup" && typeof action === "string" && action.trim()
        ? { action: action.trim() }
        : {}),
      ...(kind === "option" && typeof group === "string" && group.trim()
        ? { group: group.trim() }
        : {}),
    });
  }
  // Lists can run A–Z (up to 20 people, plus "All N"); keep a generous safety cap.
  return out.slice(0, 40);
}

/** Reads the optional `scope` object. Anything without a usable label is ignored. */
function parseScope(raw: unknown): AnswerScope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const label = (raw as Record<string, unknown>)["label"];
  return typeof label === "string" && label.trim() ? { label: label.trim() } : null;
}

/**
 * Sends a question to the backend and returns the answer.
 * Throws `ApiError` with a human-readable message on any failure.
 * On HTTP 401 the active user is cleared (the start screen shows again); nothing is added to the chat.
 */
export async function askQuestion(question: string, sessionId?: string): Promise<AskResponse> {
  if (USE_MOCK) {
    const started = Date.now();
    const answer = await mockAsk(question);
    return {
      ...answer,
      request_id: Math.random().toString(16).slice(2, 10).padEnd(8, "0"),
      elapsed_ms: Date.now() - started,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

  try {
    const response = await fetch(`${getConfig().apiBase}/ask`, {
      method: "POST",
      // The website's login cookie goes along; nothing else identifies the user.
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question, ...(sessionId ? { session_id: sessionId } : {}) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(await errorMessageFor(response), response.status);
    }

    const data = await response.json();
    const answer = data?.answer;

    if (typeof answer !== "string" || !answer.trim()) {
      throw new ApiError(UNAVAILABLE_MESSAGE);
    }

    // Optional display-only fields. Malformed ones are ignored, never an error.
    // (`sql` is not used by the UI and may be null.)
    const table = parseTable(data?.table);
    const chart = parseChart(data?.chart, table);
    const scope = parseScope(data?.scope);
    const sources = parseSources(data?.sources);
    const choices = parseChoices(data?.choices);
    const tables = parseTables(data?.tables);
    const people = parsePeople(data?.people);
    const peopleMore = parsePeople(data?.people_more);
    const choicePrompt =
      typeof data?.choice_prompt === "string" && data.choice_prompt.trim()
        ? data.choice_prompt.trim()
        : null;
    const requestId =
      typeof data?.request_id === "string" && data.request_id.trim()
        ? data.request_id.trim()
        : null;
    const elapsed =
      typeof data?.elapsed_ms === "number" &&
      Number.isFinite(data.elapsed_ms) &&
      data.elapsed_ms >= 0
        ? data.elapsed_ms
        : null;
    const route = typeof data?.route === "string" && data.route.trim() ? data.route.trim() : null;

    return {
      answer,
      ...(table ? { table } : {}),
      ...(chart ? { chart } : {}),
      ...(scope ? { scope } : {}),
      ...(route ? { route } : {}),
      ...(sources.length > 0 ? { sources } : {}),
      ...(choices.length > 0 ? { choices } : {}),
      ...(tables.length > 0 ? { tables } : {}),
      ...(people.length > 0 ? { people } : {}),
      ...(peopleMore.length > 0 ? { people_more: peopleMore } : {}),
      ...(choicePrompt && choices.length > 0 ? { choice_prompt: choicePrompt } : {}),
      ...(requestId ? { request_id: requestId } : {}),
      ...(elapsed !== null ? { elapsed_ms: elapsed } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // Timeout or network failure.
    throw new ApiError(UNAVAILABLE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

export type FeedbackRating = "up" | "down" | "none";

/**
 * Sends 👍/👎 for one answer (POST {apiBase}/feedback). "none" removes the rating.
 * Throws ApiError on failure (the UI shows a quiet "Couldn't save your feedback").
 */
export async function sendFeedback(input: {
  requestId: string;
  rating: FeedbackRating;
  comment?: string;
  sessionId?: string;
}): Promise<void> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  }
  let response: Response;
  try {
    response = await fetch(`${getConfig().apiBase}/feedback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        request_id: input.requestId,
        rating: input.rating,
        ...(input.comment ? { comment: input.comment.slice(0, 1000) } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      }),
    });
  } catch {
    throw new ApiError("Couldn't save your feedback.");
  }
  if (!response.ok) throw new ApiError("Couldn't save your feedback.", response.status);
}
