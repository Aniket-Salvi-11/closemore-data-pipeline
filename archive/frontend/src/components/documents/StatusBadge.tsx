import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeStatus = "uploading" | "processing" | "ready" | "failed";

const LABEL: Record<BadgeStatus, string> = {
  uploading: "Uploading",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

const STYLE: Record<BadgeStatus, string> = {
  uploading: "bg-muted text-muted-foreground",
  processing: "bg-(--brand-orange)/20 text-foreground",
  ready: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        STYLE[status],
      )}
    >
      {status === "processing" || status === "uploading" ? (
        <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      ) : null}
      {LABEL[status]}
    </span>
  );
}
