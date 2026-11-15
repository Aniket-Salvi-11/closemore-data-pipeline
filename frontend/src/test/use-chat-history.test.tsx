import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-service")>();
  return { ...actual, askQuestion: vi.fn() };
});

import { ApiError, askQuestion } from "@/lib/api-service";
import { useChat } from "@/hooks/use-chat";

const mocked = vi.mocked(askQuestion);
const ANSWER = "Two owners.\nInterpreted as: deals by owner\nShall I try again? (yes/no)";

beforeEach(() => {
  mocked.mockReset();
  window.sessionStorage.clear();
});

describe("useChat: what is sent", () => {
  it("sends only the question and the same session id each time (the AI keeps the history)", async () => {
    mocked.mockResolvedValueOnce({ answer: ANSWER });
    mocked.mockResolvedValueOnce({ answer: "ok" });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("deals by owner");
    });
    await act(async () => {
      await result.current.send("yes");
    });
    expect(mocked.mock.calls[0]?.length).toBe(2);
    expect(mocked.mock.calls[1]?.[0]).toBe("yes");
    expect(mocked.mock.calls[1]?.[1]).toBe(mocked.mock.calls[0]?.[1]);
    // The answer text is kept exactly as received.
    expect(result.current.messages[1]?.content).toBe(ANSWER);
  });

  it("keeps table, chart, scope and sources on the message for display", async () => {
    mocked.mockResolvedValueOnce({
      answer: "a",
      route: "RAG",
      table: { columns: ["Owner", "Deals"], rows: [["A", 1]], truncated: false },
      sources: [{ n: 1, document: "d", page: 1, doc_id: null, snippet: null }],
      scope: { label: "Deals in East" },
    });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("one");
    });
    expect(result.current.messages[1]?.table?.rows).toEqual([["A", 1]]);
    expect(result.current.messages[1]?.scope?.label).toBe("Deals in East");
    expect(result.current.messages[1]?.sources).toHaveLength(1);
  });

  it("Retry resends the same question without adding it to the chat twice", async () => {
    mocked.mockRejectedValueOnce(
      new ApiError("The assistant is not available right now. Please try again."),
    );
    mocked.mockResolvedValueOnce({ answer: "ok" });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("deals by owner");
    });
    expect(result.current.error?.message).toMatch(/not available/);
    await act(async () => {
      result.current.retry();
    });
    await act(async () => {});
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(result.current.messages.map((m) => m.content)).toEqual(["deals by owner", "ok"]);
  });
});
