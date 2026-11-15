import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  /** True while the backend is answering — disables submission. */
  disabled: boolean;
  onSubmit: (question: string) => void;
}

const MAX_HEIGHT_PX = 160;

/**
 * The question input. Enter submits, Shift+Enter adds a newline,
 * and the send button is disabled for empty or whitespace-only questions.
 */
export function ChatComposer({ disabled, onSubmit }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !disabled;

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit(trimmed);
    setValue("");
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.style.height = "0px";
    });
  }, [canSubmit, onSubmit, trimmed]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring"
    >
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder="Ask about deals or documents…"
          aria-label="Your question"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setValue(event.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Send question"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl transition-all",
            canSubmit
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-not-allowed bg-muted text-muted-foreground/50",
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
            className="size-5"
            aria-hidden="true"
          >
            <path d="m5 12 14 0" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
