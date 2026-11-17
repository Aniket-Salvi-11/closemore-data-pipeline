import { Maximize2, Minimize2, MoveHorizontal, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageView, ErrorNotice, ThinkingIndicator } from "@/components/chat/ChatMessage";
import { IconAction } from "@/components/chat/IconAction";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { useChat } from "@/hooks/use-chat";
import { scrollToBottom, useNearBottom } from "@/hooks/use-near-bottom";
import { CLEO_BODY_URL, CLEO_FACE_URL, ICON_URL } from "@/lib/assets";

/** Desktop sizes of the panel. On phones the panel always fills the screen and the size button is hidden. */
export type PanelSize = "normal" | "wide" | "full";

const NEXT_SIZE: Record<PanelSize, PanelSize> = { normal: "wide", wide: "full", full: "normal" };
/** What the size button does next: its label and icon. */
const SIZE_BUTTON: Record<PanelSize, { label: string; Icon: typeof Maximize2 }> = {
  normal: { label: "Make wider", Icon: MoveHorizontal },
  wide: { label: "Full screen", Icon: Maximize2 },
  full: { label: "Back to normal size", Icon: Minimize2 },
};

interface CopilotPanelProps {
  onClose: () => void;
  /** normal / wide / full screen; the size button moves to the next one. */
  size: PanelSize;
  onChangeSize: (size: PanelSize) => void;
}

/** "Powered by [icon] CloseMore". The CloseMore icon with the two-colour name. */
function PoweredBy() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Powered by</span>
      <img src={ICON_URL} alt="" aria-hidden="true" className="size-4 rounded-full" />
      <span className="font-semibold tracking-tight">
        <span className="text-primary">Close</span>
        <span className="text-brand-orange">More</span>
      </span>
    </span>
  );
}

/**
 * The chat inside Cleo's panel on the website: header (Cleo, new chat, size, close), the scrolling
 * conversation, and the input box. Everything a user sees after clicking Cleo.
 */
export function CopilotPanel({ onClose, size, onChangeSize }: CopilotPanelProps) {
  const { label: sizeLabel, Icon: SizeIcon } = SIZE_BUTTON[size];
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

  // A conversation restored on another page of the website opens at the newest message (not scrolled up).
  // Tables and fonts finish their layout a moment later, so it is done again shortly after.
  useEffect(() => {
    const toBottom = () => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    };
    toBottom();
    const timers = [150, 500].map((ms) => window.setTimeout(toBottom, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={CLEO_FACE_URL} alt="" aria-hidden="true" className="size-8 rounded-full" />
          <h2 className="truncate text-[15px] font-semibold tracking-tight">Cleo</h2>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isEmpty ? null : (
            <IconAction label="New chat" onClick={clear}>
              <RotateCcw aria-hidden="true" />
            </IconAction>
          )}
          {/* Desktop only: on phones the panel always fills the screen. */}
          <IconAction
            label={sizeLabel}
            onClick={() => onChangeSize(NEXT_SIZE[size])}
            className="hidden sm:inline-flex"
          >
            <SizeIcon aria-hidden="true" />
          </IconAction>
          <IconAction label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </IconAction>
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Centred at a readable width when the panel is wide or full screen. */}
        <div className="mx-auto h-full w-full max-w-3xl px-4">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <img src={CLEO_BODY_URL} alt="" aria-hidden="true" className="mb-4 h-40 w-auto" />
              <p className="font-display text-3xl leading-tight text-foreground">Hi, I'm Cleo</p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                Ask me about your CRM data or your uploaded documents.
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

      <div className="relative shrink-0 border-t border-border px-3 pt-2.5 pb-1.5">
        {/* Floats just above the input box and takes no space, so showing it never moves anything. */}
        {!isEmpty && !atBottom ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-full">
            <JumpToLatest unseen={unseen} onClick={scrollToLatest} />
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer disabled={status === "thinking"} onSubmit={send} />
          {/* One small line: the keyboard hint (only until the first message) and "Powered by CloseMore". */}
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            {isEmpty ? <span>Enter to send · Shift+Enter for a new line ·</span> : null}
            <PoweredBy />
          </p>
        </div>
      </div>
    </div>
  );
}
