import { useEffect, useState } from "react";
import { useTypewriter } from "@/hooks/use-typewriter";
import { thinkingStage } from "@/lib/thinking-stages";
import type { AnswerChoice } from "@/lib/api-service";
import type { ChatMessage } from "@/hooks/use-chat";
import { AnswerActions } from "@/components/chat/AnswerActions";
import { AnswerText } from "@/components/chat/AnswerText";
import { ChoiceButtons } from "@/components/chat/ChoiceButtons";
import { PeopleChips } from "@/components/chat/PeopleChips";
import { ResultTables } from "@/components/chat/ResultTables";
import { SourceChips } from "@/components/chat/SourceChips";
import { ResultView } from "@/components/chat/ResultView";
import { IconAction } from "@/components/chat/IconAction";
import { useCopied } from "@/hooks/use-copied";
import { formatTime } from "@/lib/format-message-meta";
import { Check, Copy } from "lucide-react";
import { routeBadge } from "@/lib/route-badge";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: ChatMessage;
  /** Called when a "which one?" button is clicked. */
  onChoose?: ((choice: { value: string; label: string }) => void) | undefined;
  /** True only for the newest message while nothing is being generated; otherwise buttons are disabled. */
  choicesActive?: boolean;
  /** True for an answer that just arrived: its text types out word by word, then the rest appears. */
  typing?: boolean;
  /** Called once the typing has finished. */
  onTypingDone?: (() => void) | undefined;
  /** Called for 👍/👎. Resolves to false when saving failed. */
  onRate?:
    | ((id: string, rating: "up" | "down" | "none", comment?: string) => Promise<boolean>)
    | undefined;
}

/** The "Answered for" line only makes sense for answers from the CRM data. */
function showsScope(route: string | undefined): boolean {
  const r = route?.trim().toUpperCase();
  return r === "SQL" || r === "BOTH";
}

/**
 * Renders one exchange participant: the user's question as a right-aligned
 * bubble, the assistant's answer as plain, readable text on the left.
 */
export function ChatMessageView({
  message,
  onChoose,
  choicesActive = false,
  onRate,
  typing = false,
  onTypingDone,
}: ChatMessageProps) {
  if (message.role === "user") return <UserMessage message={message} />;
  return (
    <AssistantMessage
      message={message}
      onChoose={onChoose}
      choicesActive={choicesActive}
      onRate={onRate}
      typing={typing}
      onTypingDone={onTypingDone}
    />
  );
}

function AssistantMessage({
  message,
  onChoose,
  choicesActive = false,
  onRate,
  typing = false,
  onTypingDone,
}: ChatMessageProps) {
  // The text the user reads first. With a short choice prompt, show it instead of the full list
  // (the buttons list the people). The stored text stays the full answer (it goes back as history).
  const text = message.choice_prompt && message.choices ? message.choice_prompt : message.content;
  const { shown, done } = useTypewriter(text, typing, onTypingDone);

  // Letters selected in the key chips narrow the follow-up buttons ("Show deals of C").
  // Only on the newest answer; cleared as soon as a newer message arrives.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const canSelect =
    choicesActive &&
    Boolean(onChoose) &&
    (message.people?.length ?? 0) + (message.people_more?.length ?? 0) > 1 &&
    (message.choices ?? []).some((c) => c.kind === "followup" && c.action);
  useEffect(() => {
    if (!choicesActive) setSelected(new Set());
  }, [choicesActive]);
  const toggle = (letter: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(letter)) next.delete(letter);
      else next.add(letter);
      return next;
    });

  const badge = routeBadge(message.route);
  return (
    <div className="flex animate-answer-in items-start gap-3">
      <img
        src="/closemore-icon.png"
        alt=""
        aria-hidden="true"
        className="mt-0.5 size-7 shrink-0 rounded-full border border-border bg-white"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        {badge ? (
          <span className="mb-1.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {badge}
          </span>
        ) : null}
        {done ? (
          <AnswerText text={text} />
        ) : (
          // While typing, screen readers get the full text straight away.
          <div aria-busy="true">
            <span className="sr-only">{text}</span>
            <div aria-hidden="true">
              <AnswerText text={shown} />
            </div>
          </div>
        )}
        {done ? (
          <div className="animate-answer-in">
            <AnswerExtras
              animateTables={typing}
              message={message}
              onChoose={onChoose}
              choicesActive={choicesActive}
              onRate={onRate}
              canSelect={canSelect}
              selected={selected}
              setSelected={setSelected}
              toggle={toggle}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ExtrasProps extends ChatMessageProps {
  /** True for a brand-new answer: tables cascade in once. */
  animateTables: boolean;
  canSelect: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  toggle: (letter: string) => void;
}

/** Everything under the answer text: key chips, tables/charts, sources, buttons, action row. */
function AnswerExtras({
  message,
  onChoose,
  choicesActive = false,
  onRate,
  canSelect,
  selected,
  setSelected,
  toggle,
  animateTables,
}: ExtrasProps) {
  return (
    <>
      {message.people ? (
        <PeopleChips
          people={message.people}
          more={message.people_more}
          selected={canSelect ? selected : undefined}
          onToggle={canSelect ? toggle : undefined}
        />
      ) : null}
      <ResultView
        table={message.table}
        chart={message.chart}
        people={message.people}
        animate={animateTables}
      />
      {message.tables ? (
        <ResultTables tables={message.tables} people={message.people} animate={animateTables} />
      ) : null}
      {message.sources ? <SourceChips sources={message.sources} /> : null}
      {message.choices && onChoose ? (
        <ChoiceButtons
          choices={message.choices}
          active={choicesActive}
          onPick={(choice) => {
            setSelected(new Set());
            onChoose(choice);
          }}
          selected={canSelect ? selected : undefined}
        />
      ) : null}
      <AnswerActions
        message={message}
        scopeText={
          message.scope && showsScope(message.route) ? `Answered for: ${message.scope.label}` : ""
        }
        onRate={onRate}
      />
    </>
  );
}

/** The user's question: a right-aligned bubble, a copy icon on hover, and the time under it. */
function UserMessage({ message }: { message: ChatMessage }) {
  const { copied, copy } = useCopied();
  const time = formatTime(message.createdAt);
  return (
    <div className="group flex flex-col items-end">
      <div className="flex max-w-[85%] items-center gap-1 sm:max-w-[75%]">
        <IconAction
          label={copied ? "Copied" : "Copy question"}
          highlighted={copied}
          onClick={() => void copy(message.content)}
          className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconAction>
        <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-[15px] leading-relaxed text-primary-foreground">
          <p className="whitespace-pre-wrap">{message.display ?? message.content}</p>
        </div>
      </div>
      {time ? <span className="mt-1 text-xs text-muted-foreground">{time}</span> : null}
    </div>
  );
}

/** Three pulsing dots shown while the backend is generating the answer. */
/** Seconds since this component appeared, ticking every second. */
function useElapsedSeconds(): number {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return seconds;
}

/**
 * Pulsing dots, a message that changes every 10 s, and a timer counting up while the backend works.
 * A new indicator (new question or Retry) starts again from 0 s.
 */
export function ThinkingIndicator() {
  const seconds = useElapsedSeconds();
  const stage = thinkingStage(seconds);
  return (
    <div className="flex items-start gap-3" aria-label="Generating answer">
      <img
        src="/closemore-icon.png"
        alt=""
        aria-hidden="true"
        className="mt-0.5 size-7 shrink-0 rounded-full border border-border bg-white"
      />
      <div className="flex items-center gap-1.5 pt-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 animate-think rounded-full bg-muted-foreground/50"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
      <span className="pt-1 text-sm text-muted-foreground">
        {/* Only the message is announced (every 10 s), not every tick of the timer. */}
        <span key={stage} className="animate-answer-in" aria-live="polite">
          {stage}
        </span>{" "}
        <span className="tabular-nums" aria-hidden="true" data-testid="thinking-timer">
          {seconds} s
        </span>
      </span>
    </div>
  );
}

interface ErrorNoticeProps {
  message: string;
  onRetry: () => void;
}

/** Inline, non-blocking error card with a retry action. */
export function ErrorNotice({ message, onRetry }: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3",
        "sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <p className="text-sm leading-relaxed text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="self-start rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 sm:self-auto"
      >
        Retry
      </button>
    </div>
  );
}
