import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageView } from "@/components/chat/ChatMessage";
import { closeOpenBold, splitWords, useTypewriter } from "@/hooks/use-typewriter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TEXT = "Found **12 deals** in East.\n\n- one\n- two";

describe("typewriter helpers", () => {
  it("splits so any prefix joins back to the original", () => {
    const words = splitWords(TEXT);
    expect(words.join("")).toBe(TEXT);
  });

  it("closes half-typed bold", () => {
    expect(closeOpenBold("Found **12")).toBe("Found **12**");
    expect(closeOpenBold("Found **12 deals**")).toBe("Found **12 deals**");
  });
});

describe("useTypewriter", () => {
  it("reveals the text word by word within about 2 seconds, then calls onDone once", async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useTypewriter(TEXT, true, onDone));
    expect(result.current.done).toBe(false);
    expect(result.current.shown).toBe("");
    await act(async () => vi.advanceTimersByTimeAsync(60));
    expect(result.current.shown.length).toBeGreaterThan(0);
    expect(result.current.shown.length).toBeLessThan(TEXT.length);
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(result.current.done).toBe(true);
    expect(result.current.shown).toBe(TEXT);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("long answers still finish in about 2 seconds", async () => {
    const long = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const { result } = renderHook(() => useTypewriter(long, true));
    await act(async () => vi.advanceTimersByTimeAsync(2300));
    expect(result.current.done).toBe(true);
  });

  it("shows everything at once when not active (older or reloaded answers)", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useTypewriter(TEXT, false, onDone));
    expect(result.current.done).toBe(true);
    expect(result.current.shown).toBe(TEXT);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("types even when the system asks for less motion (always on, by choice)", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const { result } = renderHook(() => useTypewriter(TEXT, true));
    expect(result.current.done).toBe(false);
  });
});

describe("typing answer in the chat", () => {
  const message = {
    id: "a1",
    role: "assistant" as const,
    content: "Found 2 deals.",
    request_id: "r1",
    table: { columns: ["Deal"], rows: [["Alpha"]], truncated: false },
  };

  it("hides the table and actions until the typing is done; screen readers get the full text", async () => {
    render(<ChatMessageView message={message} typing />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(document.querySelector(".sr-only")?.textContent).toBe("Found 2 deals.");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("clicking the answer does not skip the typing", () => {
    render(
      <ChatMessageView message={{ ...message, content: "One two three four five six" }} typing />,
    );
    fireEvent.click(document.querySelector('[aria-busy="true"]') as Element);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("without typing (older answers), everything shows straight away", () => {
    render(<ChatMessageView message={message} />);
    expect(screen.getByText("Found 2 deals.")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
