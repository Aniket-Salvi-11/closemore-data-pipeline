import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askQuestion,
  ApiError,
  parseChoices,
  parseSources,
  parseTables,
  sendFeedback,
} from "@/lib/api-service";
import { getActiveUser, setActiveUser } from "@/lib/active-user";
import { findMockUser } from "@/lib/mock-users";

const priya = findMockUser("seed-u-5");
if (!priya) throw new Error("missing mock user");
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
  setActiveUser(priya);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setActiveUser(null);
});

describe("askQuestion (real backend)", () => {
  it("sends the identity header and parses scope; sql may be null", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        question: "q",
        route: "sql",
        answer: "ok",
        sql: null,
        sql_error: null,
        scope: { label: "Your deals in Indore" },
      }),
    );
    const result = await askQuestion("q", []);
    expect(result.scope?.label).toBe("Your deals in Indore");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Demo-User"]).toBe("seed-u-5");
  });

  it("ignores a malformed scope", async () => {
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", scope: { nope: 1 } }));
    const result = await askQuestion("q", []);
    expect(result.scope).toBeUndefined();
  });

  it("passes the route through and ignores a non-text route", async () => {
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", route: "rag" }));
    expect((await askQuestion("q", [])).route).toBe("rag");
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", route: 5 }));
    expect((await askQuestion("q", [])).route).toBeUndefined();
  });

  it("on 401 clears the active user and throws", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 401));
    await expect(askQuestion("q", [])).rejects.toBeInstanceOf(ApiError);
    expect(getActiveUser()).toBeNull();
  });
});

describe("askQuestion (mock mode)", () => {
  it("answers from what the active person can see and labels the scope", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "true");
    vi.resetModules();
    const fresh = await import("@/lib/api-service");
    const active = await import("@/lib/active-user");
    active.setActiveUser(priya);
    vi.useFakeTimers();
    const pending = fresh.askQuestion("deals by owner", []);
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.scope?.label).toBe(priya.scope_label);
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
    expect((await askQuestion("q", [])).choices).toEqual([{ label: "1", value: "1" }]);
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", choices: null }));
    expect((await askQuestion("q", [])).choices).toBeUndefined();
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
    const r = await askQuestion("q", []);
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
    const r = await askQuestion("q", []);
    expect(r.request_id).toBe("697ec8ad");
    expect(r.elapsed_ms).toBe(12345);
    fetchMock.mockResolvedValueOnce(json({ answer: "ok", request_id: 5, elapsed_ms: "x" }));
    const bad = await askQuestion("q", []);
    expect(bad.request_id).toBeUndefined();
    expect(bad.elapsed_ms).toBeUndefined();
  });

  it("POSTs /feedback with the identity header, and only includes comment/session when given", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await sendFeedback({ requestId: "r1", rating: "down", comment: "bad", sessionId: "s1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/feedback$/);
    expect(JSON.parse(init.body as string)).toEqual({
      request_id: "r1",
      rating: "down",
      comment: "bad",
      session_id: "s1",
    });
    expect((init.headers as Record<string, string>)["X-Demo-User"]).toBe("seed-u-5");

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await sendFeedback({ requestId: "r1", rating: "none" });
    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ request_id: "r1", rating: "none" });
  });

  it("throws on a failed save, and a 401 returns the user to the picker", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 404));
    await expect(sendFeedback({ requestId: "r1", rating: "up" })).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 401));
    await expect(sendFeedback({ requestId: "r1", rating: "up" })).rejects.toBeInstanceOf(ApiError);
    expect(getActiveUser()).toBeNull();
  });
});
