import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessageView, ErrorNotice, ThinkingIndicator } from "@/components/chat/ChatMessage";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { CleoLauncher } from "@/components/cleo/CleoLauncher";
import { CleoPanel, PoweredBy, useRoomyPanel } from "@/components/cleo/CleoPanel";
import { DemoGate } from "@/components/demo/DemoGate";
import { DemoHeaderControls } from "@/components/demo/DemoHeaderControls";
import { useChat } from "@/hooks/use-chat";
import { scrollToBottom, useNearBottom } from "@/hooks/use-near-bottom";
import { cn } from "@/lib/utils";

const DESCRIPTION = "Ask Cleo about your CRM data and uploaded documents.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cleo" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Cleo" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/**
 * The demo's first page: a plain, empty page with Cleo's button in the bottom-right corner.
 * Clicking it opens the chat panel; inside it, the user picker comes first (DEMO), then the chat.
 * Closing the panel goes back to the empty page. The chosen user and the conversation are kept for this
 * browser tab (sessionStorage), so opening the panel again continues where the user left off.
 */
function Index() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="min-h-screen bg-background">
      {open ? (
        <CleoPanel onClose={close}>
          {/* DEMO: shows the user picker first. key={user_id} gives each user a fresh chat and session id. */}
          <DemoGate>{(user) => <ChatScreen key={user.user_id} />}</DemoGate>
        </CleoPanel>
      ) : (
        <CleoLauncher onOpen={() => setOpen(true)} />
      )}
    </div>
  );
}

function ChatScreen() {
  const { messages, status, error, send, retry, clear, rate } = useChat();
  const isEmpty = messages.length === 0 && !error;
  // Wide / full screen on a desktop window: roomy layout. Small panel and phones: slim layout.
  const roomy = useRoomyPanel();

  // The messages scroll inside the panel, not the page.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { atBottom, atBottomRef } = useNearBottom(scrollRef);
  const [unseen, setUnseen] = useState(false);

  const scrollToLatest = useCallback(() => {
    scrollToBottom(scrollRef.current);
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
    // data-cleo-chat="slim": in the small panel (and on phones) the panel hides its own "Powered by" footer,
    // because it moves under the input box here, so the messages get that space.
    <div data-cleo-chat={roomy ? "roomy" : "slim"} className="flex min-h-0 flex-1 flex-col">
      {/* DEMO: who is active, what they can see, Documents, Switch user; and Clear conversation.
          Small panel: one slim line. Wide / full screen: the roomier layout, centred at a readable width. */}
      <div className={cn("shrink-0 border-b border-border", roomy ? "px-4 py-2.5" : "px-3 py-1.5")}>
        <div className="mx-auto w-full max-w-3xl">
          {roomy ? (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <DemoHeaderControls layout="panel" />
              </div>
              <ClearButton onClear={clear} disabled={isEmpty} withLabel />
            </div>
          ) : (
            <DemoHeaderControls
              layout="slim"
              actions={<ClearButton onClear={clear} disabled={isEmpty} />}
            />
          )}
        </div>
      </div>

      {/* Conversation area: scrolls inside the panel */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <img src="/cleo_body.png" alt="" aria-hidden="true" className="mb-4 h-40 w-auto" />
            <h1 className="font-display text-3xl leading-tight text-foreground">Hi, I'm Cleo</h1>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Ask me about your CRM data or your uploaded documents.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-5" aria-live="polite">
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
      <div
        className={cn(
          "relative shrink-0 border-t border-border px-3",
          roomy ? "pt-2.5 pb-2" : "pt-2 pb-1.5",
        )}
      >
        {/* Floats just above the input box and takes no space, so showing it never moves the bottom. */}
        {!isEmpty && !atBottom ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-full">
            <JumpToLatest unseen={unseen} onClick={scrollToLatest} />
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer disabled={status === "thinking"} onSubmit={send} />
          {roomy ? (
            // Wide / full screen: the keyboard hint always; "Powered by" is in the panel's own footer.
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          ) : (
            // Small panel: one line, the hint (only until the first message) and "Powered by CloseMore".
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              {isEmpty ? <span>Enter to send · Shift+Enter for a new line ·</span> : null}
              <PoweredBy />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Clear conversation": an icon in the slim line; icon + "Clear" in the roomy layout. */
function ClearButton({
  onClear,
  disabled,
  withLabel = false,
}: {
  onClear: () => void;
  disabled: boolean;
  withLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={disabled}
      aria-label="Clear conversation"
      title="Clear conversation"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        withLabel ? "gap-1 px-2 py-1.5 text-xs font-medium" : "size-8",
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={withLabel ? "size-3.5" : "size-4"}
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      {withLabel ? "Clear" : null}
    </button>
  );
}
