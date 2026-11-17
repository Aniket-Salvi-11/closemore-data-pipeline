import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** How long after the page loads the greeting bubble appears. */
export const GREETING_DELAY_MS = 1200;
export const GREETING_TEXT = "Hi, I'm Cleo. Ask me about your leads.";

interface CleoLauncherProps {
  /** Opens Cleo's chat panel. */
  onOpen: () => void;
}

/**
 * The round Cleo button in the bottom-right corner (56px, 24px from the edges), floating gently up and
 * down, slightly larger on hover, with an "Ask Cleo" tooltip. A small greeting bubble appears next to it
 * a moment after the page loads; its X hides it for the rest of the visit.
 * Stays below pop-ups (z-40), so the user picker's dropdown and other overlays always show on top.
 */
export function CleoLauncher({ onOpen }: CleoLauncherProps) {
  const [showGreeting, setShowGreeting] = useState(false);
  const [greetingClosed, setGreetingClosed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowGreeting(true), GREETING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    // Pops in on page load and when the chat panel closes.
    <div className="fixed right-6 bottom-6 z-40 flex animate-cleo-pop-in items-end gap-3">
      {showGreeting && !greetingClosed ? (
        <div
          role="status"
          className="relative mb-2 flex max-w-60 animate-answer-in items-start gap-2 rounded-2xl rounded-br-md border border-border bg-card py-2.5 pr-2 pl-3.5 text-sm leading-snug text-card-foreground shadow-lg"
        >
          <button
            type="button"
            onClick={onOpen}
            className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {GREETING_TEXT}
          </button>
          <button
            type="button"
            onClick={() => setGreetingClosed(true)}
            aria-label="Close greeting"
            className="-mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpen}
              aria-label="Ask Cleo"
              className="group size-14 shrink-0 animate-cleo-bob rounded-full focus-visible:outline-none"
            >
              <img
                src="/cleo_face.png"
                alt=""
                aria-hidden="true"
                className="size-14 rounded-full object-cover shadow-lg ring-offset-2 transition-transform duration-200 ease-out group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-ring"
              />
            </button>
          </TooltipTrigger>
          {/* Above the button, so it never covers the greeting bubble on the left. */}
          <TooltipContent side="top" align="center" sideOffset={8}>
            Ask Cleo
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
