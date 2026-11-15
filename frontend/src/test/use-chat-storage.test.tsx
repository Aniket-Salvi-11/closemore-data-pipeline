import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-service")>();
  return { ...actual, askQuestion: vi.fn(), sendFeedback: vi.fn() };
});

import { askQuestion, sendFeedback } from "@/lib/api-service";
import { clearStoredChat, useChat } from "@/hooks/use-chat";

const mocked = vi.mocked(askQuestion);

const CHOICES = [
  { label: "1. Sales rep · Indore", value: "1" },
  { label: "Both", value: "all" },
];

beforeEach(() => {
  mocked.mockReset();
  window.sessionStorage.clear();
});

describe("useChat: choices", () => {
  it("sends the value, shows the label, and never sends the choices back", async () => {
    mocked.mockResolvedValueOnce({ answer: "Which one?\n1. A", choices: CHOICES });
    mocked.mockResolvedValueOnce({ answer: "Showing results for A." });
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("tell me about Priya");
    });
    expect(result.current.messages[1]?.choices).toHaveLength(2);

    await act(async () => {
      await result.current.send("1", "1. Sales rep · Indore");
    });
    expect(mocked.mock.calls[1]?.[0]).toBe("1");
    expect(result.current.messages[2]).toMatchObject({
      content: "1",
      display: "1. Sales rep · Indore",
    });
    // Only the question and the session id are sent; the choices are never sent back.
    expect(mocked.mock.calls[1]?.length).toBe(2);
  });
});

describe("useChat: per-tab storage", () => {
  it("a reload keeps the conversation and the same session id", async () => {
    mocked.mockResolvedValue({ answer: "hello" });
    const first = renderHook(() => useChat());
    await act(async () => {
      await first.result.current.send("hi");
    });
    const sessionId = mocked.mock.calls[0]?.[1];
    first.unmount();

    const second = renderHook(() => useChat());
    expect(second.result.current.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    await act(async () => {
      await second.result.current.send("again");
    });
    expect(mocked.mock.calls[1]?.[1]).toBe(sessionId);
  });

  it("clearStoredChat (CloseMoreCopilot.reset on logout) forgets the tab's conversation", async () => {
    mocked.mockResolvedValue({ answer: "hello" });
    const first = renderHook(() => useChat());
    await act(async () => {
      await first.result.current.send("hi");
    });
    first.unmount();

    clearStoredChat();
    const second = renderHook(() => useChat());
    expect(second.result.current.messages).toEqual([]);
  });

  it("Clear conversation gives a new session id and forgets the messages", async () => {
    mocked.mockResolvedValue({ answer: "hello" });
    const first = renderHook(() => useChat());
    await act(async () => {
      await first.result.current.send("hi");
    });
    const before = mocked.mock.calls[0]?.[1];
    act(() => first.result.current.clear());
    first.unmount();

    const second = renderHook(() => useChat());
    expect(second.result.current.messages).toEqual([]);
    await act(async () => {
      await second.result.current.send("hi");
    });
    expect(mocked.mock.calls[1]?.[1]).not.toBe(before);
  });

  it("ignores damaged saved data", () => {
    window.sessionStorage.setItem("closemore-chat:current", "{not json");
    const { result } = renderHook(() => useChat());
    expect(result.current.messages).toEqual([]);
  });
});

describe("useChat: feedback and message details", () => {
  it("stamps messages with a time and keeps request_id / elapsed_ms (display only)", async () => {
    mocked.mockResolvedValueOnce({ answer: "a", request_id: "r1", elapsed_ms: 900 });
    mocked.mockResolvedValueOnce({ answer: "b" });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("one");
    });
    expect(typeof result.current.messages[0]?.createdAt).toBe("number");
    expect(result.current.messages[1]).toMatchObject({ request_id: "r1", elapsed_ms: 900 });
    await act(async () => {
      await result.current.send("two");
    });
    expect(mocked.mock.calls[1]?.length).toBe(2);
  });

  it("rate: updates at once, sends the session id, removes on 'none', reverts on failure, and survives a reload", async () => {
    mocked.mockResolvedValueOnce({ answer: "a", request_id: "r1" });
    vi.mocked(sendFeedback).mockReset().mockResolvedValue(undefined);
    const first = renderHook(() => useChat());
    await act(async () => {
      await first.result.current.send("one");
    });
    const id = first.result.current.messages[1]?.id ?? "";

    await act(async () => {
      await first.result.current.rate(id, "up");
    });
    expect(first.result.current.messages[1]?.rating).toBe("up");
    expect(vi.mocked(sendFeedback).mock.calls[0]?.[0]).toMatchObject({
      requestId: "r1",
      rating: "up",
      sessionId: mocked.mock.calls[0]?.[1],
    });

    first.unmount();
    const second = renderHook(() => useChat());
    expect(second.result.current.messages[1]?.rating).toBe("up");

    vi.mocked(sendFeedback).mockRejectedValueOnce(new Error("x"));
    let ok = true;
    await act(async () => {
      ok = await second.result.current.rate(id, "down");
    });
    expect(ok).toBe(false);
    expect(second.result.current.messages[1]?.rating).toBe("up"); // reverted

    await act(async () => {
      await second.result.current.rate(id, "none");
    });
    expect(second.result.current.messages[1]?.rating).toBeUndefined();
  });

  it("rate does nothing for an answer without a request_id", async () => {
    mocked.mockResolvedValueOnce({ answer: "a" });
    vi.mocked(sendFeedback).mockReset();
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("one");
    });
    let ok = true;
    await act(async () => {
      ok = await result.current.rate(result.current.messages[1]?.id ?? "", "up");
    });
    expect(ok).toBe(false);
    expect(sendFeedback).not.toHaveBeenCalled();
  });
});
