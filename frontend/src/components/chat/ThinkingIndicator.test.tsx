import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingIndicator } from "@/components/chat/ChatMessage";
import { THINKING_STAGES, thinkingStage } from "@/lib/thinking-stages";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("thinking indicator", () => {
  it("changes the message every 10 seconds and stays on the last one", () => {
    expect(thinkingStage(0)).toBe(THINKING_STAGES[0]);
    expect(thinkingStage(9)).toBe(THINKING_STAGES[0]);
    expect(thinkingStage(10)).toBe(THINKING_STAGES[1]);
    expect(thinkingStage(25)).toBe(THINKING_STAGES[2]);
    expect(thinkingStage(55)).toBe(THINKING_STAGES[5]);
    expect(thinkingStage(300)).toBe(THINKING_STAGES[5]);
  });

  it("counts up every second and moves to the next message after 10 s", async () => {
    render(<ThinkingIndicator />);
    expect(screen.getByTestId("thinking-timer")).toHaveTextContent("0 s");
    expect(screen.getByText("Understanding your question…")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByTestId("thinking-timer")).toHaveTextContent("3 s");
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId("thinking-timer")).toHaveTextContent("11 s");
    expect(screen.getByText("Analyzing your data…")).toBeInTheDocument();
  });

  it("a new indicator (new question or Retry) starts from 0 s", async () => {
    const { unmount } = render(<ThinkingIndicator />);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    unmount();
    render(<ThinkingIndicator />);
    expect(screen.getByTestId("thinking-timer")).toHaveTextContent("0 s");
  });
});
