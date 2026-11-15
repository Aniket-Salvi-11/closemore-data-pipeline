import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ICON_URL } from "@/lib/assets";
import { cn } from "@/lib/utils";

const OPEN_KEY = "closemore-copilot-open";
const WIDE_KEY = "closemore-copilot-wide";

function readFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.sessionStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage blocked: it just won't be remembered across pages.
  }
}

export interface CopilotControls {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

interface CopilotWidgetProps {
  /** Lets the page script (window.CloseMoreCopilot) open and close the panel. */
  onReady?: (controls: CopilotControls) => void;
}

/**
 * The Copilot on the website: a round CloseMore icon in the bottom-right corner that opens and
 * closes the chat panel. Open/closed and wide/narrow are remembered while the browser tab is open,
 * so the panel stays open when the user moves to another page of the website.
 */
export function CopilotWidget({ onReady }: CopilotWidgetProps) {
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY));
  const [wide, setWide] = useState(() => readFlag(WIDE_KEY));
  const launcherRef = useRef<HTMLButtonElement>(null);

  const setOpenAndRemember = useCallback((value: boolean) => {
    setOpen(value);
    writeFlag(OPEN_KEY, value);
  }, []);

  const close = useCallback(() => {
    setOpenAndRemember(false);
    launcherRef.current?.focus();
  }, [setOpenAndRemember]);

  useEffect(() => {
    onReady?.({
      open: () => setOpenAndRemember(true),
      close,
      toggle: () =>
        setOpen((v) => {
          writeFlag(OPEN_KEY, !v);
          return !v;
        }),
    });
  }, [onReady, setOpenAndRemember, close]);

  return (
    <TooltipProvider delayDuration={300}>
      {open ? (
        <section
          role="dialog"
          aria-label="CloseMore AI Copilot"
          onKeyDown={(e) => {
            // Escape closes the panel, unless a pop-up inside it (e.g. fullscreen table) handled it.
            if (e.key === "Escape" && !e.defaultPrevented) close();
          }}
          className={cn(
            "fixed z-10 flex flex-col overflow-hidden bg-background shadow-2xl",
            // Phones: full screen. Larger screens: a panel above the icon.
            "inset-0 sm:inset-auto sm:bottom-24 sm:right-5 sm:rounded-2xl sm:border sm:border-border",
            "sm:h-[min(720px,calc(100vh-7.5rem))]",
            wide ? "sm:w-[min(960px,calc(100vw-2.5rem))]" : "sm:w-[440px]",
          )}
          style={{ animation: "answer-fade-in 0.2s ease-out both" }}
        >
          <CopilotPanel
            onClose={close}
            wide={wide}
            onToggleWide={() =>
              setWide((v) => {
                writeFlag(WIDE_KEY, !v);
                return !v;
              })
            }
          />
        </section>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        aria-label={open ? "Close AI Copilot" : "Open AI Copilot"}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpenAndRemember(true))}
        className={cn(
          "fixed bottom-5 right-5 z-10 flex size-14 items-center justify-center rounded-full border border-border bg-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // On phones the open panel covers the screen and has its own close button.
          open && "hidden sm:flex",
        )}
      >
        {open ? (
          <X className="size-6 text-foreground" aria-hidden="true" />
        ) : (
          <img src={ICON_URL} alt="" aria-hidden="true" className="size-10 rounded-full" />
        )}
      </button>
    </TooltipProvider>
  );
}
