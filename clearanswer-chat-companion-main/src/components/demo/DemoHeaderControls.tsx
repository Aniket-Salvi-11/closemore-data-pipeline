import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DocumentsButton } from "@/components/documents/DocumentsButton";
import { setActiveUser, useActiveUser } from "@/lib/active-user";
import { regionLabel } from "@/lib/demo-users";

/**
 * - "page"  (default): the full header block of the original full-page chat.
 * - "panel": for Cleo's panel when it is wide or full screen: the same information in a slightly smaller
 *            layout, without the long demo-mode note (the user picker already says it).
 * - "slim":  for Cleo's small panel (and phones): ONE line, "Name · Role ▾" (opens a small card with the
 *            region, what they can see and Switch user), the Documents icon, and `actions` (e.g. Clear).
 */
export type DemoHeaderLayout = "page" | "panel" | "slim";

interface DemoHeaderControlsProps {
  layout?: DemoHeaderLayout;
  /** Extra buttons at the right end of the slim line ("slim" only). */
  actions?: ReactNode;
}

/**
 * Drop-in header block: who is active, what they can see (the backend's ready-made scope_label),
 * the Documents button and "Switch user". Render it once inside the existing header.
 * The demo-mode note appears only when the backend says demo_mode is on.
 */
export function DemoHeaderControls({ layout = "page", actions }: DemoHeaderControlsProps) {
  const user = useActiveUser();
  if (!user) return null;

  if (layout === "slim") {
    return (
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Viewing as ${user.name}, ${user.role_label}. Show details and switch user`}
              className="flex min-w-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="truncate">
                {user.name} · {user.role_label}
              </span>
              <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-3 p-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Viewing as</p>
              <p className="font-medium">
                {user.name} · {user.role_label} · {regionLabel(user)}
              </p>
            </div>
            {user.scope_label ? (
              <p className="text-xs text-muted-foreground">Showing: {user.scope_label}</p>
            ) : null}
            {user.demo_mode ? (
              <p className="text-xs text-muted-foreground">
                Demo mode: in production you will sign in, and your role will come from your login.
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setActiveUser(null)}
            >
              Switch user
            </Button>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* Stays mounted here (not inside the card), so uploads keep processing and polling. */}
          <DocumentsButton compact />
          {actions}
        </div>
      </div>
    );
  }

  if (layout === "panel") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex w-full items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Viewing as</span>
          <span className="truncate rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
            {user.name} · {user.role_label} · {regionLabel(user)}
          </span>
        </div>
        <DocumentsButton />
        <Button variant="outline" size="sm" onClick={() => setActiveUser(null)}>
          Switch user
        </Button>
        {user.scope_label ? (
          <p className="w-full text-[11px] text-muted-foreground">Showing: {user.scope_label}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Viewing as</span>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
          {user.name} · {user.role_label} · {regionLabel(user)}
        </span>
      </div>
      <DocumentsButton />
      <Button variant="outline" size="sm" onClick={() => setActiveUser(null)}>
        Switch user
      </Button>
      {user.scope_label ? (
        <p className="w-full text-xs text-muted-foreground">Showing: {user.scope_label}</p>
      ) : null}
      {user.demo_mode ? (
        <p className="w-full text-xs text-muted-foreground">
          Demo mode: in production you will sign in, and your role will come from your login.
        </p>
      ) : null}
    </div>
  );
}
