import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerActions } from "@/components/chat/AnswerActions";
import { ChatMessageView } from "@/components/chat/ChatMessage";
import type { ChatMessage } from "@/hooks/use-chat";

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  role: "assistant",
  content: "Answer text",
  request_id: "abcd1234",
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AnswerActions: feedback", () => {
  it("has no 👍/👎 when the answer has no request_id", () => {
    render(<AnswerActions message={msg({ request_id: "" })} scopeText="" onRate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Helpful" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("👍 sends 'up'; clicking it again when active sends 'none'", async () => {
    const onRate = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<AnswerActions message={msg()} scopeText="" onRate={onRate} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Helpful" })));
    expect(onRate).toHaveBeenLastCalledWith("m1", "up", undefined);

    rerender(<AnswerActions message={msg({ rating: "up" })} scopeText="" onRate={onRate} />);
    expect(screen.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Helpful" })));
    expect(onRate).toHaveBeenLastCalledWith("m1", "none", undefined);
  });

  it("👎 asks 'What was wrong?'; Send repeats the rating with the comment, Skip just closes", async () => {
    const onRate = vi.fn().mockResolvedValue(true);
    render(<AnswerActions message={msg()} scopeText="" onRate={onRate} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not helpful" })));
    expect(onRate).toHaveBeenLastCalledWith("m1", "down", undefined);

    fireEvent.change(screen.getByLabelText("What was wrong?"), {
      target: { value: "Wrong region" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(onRate).toHaveBeenLastCalledWith("m1", "down", "Wrong region");
    expect(screen.queryByLabelText("What was wrong?")).not.toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not helpful" })));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByLabelText("What was wrong?")).not.toBeInTheDocument();
  });

  it("shows a quiet note and no comment box when saving fails", async () => {
    const onRate = vi.fn().mockResolvedValue(false);
    render(<AnswerActions message={msg()} scopeText="" onRate={onRate} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not helpful" })));
    expect(screen.getByText("Couldn't save your feedback")).toBeInTheDocument();
    expect(screen.queryByLabelText("What was wrong?")).not.toBeInTheDocument();
  });
});

describe("AnswerActions: copy, time, scope", () => {
  it("copies the answer plus its table, then shows Copied for 2 seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const message = msg({ table: { columns: ["A"], rows: [["x"]], truncated: false } });
    render(<AnswerActions message={message} scopeText="" onRate={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("Answer text\n\n#\tA\n1\tx");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("shows the time, how long it took, and the scope line in one row", () => {
    const at = new Date(2026, 10, 8, 13, 42).getTime();
    render(
      <AnswerActions
        message={msg({ createdAt: at, elapsed_ms: 12000 })}
        scopeText="Answered for: Deals in East"
        onRate={vi.fn()}
      />,
    );
    expect(screen.getByText("13:42 · answered in 12 s")).toBeInTheDocument();
    expect(screen.getByText("Answered for: Deals in East")).toBeInTheDocument();
  });
});

describe("question bubble", () => {
  it("shows the time and a copy-question button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const at = new Date(2026, 10, 8, 9, 5).getTime();
    render(
      <ChatMessageView
        message={{ id: "u", role: "user", content: "deals by owner", createdAt: at }}
      />,
    );
    expect(screen.getByText("09:05")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy question" })));
    expect(writeText).toHaveBeenCalledWith("deals by owner");
  });
});
