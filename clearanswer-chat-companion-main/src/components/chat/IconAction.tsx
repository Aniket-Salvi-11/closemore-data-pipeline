import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IconActionProps {
  label: string;
  onClick: () => void;
  /** For toggles (👍/👎): whether it is on. Leave out for plain buttons. */
  pressed?: boolean;
  /** Colour classes while pressed or highlighted. */
  activeClassName?: string;
  /** Always show the active colour (for the "Copied" tick). */
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A quiet icon button: grey at rest, brand blue with a light circle on hover, a clear colour when active.
 * Has a tooltip, a visible keyboard focus ring and an aria-label.
 */
export function IconAction({
  label,
  onClick,
  pressed,
  activeClassName = "text-primary",
  highlighted = false,
  className,
  children,
}: IconActionProps) {
  const on = pressed === true || highlighted;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
            onClick={onClick}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-primary/10 hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "[&_svg]:size-4",
              on && activeClassName,
              className,
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
