import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askQuestion,
  ApiError,
  LOGIN_AGAIN_MESSAGE,
  parseChoices,
  parseSources,
  parseTables,
  sendFeedback,
  UNAVAILABLE_MESSAGE,
} from "@/lib/api-service";
import { setConfig } from "@/lib/runtime-config";

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setConfig({ apiBase: "/api/copilot" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("askQuestion (production: through the website's backend)", () => {
  it("posts only the question and session id to {apiBase}/ask with the login cookie", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ answer: "ok", sql: null, scope: { label: "Your deals" } }),
    );
    const result = await askQuestion("q", "s1");
    expect(result.scope?.label).toBe("Your deals");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/copilot/ask");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ question: "q", session_id: "s1" });
    // No history, no user id, no demo or AI-service headers from the browser.
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).some((h) => /demo|copilot|user/i.test(h))).toBe(false);
  });

  it("uses the configured address", async () => {
    setConfig({ apiBase: "https://crm.example.com/api/copilot/" });
    fetchMock.mockResolvedValueOnce(json({ answer: "ok" }));
    await askQuestion("q", "s1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://crm.example.com/api/copilot/ask");
  });

  it("ignores a malformed scope and a non-text route", async () => {
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", scope: { nope: 1 }, route: 5 }));
    const result = await askQuestion("q");
    expect(result.scope).toBeUndefined();
    expect(result.route).toBeUndefined();
  });

  it("passes the route through", async () => {
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", route: "RAG" }));
    expect((await askQuestion("q")).route).toBe("RAG");
  });

  it("401: asks the user to log in again", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 401));
    const error = await askQuestion("q").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(LOGIN_AGAIN_MESSAGE);
  });

  it("other 4xx: shows the backend's detail text", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Question is too long." }, 400));
    const error = await askQuestion("q").catch((e: unknown) => e);
    expect((error as ApiError).message).toBe("Question is too long.");
  });

  it("5xx, an empty answer, a timeout or no network: the generic message", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Internal server error." }, 500));
    expect(((await askQuestion("q").catch((e: unknown) => e)) as ApiError).message).toBe(
      UNAVAILABLE_MESSAGE,
    );
    fetchMock.mockResolvedValueOnce(json({ answer: "  " }));
    expect(((await askQuestion("q").catch((e: unknown) => e)) as ApiError).message).toBe(
      UNAVAILABLE_MESSAGE,
    );
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(((await askQuestion("q").catch((e: unknown) => e)) as ApiError).message).toBe(
      UNAVAILABLE_MESSAGE,
    );
  });
});

describe("askQuestion (mock mode, development)", () => {
  it("answers with sample data and a scope, without calling the network", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "true");
    vi.resetModules();
    const fresh = await import("@/lib/api-service");
    vi.useFakeTimers();
    const pending = fresh.askQuestion("deals by owner");
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.scope?.label).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseSources", () => {
  it("reads the backend shape, sorts by n and nulls what is missing", () => {
    const out = parseSources([
      { n: 2, document: "Security policy", page: 7, doc_id: "abc", snippet: " text " },
      { n: 1, document: "Indore proposal", page: null, doc_id: null, snippet: null },
    ]);
    expect(out.map((s) => s.n)).toEqual([1, 2]);
    expect(out[1]).toEqual({
      n: 2,
      document: "Security policy",
      page: 7,
      doc_id: "abc",
      snippet: "text",
    });
    expect(out[0]?.page).toBeNull();
  });

  it("skips bad entries and tolerates null or a non-list", () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources("x")).toEqual([]);
    expect(
      parseSources([{ n: 0, document: "a" }, { n: 1 }, 5, { n: 1, document: "ok", page: 0 }]),
    ).toEqual([{ n: 1, document: "ok", page: null, doc_id: null, snippet: null }]);
  });
});

describe("parseChoices", () => {
  it("reads label/value pairs and skips bad entries", () => {
    expect(
      parseChoices([
        { label: "1. A", value: "1" },
        { label: "", value: "2" },
        { label: "B", value: 3 },
        "x",
        { label: "Both", value: "all" },
      ]),
    ).toEqual([
      { label: "1. A", value: "1" },
      { label: "Both", value: "all" },
    ]);
  });

  it("returns nothing for null or a non-list", () => {
    expect(parseChoices(null)).toEqual([]);
    expect(parseChoices({})).toEqual([]);
  });

  it("is passed through by askQuestion", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ answer: "Which one?", choices: [{ label: "1", value: "1" }] }),
    );
    expect((await askQuestion("q")).choices).toEqual([{ label: "1", value: "1" }]);
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", choices: null }));
    expect((await askQuestion("q")).choices).toBeUndefined();
  });
});

describe("parseTables", () => {
  const t = (title: unknown) => ({
    title,
    columns: ["A", "B"],
    rows: [["x", 1]],
    truncated: false,
  });

  it("reads titled tables in order and skips empty or broken ones", () => {
    const out = parseTables([
      t("Profile"),
      { title: "Broken", columns: "no", rows: [] },
      { title: "Empty", columns: ["A"], rows: [], truncated: false },
      t("Deals owned"),
    ]);
    expect(out.map((x) => x.title)).toEqual(["Profile", "Deals owned"]);
    expect(out[0]?.table.rows).toEqual([["x", 1]]);
  });

  it("tolerates a missing title, null and a non-list", () => {
    expect(parseTables([t(undefined)])[0]?.title).toBe("");
    expect(parseTables(null)).toEqual([]);
    expect(parseTables({})).toEqual([]);
  });

  it("is passed through by askQuestion, and a choice value may be a full sentence", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        answer: "Everything about Priya.",
        table: null,
        chart: null,
        tables: [t("Profile")],
        choices: [{ label: "Show their deals", value: "show Priya Nair deals data" }],
      }),
    );
    const r = await askQuestion("q");
    expect(r.tables).toHaveLength(1);
    expect(r.table).toBeUndefined();
    expect(r.choices?.[0]?.value).toBe("show Priya Nair deals data");
  });
});

describe("request_id, elapsed_ms and feedback", () => {
  it("passes request_id and elapsed_ms through and ignores bad values", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ answer: "ok", request_id: "697ec8ad", elapsed_ms: 12345 }),
    );
    const r = await askQuestion("q");
    expect(r.request_id).toBe("697ec8ad");
    expect(r.elapsed_ms).toBe(12345);
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", request_id: 5, elapsed_ms: "x" }));
    const bad = await askQuestion("q");
    expect(bad.request_id).toBeUndefined();
    expect(bad.elapsed_ms).toBeUndefined();
  });

  it("POSTs {apiBase}/feedback with the login cookie, and only includes comment/session when given", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await sendFeedback({ requestId: "r1", rating: "down", comment: "bad", sessionId: "s1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/copilot/feedback");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      request_id: "r1",
      rating: "down",
      comment: "bad",
      session_id: "s1",
    });

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await sendFeedback({ requestId: "r1", rating: "none" });
    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ request_id: "r1", rating: "none" });
  });

  it("throws on a failed save", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 404));
    await expect(sendFeedback({ requestId: "r1", rating: "up" })).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(sendFeedback({ requestId: "r1", rating: "up" })).rejects.toBeInstanceOf(ApiError);
  });
});
