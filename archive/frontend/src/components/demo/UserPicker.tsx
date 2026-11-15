import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoUsers } from "@/hooks/use-demo-users";
import { setActiveUser, useAuthNotice } from "@/lib/active-user";
import { groupByRole, regionLabel } from "@/lib/demo-users";

/**
 * DEMO ONLY start screen. The people come from the backend (GET /demo/users), grouped by role.
 * Choosing a person switches straight into that person's chat. No credentials.
 * In production this is replaced by a real login.
 */
export function UserPicker() {
  const { state, retry } = useDemoUsers();
  const notice = useAuthNotice();

  const users = state.status === "ready" ? state.users : [];
  // The demo explanation is shown only when the backend says it is running in demo mode.
  const showDemoNote = users.some((u) => u.demo_mode);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-5" aria-busy={state.status === "loading"}>
        <img src="/closemore-logo.png" alt="CloseMore" className="h-8 w-auto" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">AI Copilot</h1>
          <p className="text-sm text-muted-foreground">
            {showDemoNote
              ? "Demo mode. Choose a user to see what that role can see. No password needed."
              : "Choose a user to continue."}
          </p>
        </div>

        {notice ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {notice}
          </p>
        ) : null}

        {state.status === "error" ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{state.message}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : (
          <Select
            disabled={state.status === "loading" || users.length === 0}
            onValueChange={(id) => {
              const person = users.find((u) => u.user_id === id);
              if (person) setActiveUser(person);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Choose a user">
              <SelectValue
                placeholder={state.status === "loading" ? "Loading users…" : "Choose a user"}
              />
            </SelectTrigger>
            <SelectContent>
              {groupByRole(users).map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.users.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.name} · {regionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}

        {state.status === "ready" && users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users are available.</p>
        ) : null}

        {showDemoNote ? (
          <p className="text-xs text-muted-foreground">
            In production this will be a real login, and your role will come from a signed token.
          </p>
        ) : null}
      </div>
    </main>
  );
}
