import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageView } from "@/components/chat/ChatMessage";

describe("ChatMessageView scope caption", () => {
  it("shows 'Answered for' under an answer that has a scope", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "Hi",
          route: "SQL",
          scope: { label: "Deals in East" },
        }}
      />,
    );
    expect(screen.getByText("Answered for: Deals in East")).toBeInTheDocument();
  });

  it("shows nothing extra without a scope", () => {
    render(<ChatMessageView message={{ id: "1", role: "assistant", content: "Hi" }} />);
    expect(screen.queryByText(/Answered for/)).not.toBeInTheDocument();
  });

  it("shows a route badge only for known routes", () => {
    const { rerender } = render(
      <ChatMessageView message={{ id: "1", role: "assistant", content: "Hi", route: "rag" }} />,
    );
    expect(screen.getByText("From documents")).toBeInTheDocument();
    rerender(
      <ChatMessageView message={{ id: "1", role: "assistant", content: "Hi", route: "zzz" }} />,
    );
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });

  it("shows source chips under an answer that has sources", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "See Source 2.",
          route: "RAG",
          sources: [{ n: 2, document: "Security policy", page: 7, doc_id: null, snippet: null }],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Source 2 · Security policy/ })).toBeInTheDocument();
  });

  it("hides the scope line on document, chat and other non-data answers", () => {
    for (const route of ["RAG", "CHAT", "BLOCKED", "ERROR", undefined]) {
      const { unmount } = render(
        <ChatMessageView
          message={{
            id: "1",
            role: "assistant",
            content: "Hi",
            scope: { label: "X" },
            ...(route ? { route } : {}),
          }}
        />,
      );
      expect(screen.queryByText(/Answered for/)).not.toBeInTheDocument();
      unmount();
    }
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "Hi",
          route: "BOTH",
          scope: { label: "X" },
        }}
      />,
    );
    expect(screen.getByText("Answered for: X")).toBeInTheDocument();
  });

  it("shows choice buttons; clicking one reports it, and they can be disabled", () => {
    const choices = [
      { label: "1. Sales rep · Indore", value: "1" },
      { label: "Both", value: "all" },
    ];
    const onChoose = vi.fn();
    const { rerender } = render(
      <ChatMessageView
        message={{ id: "1", role: "assistant", content: "Which one?", choices }}
        onChoose={onChoose}
        choicesActive
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    expect(onChoose).toHaveBeenCalledWith({ label: "Both", value: "all" });

    rerender(
      <ChatMessageView
        message={{ id: "1", role: "assistant", content: "Which one?", choices }}
        onChoose={onChoose}
        choicesActive={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Both" })).toBeDisabled();
  });

  it("shows the label of a clicked choice in the user's bubble", () => {
    render(
      <ChatMessageView
        message={{ id: "u", role: "user", content: "1", display: "1. Sales rep · Indore" }}
      />,
    );
    expect(screen.getByText("1. Sales rep · Indore")).toBeInTheDocument();
  });

  it("shows several titled tables under the answer", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "Everything about Priya.",
          tables: [
            { title: "Profile", table: { columns: ["Name"], rows: [["Priya"]], truncated: false } },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Profile · 1" })).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });
});
