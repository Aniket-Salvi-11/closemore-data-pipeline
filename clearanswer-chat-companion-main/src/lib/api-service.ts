/**
 * API service for the question-answering backend.
 *
 * Connected to the CloseMore AI Copilot FastAPI server:
 *   POST {baseUrl}/ask   body: { question, history, session_id }   ->   { answer, route, sql, scope, ... }
 * `history` is the last few chat messages, kept in the browser, so follow-up questions work.
 * `session_id` identifies the chat session; the backend writes one log file per session.
 *
 * The base URL comes from VITE_API_BASE_URL (see .env.local) and defaults to
 * http://localhost:8000. Set VITE_USE_MOCK_API=true to use simulated answers instead.
 *
 * No secrets or credentials belong in this file.
 */

import { parsePeople, type PersonRef } from "@/lib/people";
import { getActiveUser, getActiveUserId, reportUnauthorized } from "@/lib/active-user";
import { scopedMockAnswer } from "@/lib/mock-rbac";
import {
  parseChart,
  parseTable,
  type ResultChartSpec,
  type ResultTableData,
} from "@/lib/result-data";
import type { DemoUser } from "@/lib/demo-users";

const envBaseUrl = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

/** Backend connection settings. */
export const API_CONFIG = {
  /** FastAPI server base URL (no trailing slash). */
  baseUrl: (envBaseUrl?.trim() || "http://localhost:8000").replace(/\/+$/, ""),
  /** POST endpoint that answers questions */
  askPath: "/ask",
  /**
   * How long to wait for the backend before giving up (ms). Generous on purpose:
   * the pipeline makes several sequential LLM calls on a CPU server.
   */
  timeoutMs: 600_000,
} as const;

/**
 * When true, the UI runs entirely on simulated responses (answers, /demo/users, /me and the Documents
 * endpoints) so you can demo it before the backend is ready.
 * Set VITE_USE_MOCK_API=true in .env.local to turn it on. Default is off (real requests).
 */
export const USE_MOCK = import.meta.env["VITE_USE_MOCK_API"] === "true";

/**
 * Identity headers sent on EVERY backend request. The single place to change auth.
 * TODO(auth): DEMO ONLY. The user id comes from the role picker. For a real login, replace the
 * body with { Authorization: `Bearer ${token}` } and nothing else needs to change.
 * Returns {} when no user is selected. Never send role, region or owner in a request body.
 */
export function authHeaders(): Record<string, string> {
  const userId = getActiveUserId();
  return userId ? { "X-Demo-User": userId } : {};
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

/** One earlier chat message, sent along so the backend can understand follow-up questions. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
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
export async function askQuestion(
  question: string,
  history: HistoryTurn[] = [],
  sessionId?: string,
): Promise<AskResponse> {
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
    const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.askPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ question, history, session_id: sessionId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Try to surface a message the backend sent; fall back to the status code.
      let message = `The backend responded with an error (HTTP ${response.status}).`;
      try {
        const data = await response.json();
        const detail = data?.message ?? data?.error ?? data?.detail;
        if (typeof detail === "string" && detail.trim()) message = detail;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      // Not identified, or the user is unknown or inactive: back to the picker.
      if (response.status === 401) reportUnauthorized();
      throw new ApiError(message, response.status);
    }

    const data = await response.json();
    const answer = data?.answer ?? data?.response ?? data?.result;

    if (typeof answer !== "string" || !answer.trim()) {
      throw new ApiError("The backend returned an empty response.");
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

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out. Please try again.");
    }

    throw new ApiError("Could not reach the backend. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

export type FeedbackRating = "up" | "down" | "none";

/**
 * Sends 👍/👎 for one answer (POST /feedback). "none" removes the rating.
 * Throws ApiError on failure; a 401 returns the user to the start screen like every other call.
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
    response = await fetch(`${API_CONFIG.baseUrl}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
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
  if (response.status === 401) reportUnauthorized();
  if (!response.ok) throw new ApiError("Couldn't save your feedback.", response.status);
}

/* ------------------------------------------------------------------ */
/* Mock backend (used while USE_MOCK is true)                          */
/* ------------------------------------------------------------------ */

const MOCK_ANSWERS = [
  "Here's a quick summary: the key idea is to break the problem into smaller, verifiable steps, then check each one against the data you already have. That keeps the answer grounded and easy to follow.",
  "Short answer: yes, with a caveat. It works well for most everyday cases, but you'll want to double-check edge cases where the underlying assumptions change.",
  "Think of it in three parts:\n\n1. What it is — a structured way of turning raw input into a usable result.\n2. Why it matters — it removes manual guesswork and keeps results consistent.\n3. How to start — define your input, define the expected output, then iterate on the middle.",
  "The main factors are cost, speed, and reliability. Cost favors the simple option, speed favors the automated one, and reliability usually comes from combining both with a human review step at the end.",
  "That depends on your setup, but in most configurations the default behavior is the right starting point. Change it only when you have a concrete reason — measure first, then adjust.",
];

const MOCK_OWNER_TABLE: ResultTableData = {
  columns: ["Owner", "Deals", "Won"],
  rows: [
    ["Aman Jain", 12480, 5200],
    ["Raman Mathur", 9300, 4100],
    ["Priya Nair", 7150, 3900],
    ["Karan Shah", 4020, null],
  ],
  truncated: false,
};

const MOCK_TREND_TABLE: ResultTableData = {
  columns: ["Month", "New deals"],
  rows: [
    ["2026-06-01", 14],
    ["2026-07-01", 18],
    ["2026-08-01", 11],
    ["2026-09-01", 23],
    ["2026-10-01", 27],
  ],
  truncated: false,
};

const MOCK_CONTACT_TABLE: ResultTableData = {
  columns: ["Contact", "Company", "Phone", "Active"],
  rows: Array.from({ length: 50 }, (_, i) => [
    `Contact ${i + 1}`,
    i % 4 === 0 ? null : `Company ${(i % 7) + 1}`,
    i % 3 === 0 ? null : `+91 98765 ${String(10000 + i)}`,
    i % 5 !== 0,
  ]),
  truncated: true,
};

/** Canned answer for the case where nobody is selected (not normally reachable: the picker comes first). */
function genericMockAnswer(q: string): AskResponse {
  if (/trend|month/.test(q)) {
    return {
      answer: "New deals have grown from 14 in June to 27 in October, with a dip in August.",
      table: MOCK_TREND_TABLE,
      chart: { type: "line", x: "Month", series: ["New deals"], title: "New deals per month" },
    };
  }
  if (/contact/.test(q)) {
    return {
      answer: "Here are the contacts. Some have no company or phone on record.",
      table: MOCK_CONTACT_TABLE,
    };
  }
  if (/owner|deal/.test(q)) {
    return {
      answer: "Aman Jain has the most deals by value, followed by Raman Mathur.",
      table: MOCK_OWNER_TABLE,
      chart: {
        type: "bar",
        x: "Owner",
        series: ["Deals", "Won"],
        title: "Deal value by owner",
      },
    };
  }
  const answer = MOCK_ANSWERS[Math.floor(Math.random() * MOCK_ANSWERS.length)] ?? MOCK_ANSWERS[0]!;
  return { answer };
}

const MOCK_DOCUMENT_ANSWER =
  "No, the on-prem infrastructure does not use AWS.\nAccording to **Source 2, page 7**, all production workloads run in the company's own data centres.\n\nThings to know:\n- Backups are copied to a second site every night.\n- A *cloud-based* disaster recovery plan is listed as a future option.";

const MOCK_SOURCES: AnswerSource[] = [
  {
    n: 2,
    document: "Security policy",
    page: 7,
    doc_id: null,
    snippet:
      "All production workloads run in the company's own data centres. No public cloud services are used for customer data.",
  },
];

function scopeOf(user: DemoUser | null): { scope?: AnswerScope } {
  return user && user.scope_label ? { scope: { label: user.scope_label } } : {};
}

/**
 * Simulates the backend: a short delay, then a canned answer.
 * Demo triggers (VITE_USE_MOCK_API=true): "owner"/"deal" and "trend"/"month" questions are answered from
 * the sample deals the ACTIVE USER may see (same rules as the backend); "contact" gets a long table with
 * empty cells and the truncated notice; anything else gets a text-only answer.
 * Like the real backend, every answer carries `scope` describing whose data it covers.
 */
async function mockAsk(question: string): Promise<AskResponse> {
  const delay = 900 + Math.random() * 900;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const q = question.toLowerCase();
  const user: DemoUser | null = getActiveUser();
  // Demo of a long bar chart: long names and more bars than fit, so it scrolls sideways.
  if (/\btop\b/.test(q)) {
    const companies = [
      "Wonka Industries",
      "Stark Industries",
      "Acme Corp",
      "Wayne Enterprises",
      "Aperture Labs",
      "Umbrella Corp",
    ];
    const rows = Array.from({ length: 12 }, (_, i) => [
      i === 0 ? "TATA DEAL" : `Seed Deal ${40 - i * 3} — ${companies[i % companies.length]}`,
      Math.round((252000 - i * 14700 + (i % 3) * 3100) * 100) / 100,
    ]);
    return {
      answer: "Found 12 deals. The details are in the table.",
      route: "SQL",
      table: { columns: ["Deal Name", "Deal Value"], rows, truncated: false },
      chart: {
        type: "bar",
        x: "Deal Name",
        series: ["Deal Value"],
        title: "Deal Value by Deal Name",
      },
      ...scopeOf(user),
    };
  }

  // Demo of the letters flow: several people share a name; tick some and "Show selected".
  const lettersAsked = q.trim().replace(/^show (deals|contacts) of |^show everything about /, "");
  if (
    /^[a-d](\s*(,|and)\s*[a-d])*$/.test(lettersAsked) &&
    (lettersAsked !== q.trim() || /[,]|and/.test(lettersAsked))
  ) {
    const all = q.trim() === "all";
    const picked = all ? ["A", "B", "C", "D"] : (q.toUpperCase().match(/[A-D]/g) ?? []);
    const names: Record<string, [string, string]> = {
      A: ["Aman Kapoor", "Sales rep · Indore"],
      B: ["Aman Mehta", "Sales rep · Pune"],
      C: ["Aman Shah", "Executive · Japan"],
      D: ["Aman Verma", "Sales admin · East"],
    };
    const deals: Record<string, [string, number][]> = {
      A: [
        ["Alpha Steel", 9000],
        ["Indus Mills", 4200],
      ],
      B: [["Pune Logistics", 3100]],
      C: [
        ["Tokyo Rail", 7500],
        ["Osaka Port", 6100],
      ],
      D: [["East Grid", 8800]],
    };
    return {
      answer: `Showing results for ${picked.length} people: ${picked.map((l) => `${l} = ${names[l]?.[0]}`).join(", ")}.`,
      route: "SQL",
      people_more: ["A", "B", "C", "D"]
        .filter((l) => !picked.includes(l))
        .map((l) => ({
          letter: l,
          name: names[l]?.[0] ?? "",
          label: names[l]?.[1] ?? "",
          kind: "user" as const,
        })),
      people: picked.map((l) => ({
        letter: l,
        name: names[l]?.[0] ?? "",
        label: names[l]?.[1] ?? "",
        kind: "user" as const,
      })),
      choices: [
        {
          label: "Show their deals",
          value: `Show deals of ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "deals",
        },
        {
          label: "Show their contacts",
          value: `Show contacts of ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "contacts",
        },
        {
          label: "Show everything",
          value: `Show everything about ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "everything",
        },
      ],
      table: {
        columns: ["Person", "Deal Name", "Deal Value"],
        rows: picked.flatMap((l) => (deals[l] ?? []).map(([d, v]) => [l, d, v])),
        truncated: false,
      },
      ...scopeOf(user),
    };
  }
  if (/aman/.test(q) && /neha/.test(q)) {
    return {
      answer:
        'I found several matches for 2 names:\nAman\nA. Aman Kapoor · Sales rep · Indore · 1 deal\nB. Aman Mehta · Sales rep · Indore · 1 deal\nNeha Rao\nC. Sales rep · Indore · 0 deals\nD. Sales rep · Pune · 0 deals\n\nWhich ones? Reply with one letter for each name, like "A, C", or all.',
      choice_prompt: "I found several matches for 2 names. Which ones?",
      choices: [
        {
          label: "A. Aman Kapoor · Sales rep · Indore · 1 deal",
          value: "A",
          kind: "option" as const,
          letter: "A",
          group: "Aman",
        },
        {
          label: "B. Aman Mehta · Sales rep · Indore · 1 deal",
          value: "B",
          kind: "option" as const,
          letter: "B",
          group: "Aman",
        },
        {
          label: "C. Sales rep · Indore · 0 deals",
          value: "C",
          kind: "option" as const,
          letter: "C",
          group: "Neha Rao",
        },
        {
          label: "D. Sales rep · Pune · 0 deals",
          value: "D",
          kind: "option" as const,
          letter: "D",
          group: "Neha Rao",
        },
        { label: "All 4", value: "all", kind: "all" as const },
      ],
      route: "SQL",
      ...scopeOf(user),
    };
  }
  if (/aman/.test(q)) {
    const list = [
      ["A", "Aman Kapoor · Sales rep · Indore · 3 deals"],
      ["B", "Aman Mehta · Sales rep · Pune · 2 deals"],
      ["C", "Aman Shah · Executive · Japan · 2 deals"],
      ["D", "Aman Verma · Sales admin · East · 1 deal"],
    ] as const;
    return {
      answer: `I found 4 people named Aman:\n${list.map(([l, t]) => `${l}. ${t}`).join("\n")}\n\nWhich one? Reply A, B, C or D, several like "A, D", or all.`,
      choice_prompt: "I found 4 people named Aman. Which one?",
      choices: [
        ...list.map(([l, t]) => ({
          label: `${l}. ${t}`,
          value: l,
          kind: "option" as const,
          letter: l,
        })),
        { label: "All 4", value: "all", kind: "all" as const },
      ],
      route: "SQL",
      ...scopeOf(user),
    };
  }

  // Demo of the "which one?" flow: a name that two people share, then the reply.
  if (/^(1|2|both|all|the other one)$/.test(q.trim())) {
    return {
      answer: `Showing results for ${q.trim() === "1" ? "Priya Nair (Sales rep · Indore · 4 deals)" : q.trim() === "2" ? "Priya Nair (Executive · Japan · 2 deals)" : "all 2 people named Priya Nair"}.`,
      route: "SQL",
      ...scopeOf(user),
    };
  }
  if (/priya/.test(q) && /all data|everything/.test(q)) {
    return {
      answer:
        "Everything about Priya Nair: 4 owned deals worth 10,000, 1 deal-team deal and 1 contact. Tasks and activities are not available in the Copilot.",
      route: "SQL",
      tables: [
        {
          title: "Profile",
          table: {
            columns: ["Name", "Role", "Region"],
            rows: [["Priya Nair", "Sales rep", "Indore"]],
            truncated: false,
          },
        },
        {
          title: "Deals owned",
          table: {
            columns: ["Deal", "Value"],
            rows: [
              ["Acme renewal", 4000],
              ["Beta rollout", 6000],
            ],
            truncated: false,
          },
        },
        {
          title: "Contacts",
          table: {
            columns: ["Contact", "Company"],
            rows: [["Ravi Menon", "Acme"]],
            truncated: false,
          },
        },
      ],
      ...scopeOf(user),
    };
  }
  if (/priya/.test(q)) {
    return {
      answer:
        "I found 2 people named Priya Nair:\n1. Sales rep · Indore · 4 deals\n2. Executive · Japan · 2 deals\n\nWhich one? Reply 1 or 2, or both.",
      route: "SQL",
      choices: [
        { label: "1. Sales rep · Indore · 4 deals", value: "1" },
        { label: "2. Executive · Japan · 2 deals", value: "2" },
        { label: "Both", value: "all" },
      ],
      ...scopeOf(user),
    };
  }
  if (/document|policy|aws|source|infrastructure/.test(q)) {
    return {
      answer: MOCK_DOCUMENT_ANSWER,
      route: "RAG",
      sources: MOCK_SOURCES,
      ...scopeOf(user),
    };
  }
  const answer = (user ? scopedMockAnswer(q, user) : null) ?? genericMockAnswer(q);
  const route = answer.table ? "SQL" : null;
  return { ...answer, ...(route ? { route } : {}), ...scopeOf(user) };
}
