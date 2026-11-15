import { Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageView, ErrorNotice, ThinkingIndicator } from "@/components/chat/ChatMessage";
import { IconAction } from "@/components/chat/IconAction";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { useChat } from "@/hooks/use-chat";
import { scrollToBottom, useNearBottom } from "@/hooks/use-near-bottom";
import { ICON_URL, LOGO_URL } from "@/lib/assets";

interface CopilotPanelProps {
  onClose: () => void;
  /** Wide mode: more room for tables and charts. */
  wide: boolean;
  onToggleWide: () => void;
}

/**
 * The chat inside the website's pop-up panel: header (new chat, wider, close), the scrolling
 * conversation, and the input box. Everything a user sees after clicking the Copilot icon.
 */
export function CopilotPanel({ onClose, wide, onToggleWide }: CopilotPanelProps) {
  const { messages, status, error, send, retry, clear, rate } = useChat();
  const isEmpty = messages.length === 0 && !error;

  const listRef = useRef<HTMLDivElement>(null);
  const { atBottom, atBottomRef } = useNearBottom(listRef);
  const [unseen, setUnseen] = useState(false);

  const scrollToLatest = useCallback(() => {
    scrollToBottom(listRef.current);
    setUnseen(false);
  }, []);

  // Follow the conversation only when the reader is already at the bottom, or has just sent a message.
  // If they scrolled up to read, don't pull them away: show "New answer" instead.
  // Answers already on screen when the panel opened never type out again.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));
  const lastRole = messages[messages.length - 1]?.role;
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

  // Opening the panel puts the cursor in the input box.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.querySelector("textarea")?.focus();
  }, []);

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={ICON_URL} alt="" aria-hidden="true" className="size-7 rounded-full" />
          <h2 className="truncate text-[15px] font-semibold tracking-tight">
            <span className="text-primary">Close</span>
            <span className="text-brand-orange">More</span>
            <span className="ml-1.5 font-normal text-muted-foreground">AI Copilot</span>
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isEmpty ? null : (
            <IconAction label="New chat" onClick={clear}>
              <RotateCcw aria-hidden="true" />
            </IconAction>
          )}
          <IconAction
            label={wide ? "Make narrower" : "Make wider"}
            onClick={onToggleWide}
            className="hidden sm:inline-flex"
          >
            {wide ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </IconAction>
          <IconAction label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </IconAction>
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <img src={LOGO_URL} alt="CloseMore" className="mb-5 h-20 w-auto" />
              <p className="text-2xl font-semibold leading-tight text-foreground">
                What can I help you with?
              </p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                Ask about your CRM data or your uploaded documents.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 py-5" aria-live="polite">
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
      </div>

      <div className="relative shrink-0 border-t border-border px-4 pb-3 pt-3">
        {/* Floats just above the input box and takes no space, so showing it never moves anything. */}
        {!isEmpty && !atBottom ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-full">
            <JumpToLatest unseen={unseen} onClick={scrollToLatest} />
          </div>
        ) : null}
        <ChatComposer disabled={status === "thinking"} onSubmit={send} />
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
