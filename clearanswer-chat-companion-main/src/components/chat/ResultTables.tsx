import type { PersonRef } from "@/lib/people";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ResultTable } from "@/components/chat/ResultTable";
import { useCopied } from "@/hooks/use-copied";
import type { TitledTable } from "@/lib/api-service";
import { titledTablesToText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

/**
 * Several titled tables under one answer ("everything about a person"), in the order sent.
 * Each section can be folded (all open at first). "Copy all" copies every table, all received rows,
 * as tab-separated text that pastes cleanly into Excel or Sheets. No charts here.
 */
export function ResultTables({
  tables,
  people,
  animate = false,
}: {
  tables: TitledTable[];
  people?: PersonRef[] | undefined;
  /** True for a brand-new answer: every table cascades in at the same moment. */
  animate?: boolean;
}) {
  const [closed, setClosed] = useState<Set<number>>(() => new Set());
  const { copied, copy } = useCopied();
  if (tables.length === 0) return null;

  const allClosed = closed.size === tables.length;
  const toggle = (index: number) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="mt-3 space-y-4">
      {tables.map((item, index) => {
        const isOpen = !closed.has(index);
        const heading = `${item.title || `Table ${index + 1}`} · ${item.table.rows.length}`;
        return (
          <section key={index} aria-label={item.title || `Table ${index + 1}`}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(index)}
              className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <ChevronDown
                className={cn("size-4 transition-transform", !isOpen && "-rotate-90")}
                aria-hidden="true"
              />
              {heading}
            </button>
            {/* Hidden, not removed, so a folded table keeps its sort and search. */}
            <div hidden={!isOpen}>
              <ResultTable
                table={item.table}
                title={item.title || `Table ${index + 1}`}
                people={people}
                animate={animate}
              />
            </div>
          </section>
        );
      })}
      <div className="flex gap-4 text-xs font-medium">
        <button
          type="button"
          onClick={() => void copy(titledTablesToText(tables))}
          className="text-primary underline-offset-2 hover:underline"
        >
          {copied ? "Copied ✓" : "Copy all"}
        </button>
        <button
          type="button"
          onClick={() => setClosed(allClosed ? new Set() : new Set(tables.map((_, i) => i)))}
          className="text-primary underline-offset-2 hover:underline"
        >
          {allClosed ? "Expand all" : "Collapse all"}
        </button>
      </div>
    </div>
  );
}
