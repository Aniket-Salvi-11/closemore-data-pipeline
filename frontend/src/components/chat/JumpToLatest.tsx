import { ArrowDown } from "lucide-react";

interface JumpToLatestProps {
  /** True when an answer arrived while the user was reading higher up. */
  unseen: boolean;
  onClick: () => void;
}

/** Floating button above the input: brings the newest message into view. */
export function JumpToLatest({ unseen, onClick }: JumpToLatestProps) {
  const label = unseen ? "New answer" : "Jump to latest";
  return (
    <div className="pointer-events-none flex justify-center pb-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="pointer-events-auto inline-flex animate-answer-in items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[unseen=true]:border-primary/40 data-[unseen=true]:text-primary"
        data-unseen={unseen}
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
