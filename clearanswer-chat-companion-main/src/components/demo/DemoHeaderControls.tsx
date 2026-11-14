import { Button } from "@/components/ui/button";
import { DocumentsButton } from "@/components/documents/DocumentsButton";
import { setActiveUser, useActiveUser } from "@/lib/active-user";
import { regionLabel } from "@/lib/demo-users";

/**
 * Drop-in header block: who is active, what they can see (the backend's ready-made scope_label),
 * the Documents button and "Switch user". Render it once inside the existing header.
 * The demo-mode note appears only when the backend says demo_mode is on.
 */
export function DemoHeaderControls() {
  const user = useActiveUser();
  if (!user) return null;

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
