import { kindOf, type PersonKind, type PersonRef } from "@/lib/people";
import { useState } from "react";
import { cn } from "@/lib/utils";

const KIND_HEADING: Record<PersonKind, string> = {
  user: "People",
  contact: "Contacts",
  deal: "Deals",
  product: "Products",
};

interface Selection {
  /** Selected letters. With `onToggle`, chips become toggle buttons. */
  selected?: Set<string> | undefined;
  onToggle?: ((letter: string) => void) | undefined;
}

/**
 * The key for an answer about several people (or deals, contacts, products):
 * one chip per letter, "A Aman Kapoor · Sales rep · Indore". With more than one kind
 * (e.g. 2 people and 2 deals), each kind gets its own small heading.
 * `more`: people from the "which one?" list who are not in this answer. They sit behind a
 * "+N more" chip (collapsed at first) and show faded; they can be selected like the others.
 */
export function PeopleChips({
  people,
  more = [],
  selected,
  onToggle,
}: { people: PersonRef[]; more?: PersonRef[] | undefined } & Selection) {
  const [showMore, setShowMore] = useState(false);
  if (people.length === 0 && more.length === 0) return null;
  const kinds = [...new Set(people.map(kindOf))];

  const moreRow =
    more.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
          className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showMore ? "Show less" : `+${more.length} more`}
        </button>
        {showMore ? (
          <ChipList
            people={more}
            label="Also in the list"
            selected={selected}
            onToggle={onToggle}
            faded
          />
        ) : null}
      </div>
    ) : null;

  return (
    <div className="mt-3 space-y-1.5">
      {kinds.length > 1 ? (
        kinds.map((kind) => (
          <div key={kind} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{KIND_HEADING[kind]}:</span>
            <ChipList
              people={people.filter((p) => kindOf(p) === kind)}
              label={KIND_HEADING[kind]}
              selected={selected}
              onToggle={onToggle}
            />
          </div>
        ))
      ) : people.length > 0 ? (
        <ChipList
          people={people}
          label="People in this answer"
          selected={selected}
          onToggle={onToggle}
        />
      ) : null}
      {moreRow}
      {onToggle ? (
        <p className="text-xs text-muted-foreground">
          Tip: select people to narrow the buttons below.
        </p>
      ) : null}
    </div>
  );
}

function ChipList({
  people,
  label,
  selected,
  onToggle,
  faded = false,
}: { people: PersonRef[]; label: string; faded?: boolean } & Selection) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {people.map((p) => {
        const body = (
          <>
            <PersonBadge letter={p.letter} />
            <span>
              <span className="font-medium">{p.name}</span>
              {p.label ? <span className="text-muted-foreground"> · {p.label}</span> : null}
            </span>
          </>
        );
        const chip =
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2.5 text-xs";
        if (!onToggle) {
          return (
            <li key={p.letter} className={cn(chip, faded && "opacity-60")}>
              {body}
            </li>
          );
        }
        const on = selected?.has(p.letter) ?? false;
        return (
          <li key={p.letter}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(p.letter)}
              className={cn(
                chip,
                "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                faded && !on && "opacity-60 hover:opacity-100",
                on && "border-primary bg-primary/10 text-primary",
              )}
            >
              {body}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The letter badge, used in the chips and in the table's letter columns.
 * One neutral colour for every letter: the letter itself tells people apart.
 */
export function PersonBadge({ letter, title }: { letter: string; title?: string | undefined }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-1 rounded-full border border-border bg-muted text-[11px] font-semibold text-foreground"
      title={title}
    >
      {letter}
    </span>
  );
}
