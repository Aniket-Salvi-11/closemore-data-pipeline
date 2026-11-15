import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnswerChoice } from "@/lib/api-service";
import { CASCADE_TOTAL_MS, cascadeStyle } from "@/lib/cascade";
import { narrowedFollowUp } from "@/lib/people";
import { cn } from "@/lib/utils";

interface ChoiceButtonsProps {
  choices: AnswerChoice[];
  /** False once a newer message exists, or while an answer is being generated. */
  active: boolean;
  /** Sends `value` as the next question; `display` is what the chat bubble shows. */
  onPick: (choice: { value: string; label: string }) => void;
  /** Letters selected in the key chips: follow-ups are narrowed to them ("Show deals of C"). */
  selected?: Set<string> | undefined;
  /** True for a brand-new answer: the rows cascade in once. */
  animate?: boolean;
}

/**
 * Buttons under an answer.
 * - "Which one?" with letters (kind "option"): one row per match. Click a row to pick it,
 *   or tick several and click "Show selected (n)", which sends the letters like "A, C".
 *   When several names were unclear, rows come under a heading per name ("Aman", "Neha Rao"),
 *   and Show selected needs at least one tick under every name.
 * - "All N" / "Both" (kind "all") and other follow-ups: normal buttons.
 * - Follow-ups with an action ("Show their deals") are narrowed to the letters selected in the key:
 *   the button then reads and sends e.g. "Show deals of C".
 * Typing a reply still works; nothing here blocks the input.
 */
export function ChoiceButtons({
  choices,
  active,
  onPick,
  selected,
  animate = false,
}: ChoiceButtonsProps) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  // Rows (and group headings) cascade in once for a new answer; ticking never animates.
  const [cascade, setCascade] = useState(animate);
  useEffect(() => {
    if (!cascade) return;
    const timer = setTimeout(() => setCascade(false), CASCADE_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [cascade]);
  if (choices.length === 0) return null;

  const people = choices.filter((c) => c.kind === "option");
  const rest = choices.filter((c) => c.kind !== "option");
  // Group headings, in the order received (only when there are 2 or more groups).
  const groups = [...new Set(people.map((p) => p.group).filter((g): g is string => Boolean(g)))];
  const grouped = groups.length >= 2;
  const missing = grouped
    ? groups.filter((g) => !people.some((p) => p.group === g && ticked.has(p.value)))
    : [];
  const showButton = ticked.size >= 2 || (grouped && ticked.size >= 1);
  const allChoice = choices.find((c) => c.kind === "all");

  const toggle = (value: string) => {
    setCascade(false);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const showSelected = () => {
    const picked = people.filter((p) => ticked.has(p.value)); // list order
    if (picked.length === 0) return;
    const display = picked.map((p) => p.label).join("\n");
    if (picked.length === people.length && allChoice) {
      onPick({ value: allChoice.value, label: display });
    } else if (picked.length === 1 && picked[0]) {
      onPick({ value: picked[0].value, label: picked[0].label });
    } else {
      onPick({ value: picked.map((p) => p.letter ?? p.value).join(", "), label: display });
    }
    setTicked(new Set());
  };

  return (
    <div className="mt-3 max-w-[68ch] space-y-2">
      {people.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {(grouped ? groups : [null]).map((group, groupIndex) => {
            const rowsInGroup = group === null ? people : people.filter((p) => p.group === group);
            // Position in the cascade: earlier groups' headings and rows come first.
            const before = (grouped ? groups.slice(0, groupIndex) : []).reduce(
              (n, g) => n + 1 + people.filter((p) => p.group === g).length,
              0,
            );
            const headingAt = before;
            const firstRowAt = before + (group !== null ? 1 : 0);
            return (
              <div key={group ?? "all"}>
                {group !== null ? (
                  <p
                    className="border-b border-border bg-muted/60 px-3 py-1 text-xs font-semibold text-muted-foreground"
                    style={cascade ? cascadeStyle(headingAt) : undefined}
                  >
                    {group}
                  </p>
                ) : null}
                <ul
                  className="divide-y divide-border border-b border-border last:border-b-0"
                  aria-label={group ?? "Options"}
                >
                  {rowsInGroup.map((p, rowIndex) => {
                    const letter = p.letter ?? p.value;
                    const checked = ticked.has(p.value);
                    return (
                      <li
                        key={p.value}
                        className="flex items-center gap-2 px-2 py-1"
                        style={cascade ? cascadeStyle(firstRowAt + rowIndex) : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!active}
                          onChange={() => toggle(p.value)}
                          aria-label={`Select ${p.label}`}
                          className="size-4 shrink-0 accent-[var(--primary)]"
                        />
                        <button
                          type="button"
                          disabled={!active}
                          onClick={() => onPick({ value: p.value, label: p.label })}
                          aria-label={p.label}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                        >
                          <span
                            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-1 rounded border border-border bg-muted text-[11px] font-semibold text-foreground"
                            aria-hidden="true"
                          >
                            {letter}
                          </span>
                          <span className="min-w-0 break-words">
                            {p.label.replace(/^[A-Z0-9]+\.\s*/, "")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
      {showButton && missing.length > 0 && active ? (
        <p className="text-xs text-muted-foreground" role="status">
          Also pick {missing.length === 1 ? "one" : "at least one each"} for: {missing.join(", ")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose one">
        {showButton ? (
          <Button
            type="button"
            size="sm"
            disabled={!active || missing.length > 0}
            onClick={showSelected}
          >
            Show selected ({ticked.size})
          </Button>
        ) : null}
        {rest.map((choice) => {
          const narrowed =
            choice.kind === "followup" && selected
              ? narrowedFollowUp(choice.action, selected)
              : null;
          const text = narrowed ?? choice.label;
          const value = narrowed ?? choice.value;
          return (
            <Button
              key={choice.value}
              type="button"
              variant="outline"
              size="sm"
              disabled={!active}
              aria-label={text}
              onClick={() => onPick({ value, label: text })}
              className={cn("h-auto whitespace-normal text-left")}
            >
              {text}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
