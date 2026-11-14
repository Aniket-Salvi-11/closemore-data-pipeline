import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessageView, ErrorNotice, ThinkingIndicator } from "@/components/chat/ChatMessage";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { DemoGate } from "@/components/demo/DemoGate";
import { DemoHeaderControls } from "@/components/demo/DemoHeaderControls";
import { SplashScreen } from "@/components/splash/SplashScreen";
import { useChat } from "@/hooks/use-chat";
import { scrollToPageBottom, useNearBottom } from "@/hooks/use-near-bottom";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "CloseMore AI Copilot",
      },
      {
        name: "description",
        content: "Ask questions about your CRM data and uploaded documents.",
      },
      { property: "og:title", content: "CloseMore AI Copilot" },
      {
        property: "og:description",
        content: "Ask questions about your CRM data and uploaded documents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      {/* Demo: always play the full animation, even if the system asks for reduced motion. */}
      <SplashScreen respectReducedMotion={false} />
      {/* DEMO: shows the user picker first. key={user_id} gives each user a fresh chat and session id. */}
      <DemoGate>{(user) => <ChatScreen key={user.user_id} />}</DemoGate>
    </>
  );
}

function ChatScreen() {
  const { messages, status, error, send, retry, clear, rate } = useChat();
  const isEmpty = messages.length === 0 && !error;

  const { atBottom, atBottomRef } = useNearBottom();
  const [unseen, setUnseen] = useState(false);

  const scrollToLatest = useCallback(() => {
    scrollToPageBottom();
    setUnseen(false);
  }, []);

  // Follow the conversation only when the user is already at the bottom, or has just sent a message.
  // If they scrolled up to read, don't pull them away: show "New answer" instead.
  // Depends on the count and the last role only, so rating an older answer never triggers it.
  // Answers already on screen when the chat opened (e.g. after a reload) never type out again.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));
  const lastRole = messages[messages.length - 1]?.role;
  // Whether to keep following a new answer once its typing finishes and the tables appear.
  const followRef = useRef(true);
  useEffect(() => {
    followRef.current = lastRole === "user" || atBottomRef.current;
    if (lastRole === "user" || atBottomRef.current) {
      scrollToLatest();
    } else if (lastRole === "assistant") {
      setUnseen(true);
    }
  }, [messages.length, lastRole, status, error, atBottomRef, scrollToLatest]);

  useEffect(() => {
    if (atBottom) setUnseen(false);
  }, [atBottom]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/closemore-icon.png" alt="CloseMore" className="size-8 rounded-full" />
            <span className="text-[15px] font-semibold tracking-tight">
              <span className="text-primary">Close</span>
              <span className="text-brand-orange">More</span>
              <span className="ml-1.5 font-normal text-muted-foreground">AI Copilot</span>
            </span>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={isEmpty}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Clear conversation
          </button>
        </div>
        {/* DEMO: who is active, what they can see, Documents button, Switch user */}
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
          <DemoHeaderControls />
        </div>
      </header>

      {/* Conversation area */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
        <div className="flex flex-1 flex-col">
          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <img src="/closemore-logo.png" alt="CloseMore" className="mb-6 h-28 w-auto sm:h-32" />
              <h1 className="font-display text-4xl leading-tight text-foreground sm:text-5xl">
                What can I help you with?
              </h1>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Ask about your CRM data or your uploaded documents.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 py-6" aria-live="polite">
              {messages.map((message, index) => (
                <ChatMessageView
                  key={message.id}
                  message={message}
                  // Buttons work only on the newest message, and only while no answer is being generated.
                  choicesActive={index === messages.length - 1 && status === "idle"}
                  onChoose={(choice) => void send(choice.value, choice.label)}
                  onRate={rate}
                  typing={
                    message.role === "assistant" &&
                    index === messages.length - 1 &&
                    !initialIds.has(message.id)
                  }
                  // Tables and buttons appear after the typing; keep following if the reader is at the bottom.
                  onTypingDone={() => {
                    if (followRef.current) scrollToLatest();
                  }}
                />
              ))}
              {status === "thinking" && <ThinkingIndicator />}
              {error && <ErrorNotice message={error.message} onRetry={retry} />}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 pb-4 pt-2">
          {/* Floats just above the input box and takes no space, so showing it never moves the bottom. */}
          {!isEmpty && !atBottom ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full">
              <JumpToLatest unseen={unseen} onClick={scrollToLatest} />
            </div>
          ) : null}
          <div className="bg-background/90 pb-2 pt-2 backdrop-blur">
            <ChatComposer disabled={status === "thinking"} onSubmit={send} />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
