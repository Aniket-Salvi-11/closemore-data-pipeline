import { FileText } from "lucide-react";
import { useState } from "react";
import type { AnswerSource } from "@/lib/api-service";

/**
 * Small chips under a document-based answer: "Source 2 · Security policy · p. 7".
 * The number is the one the answer text cites. Clicking a chip shows the matching text.
 * The backend already limited these to documents the user may see; nothing is filtered here.
 */
export function SourceChips({ sources }: { sources: AnswerSource[] }) {
  const [openN, setOpenN] = useState<number | null>(null);
  if (sources.length === 0) return null;
  const open = sources.find((s) => s.n === openN) ?? null;

  return (
    <div className="mt-3 max-w-[68ch]">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sources</p>
      <ul className="flex flex-wrap gap-2">
        {sources.map((s) => {
          const label = `Source ${s.n} · ${s.document}${s.page ? ` · p. ${s.page}` : ""}`;
          const isOpen = s.n === openN;
          return (
            <li key={s.n}>
              <button
                type="button"
                aria-expanded={isOpen}
                disabled={!s.snippet}
                onClick={() => setOpenN(isOpen ? null : s.n)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors enabled:hover:bg-muted aria-expanded:bg-muted disabled:cursor-default"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open?.snippet ? (
        <blockquote className="mt-2 rounded-lg border-l-2 border-primary/50 bg-muted/50 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
          {open.snippet}
        </blockquote>
      ) : null}
    </div>
  );
}
