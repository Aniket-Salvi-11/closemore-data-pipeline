import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotPanel, type PanelSize } from "@/components/copilot/CopilotPanel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CLEO_FACE_URL } from "@/lib/assets";
import { getConfig } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";

const OPEN_KEY = "closemore-copilot-open";
const SIZE_KEY = "closemore-copilot-size";
const OLD_WIDE_KEY = "closemore-copilot-wide"; // earlier versions only had wide on/off
const GREETED_KEY = "closemore-copilot-greeted";

/** When the greeting bubble appears (once per browser tab, never on every page). */
export const GREETING_DELAY_MS = 1200;
export const GREETING_TEXT = "Hi, I'm Cleo. Ask me about your leads.";
/** Length of the closing animation (animate-cleo-panel-out in styles.css); the panel is removed after it. */
export const PANEL_CLOSE_MS = 180;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: it just won't be remembered across pages.
  }
}

function savedSize(): PanelSize {
  const value = read(SIZE_KEY);
  if (value === "wide" || value === "full" || value === "normal") return value;
  return read(OLD_WIDE_KEY) === "1" ? "wide" : "normal";
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
 * Desktop size and place of the panel (from 640px wide; on phones it always fills the screen).
 * normal 400 x 680 (never taller than the window), wide up to 720 px and 85% of the window height,
 * full = the whole window. All anchored to the same bottom corner, so changing size animates smoothly.
 */
const SIZE_CLASSES: Record<PanelSize, string> = {
  normal:
    "sm:h-[680px] sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:rounded-2xl sm:border sm:border-border",
  wide: "sm:h-[85dvh] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(720px,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-border",
  full: "sm:h-dvh sm:max-h-dvh sm:w-screen sm:rounded-none",
};

/**
 * Cleo on the website: her round face in a bottom corner (floating gently, "Ask Cleo" on hover) opens the
 * chat panel. A greeting bubble appears once per browser tab. Open/closed and the panel size are remembered
 * while the tab is open, so Cleo stays as she was when the user moves to another page of the website.
 * Animations follow the visitor's "reduce motion" setting.
 */
export function CopilotWidget({ onReady }: CopilotWidgetProps) {
  const left = getConfig().position === "left";
  const [open, setOpen] = useState(() => read(OPEN_KEY) === "1");
  const [closing, setClosing] = useState(false);
  const [size, setSize] = useState<PanelSize>(savedSize);
  const [greeting, setGreeting] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const focusLauncher = useRef(false);

  const openPanel = useCallback(() => {
    setGreeting(false);
    setClosing(false);
    setOpen(true);
    write(OPEN_KEY, "1");
  }, []);

  // Closing: play the shrink animation first, then remove the panel and show the button again.
  const close = useCallback(() => {
    write(OPEN_KEY, "0");
    setClosing(true);
  }, []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      focusLauncher.current = true;
    }, PANEL_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);
  useEffect(() => {
    if (!open && focusLauncher.current) {
      focusLauncher.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    onReady?.({
      open: openPanel,
      close,
      toggle: () => (read(OPEN_KEY) === "1" ? close() : openPanel()),
    });
  }, [onReady, openPanel, close]);

  // Greeting bubble: once per browser tab, a moment after the first page with Cleo loads.
  useEffect(() => {
    if (open || read(GREETED_KEY) === "1") return;
    const timer = window.setTimeout(() => {
      write(GREETED_KEY, "1");
      setGreeting(true);
    }, GREETING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const changeSize = (next: PanelSize) => {
    setSize(next);
    write(SIZE_KEY, next);
  };

  return (
    <TooltipProvider delayDuration={150}>
      {open ? (
        <section
          role="dialog"
          aria-label="Cleo"
          data-size={size}
          onKeyDown={(e) => {
            // Escape closes the panel, unless a pop-up inside it (e.g. a fullscreen table) handled it.
            if (e.key === "Escape" && !e.defaultPrevented) close();
          }}
          className={cn(
            "fixed z-10 flex flex-col overflow-hidden bg-background shadow-2xl",
            // Phones: full screen. Larger screens: anchored to the bottom corner, size from SIZE_CLASSES.
            "inset-0 sm:inset-auto",
            size === "full" ? "sm:bottom-0" : "sm:bottom-6",
            left
              ? cn(size === "full" ? "sm:left-0" : "sm:left-6", "origin-bottom-left")
              : cn(size === "full" ? "sm:right-0" : "sm:right-6", "origin-bottom-right"),
            "sm:motion-safe:transition-[width,height,max-height,right,left,bottom,border-radius] sm:motion-safe:duration-200 sm:motion-safe:ease-out",
            SIZE_CLASSES[size],
            closing ? "pointer-events-none animate-cleo-panel-out" : "animate-cleo-panel-in",
          )}
        >
          <CopilotPanel onClose={close} size={size} onChangeSize={changeSize} />
        </section>
      ) : (
        <div
          className={cn(
            "fixed bottom-6 z-10 flex animate-cleo-pop-in items-end gap-3",
            left ? "left-6 flex-row-reverse origin-bottom-left" : "right-6 origin-bottom-right",
          )}
        >
          {greeting ? (
            <div
              role="status"
              className={cn(
                "relative mb-2 flex max-w-60 animate-answer-in items-start gap-2 rounded-2xl border border-border bg-card py-2.5 pr-2 pl-3.5 text-sm leading-snug text-card-foreground shadow-lg",
                left ? "rounded-bl-md" : "rounded-br-md",
              )}
            >
              <button
                type="button"
                onClick={openPanel}
                className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {GREETING_TEXT}
              </button>
              <button
                type="button"
                onClick={() => setGreeting(false)}
                aria-label="Close greeting"
                className="-mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={launcherRef}
                type="button"
                aria-label="Ask Cleo"
                aria-expanded={false}
                onClick={openPanel}
                className="group size-14 shrink-0 animate-cleo-bob rounded-full focus-visible:outline-none"
              >
                <img
                  src={CLEO_FACE_URL}
                  alt=""
                  aria-hidden="true"
                  className="size-14 rounded-full object-cover shadow-lg ring-offset-2 transition-transform duration-200 ease-out group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-ring motion-reduce:transition-none"
                />
              </button>
            </TooltipTrigger>
            {/* Above the button, so it never covers the greeting bubble. */}
            <TooltipContent side="top" align="center" sideOffset={8}>
              Ask Cleo
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </TooltipProvider>
  );
}
