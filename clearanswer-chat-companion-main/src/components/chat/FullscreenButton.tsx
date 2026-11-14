import { Maximize2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { IconAction } from "@/components/chat/IconAction";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FullscreenButtonProps {
  /** Heading in the overlay, e.g. the chart title or "Table". */
  title: string;
  /** What to show big. Rendered only while the overlay is open. */
  children: ReactNode;
}

/** A small expand icon that opens a table or chart in a large overlay. Esc or ✕ closes it. */
export function FullscreenButton({ title, children }: FullscreenButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconAction label="Fullscreen" onClick={() => setOpen(true)}>
        <Maximize2 aria-hidden="true" />
      </IconAction>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-3 overflow-hidden p-4 sm:max-w-[95vw] sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 text-base">{title}</DialogTitle>
            <DialogDescription className="sr-only">
              Larger view. Press Escape to close.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">{open ? children : null}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
