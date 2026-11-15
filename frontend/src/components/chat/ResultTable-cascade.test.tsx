import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageView } from "@/components/chat/ChatMessage";
import { ResultTable } from "@/components/chat/ResultTable";

const table = {
  columns: ["Deal", "Value"],
  rows: Array.from({ length: 30 }, (_, i) => [`Deal ${i + 1}`, (i + 1) * 100]),
  truncated: false,
};

function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("table cascade", () => {
  it("rows of a new table cascade in, staggered for the first 12 rows only", () => {
    render(<ResultTable table={table} animate />);
    const rows = bodyRows();
    expect(rows[0]?.style.animationName || rows[0]?.style.animation).toContain("answer-fade-in");
    expect(rows[0]?.style.animationDelay).toBe("0ms");
    expect(rows[3]?.style.animationDelay).toBe("135ms");
    expect(rows[12]?.style.animationDelay).toBe("540ms");
    expect(rows[29]?.style.animationDelay).toBe("540ms"); // capped, big tables take no longer
  });

  it("plays once: after about a second the rows have no animation", async () => {
    render(<ResultTable table={table} animate />);
    await act(async () => vi.advanceTimersByTimeAsync(1300));
    expect(bodyRows()[0]?.style.animationDelay).toBe("");
  });

  it("sorting, searching or Show more right away stops the cascade (changes show instantly)", () => {
    render(<ResultTable table={table} animate />);
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(bodyRows()[0]?.style.animationDelay).toBe("");
  });

  it("no cascade without animate (older answers, fullscreen)", () => {
    render(<ResultTable table={table} />);
    expect(bodyRows()[0]?.style.animationDelay).toBe("");
  });

  it("in the chat: the table of a new answer cascades after the typing; an older answer doesn't", async () => {
    const message = { id: "m", role: "assistant" as const, content: "Found 30 deals.", table };
    const { unmount } = render(<ChatMessageView message={message} typing />);
    await act(async () => vi.advanceTimersByTimeAsync(800)); // typing finishes
    expect(bodyRows()[1]?.style.animationDelay).toBe("45ms");
    unmount();
    render(<ChatMessageView message={message} />);
    expect(bodyRows()[1]?.style.animationDelay).toBe("");
  });
});
