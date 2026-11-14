import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-service")>();
  return { ...actual, askQuestion: vi.fn() };
});

import { askQuestion } from "@/lib/api-service";
import { useChat } from "@/hooks/use-chat";

const mocked = vi.mocked(askQuestion);
const ANSWER = "Two owners.\nInterpreted as: deals by owner\nShall I try again? (yes/no)";

describe("useChat history", () => {
  beforeEach(() => mocked.mockReset());

  it("keeps the answer text exact and sends only role/content in history", async () => {
    mocked.mockResolvedValueOnce({
      answer: ANSWER,
      table: { columns: ["Owner", "Deals"], rows: [["A", 1]], truncated: false },
      chart: { type: "bar", x: "Owner", series: ["Deals"] },
    });
    mocked.mockResolvedValueOnce({ answer: "ok" });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("deals by owner");
    });

    // Table and chart are kept on the message for display...
    expect(result.current.messages[1]?.table?.rows).toEqual([["A", 1]]);
    expect(result.current.messages[1]?.content).toBe(ANSWER);

    await act(async () => {
      await result.current.send("yes");
    });

    // ...but history carries plain text only.
    const history = mocked.mock.calls[1]?.[1];
    expect(history).toEqual([
      { role: "user", content: "deals by owner" },
      { role: "assistant", content: ANSWER },
    ]);
    expect(Object.keys(history?.[1] ?? {}).sort()).toEqual(["content", "role"]);
  });

  it("stores the scope on the message but never sends it back in history", async () => {
    mocked.mockResolvedValueOnce({
      answer: "a",
      route: "RAG",
      sources: [{ n: 1, document: "d", page: 1, doc_id: null, snippet: null }],
      scope: { label: "Deals in East" },
    });
    mocked.mockResolvedValueOnce({ answer: "b" });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("one");
    });
    expect(result.current.messages[1]?.scope?.label).toBe("Deals in East");
    expect(result.current.messages[1]?.sources).toHaveLength(1);
    await act(async () => {
      await result.current.send("two");
    });
    const history = mocked.mock.calls[1]?.[1] ?? [];
    expect(history.every((m) => Object.keys(m).sort().join() === "content,role")).toBe(true);
  });
});
