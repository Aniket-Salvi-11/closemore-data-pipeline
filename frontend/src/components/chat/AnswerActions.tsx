import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { IconAction } from "@/components/chat/IconAction";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/hooks/use-chat";
import { useCopied } from "@/hooks/use-copied";
import { answerToText } from "@/lib/copy-text";
import { formatElapsed, formatTime } from "@/lib/format-message-meta";

interface AnswerActionsProps {
  message: ChatMessage;
  /** The scope line ("Answered for: ..."), already decided by the caller; empty for none. */
  scopeText: string;
  onRate?:
    | ((id: string, rating: "up" | "down" | "none", comment?: string) => Promise<boolean>)
    | undefined;
}

/**
 * The small row under an answer: 👍 👎 copy, the time, how long it took, and whose data it covers.
 * 👍/👎 appear only when the answer has a request_id.
 */
export function AnswerActions({ message, scopeText, onRate }: AnswerActionsProps) {
  const { copied, copy } = useCopied();
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [failed, setFailed] = useState(false);

  // The "Couldn't save" note is quiet and goes away on its own.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(false), 4000);
    return () => clearTimeout(t);
  }, [failed]);

  const canRate = Boolean(message.request_id && onRate);

  const rate = async (rating: "up" | "down" | "none", comment?: string) => {
    if (!onRate) return false;
    setFailed(false);
    const ok = await onRate(message.id, rating, comment);
    if (!ok) {
      setFailed(true);
      setAsking(false);
    }
    return ok;
  };

  const onUp = async () => {
    setAsking(false);
    await rate(message.rating === "up" ? "none" : "up");
  };

  const onDown = async () => {
    if (message.rating === "down") {
      setAsking(false);
      await rate("none");
      return;
    }
    const ok = await rate("down");
    if (ok) setAsking(true);
  };

  const sendWhy = async () => {
    const text = why.trim();
    if (text) await rate("down", text);
    setAsking(false);
    setWhy("");
  };

  const meta = [formatTime(message.createdAt), formatElapsed(message.elapsed_ms)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {canRate ? (
          <>
            <IconAction
              label="Helpful"
              pressed={message.rating === "up"}
              activeClassName="text-primary [&_svg]:fill-current"
              onClick={() => void onUp()}
            >
              <ThumbsUp aria-hidden="true" />
            </IconAction>
            <IconAction
              label="Not helpful"
              pressed={message.rating === "down"}
              activeClassName="text-brand-orange [&_svg]:fill-current"
              onClick={() => void onDown()}
            >
              <ThumbsDown aria-hidden="true" />
            </IconAction>
          </>
        ) : null}
        <IconAction
          label={copied ? "Copied" : "Copy"}
          highlighted={copied}
          onClick={() => void copy(answerToText(message))}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconAction>
        {meta ? <span className="ml-2 text-xs text-muted-foreground">{meta}</span> : null}
        {scopeText ? <span className="ml-2 text-xs text-muted-foreground">{scopeText}</span> : null}
        {failed ? (
          <span role="status" className="ml-2 text-xs text-muted-foreground">
            Couldn't save your feedback
          </span>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-2 flex max-w-[68ch] flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={why}
            maxLength={1000}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendWhy();
            }}
            placeholder="What was wrong?"
            aria-label="What was wrong?"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void sendWhy()} disabled={!why.trim()}>
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(false);
                setWhy("");
              }}
            >
              Skip
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
