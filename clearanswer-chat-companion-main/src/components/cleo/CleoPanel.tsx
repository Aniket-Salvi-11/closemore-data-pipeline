import { Maximize2, Minimize2, MoveHorizontal, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface CleoPanelProps {
  /** Closes the panel; the page goes back to just the Cleo button. */
  onClose: () => void;
  children: ReactNode;
}

/** The three desktop sizes. On phones the panel is always full screen and the size button is hidden. */
export type PanelSize = "normal" | "wide" | "full";

export const PANEL_SIZE_KEY = "cleo-panel-size";
/** Length of the closing animation (animate-cleo-panel-out in styles.css); the panel is removed after it. */
export const PANEL_CLOSE_MS = 180;
const NEXT_SIZE: Record<PanelSize, PanelSize> = { normal: "wide", wide: "full", full: "normal" };

const PanelSizeContext = createContext<PanelSize>("normal");

/**
 * True when the chat should use its roomy layout: the panel is wide or full screen on a desktop-sized
 * window. False for the small panel and on phones (narrow), where the chat uses its slim layout.
 */
export function useRoomyPanel(): boolean {
  const size = useContext(PanelSizeContext);
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop && size !== "normal";
}

/** What the size button does next: its label and icon. */
const SIZE_BUTTON: Record<PanelSize, { label: string; Icon: typeof Maximize2 }> = {
  normal: { label: "Make wider", Icon: MoveHorizontal },
  wide: { label: "Full screen", Icon: Maximize2 },
  full: { label: "Back to normal size", Icon: Minimize2 },
};

/**
 * Desktop size and position of each size (from 640px wide; below that the panel always fills the screen).
 * - normal: 400 x 680 px, never taller than the window minus 24 px margins.
 * - wide:   up to 720 px wide (never wider than the window minus 24 px margins), 85% of the window height.
 * - full:   the whole browser window.
 * All three are anchored to the bottom-right corner with a width and a height, so changing size animates
 * smoothly (SIZE_ANIMATION), including to and from full screen.
 */
const SIZE_CLASSES: Record<PanelSize, string> = {
  normal:
    "sm:right-6 sm:bottom-6 sm:h-[680px] sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl",
  wide: "sm:right-6 sm:bottom-6 sm:h-[85dvh] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(720px,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl",
  full: "sm:right-0 sm:bottom-0 sm:h-dvh sm:max-h-dvh sm:w-screen sm:rounded-none",
};

/** Desktop only: a 200 ms glide between sizes. Runs even when the system asks for less motion (demo choice). */
const SIZE_ANIMATION =
  "sm:inset-auto sm:transition-[width,height,max-height,right,bottom,border-radius] sm:duration-200 sm:ease-out";

/** The size chosen last in this browser tab (sessionStorage); "normal" when nothing is saved. */
function savedSize(): PanelSize {
  try {
    const value = window.sessionStorage.getItem(PANEL_SIZE_KEY);
    return value === "wide" || value === "full" ? value : "normal";
  } catch {
    return "normal"; // storage blocked: just start at the normal size
  }
}

/**
 * Cleo's chat panel, anchored bottom-right. Desktop: normal (400 x 680), wide or full screen, switched with
 * the size button in the header and remembered for this browser tab. Phones: always full screen.
 * Header: Cleo's face and name, the size button and a close button (Esc closes too).
 * Footer: "Powered by CloseMore". The content (user picker, then the chat) fills the middle.
 * Stays below pop-ups (z-40), so the user picker's dropdown, the Documents sheet and fullscreen tables
 * always open on top of it.
 */
export function CleoPanel({ onClose, children }: CleoPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<PanelSize>(savedSize);

  // Closing: play the shrink-into-the-corner animation first, then remove the panel.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, PANEL_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  const changeSize = () => {
    const next = NEXT_SIZE[size];
    setSize(next);
    try {
      window.sessionStorage.setItem(PANEL_SIZE_KEY, next);
    } catch {
      // storage blocked: the size just isn't remembered
    }
  };

  // Move focus into the panel when it opens, so keyboard and screen-reader users land in it.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Esc closes the panel, but not while a pop-up is open (the user picker's dropdown, the Documents sheet,
  // a fullscreen table): there, Esc closes only that pop-up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const popupOpen = document.querySelector(
        '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      );
      if (popupOpen) return;
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const { label: sizeLabel, Icon: SizeIcon } = SIZE_BUTTON[size];
  const iconButton =
    "rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Cleo chat"
      data-size={size}
      // Not "data-state": the Esc check above treats any open dialog with data-state="open" as a pop-up.
      data-cleo-state={closing ? "closing" : "open"}
      className={cn(
        "fixed inset-0 z-40 flex flex-col overflow-hidden bg-background focus:outline-none",
        // while the slim chat is shown, its own line under the input box says "Powered by": hide the footer
        "[&:has([data-cleo-chat=slim])>footer]:hidden",
        // grows out of the corner on open; shrinks back into it on close (no clicks while it does)
        closing ? "pointer-events-none animate-cleo-panel-out" : "animate-cleo-panel-in",
        SIZE_ANIMATION,
        SIZE_CLASSES[size],
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/cleo_face.png" alt="" aria-hidden="true" className="size-8 rounded-full" />
          <span className="text-[15px] font-semibold tracking-tight">Cleo</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Desktop only: on phones the panel is always full screen. */}
          <button
            type="button"
            onClick={changeSize}
            aria-label={sizeLabel}
            title={sizeLabel}
            className={cn("hidden sm:inline-flex", iconButton)}
          >
            <SizeIcon className="size-4.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close Cleo"
            title="Close"
            className={iconButton}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <PanelSizeContext.Provider value={size}>{children}</PanelSizeContext.Provider>
      </div>

      {/* Shown on the user picker. While the chat is shown, the chat puts "Powered by" under its input box
          instead (one line less), so this footer is hidden then. */}
      <footer className="flex shrink-0 items-center justify-center border-t border-border py-2 text-[11px] text-muted-foreground">
        <PoweredBy />
      </footer>
    </section>
  );
}

/** "Powered by [icon] CloseMore". The CloseMore icon with the two-colour name; the stacked logo is unreadable this small. */
export function PoweredBy() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Powered by</span>
      <img src="/closemore-icon.png" alt="" aria-hidden="true" className="size-4 rounded-full" />
      <span className="font-semibold tracking-tight">
        <span className="text-primary">Close</span>
        <span className="text-brand-orange">More</span>
      </span>
    </span>
  );
}
