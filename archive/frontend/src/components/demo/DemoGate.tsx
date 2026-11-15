import type { ReactNode } from "react";
import { UserPicker } from "@/components/demo/UserPicker";
import { useActiveUser } from "@/lib/active-user";
import type { DemoUser } from "@/lib/demo-users";

interface DemoGateProps {
  children: (user: DemoUser) => ReactNode;
}

/**
 * DEMO ONLY. Shows the user picker until someone is chosen, then renders the app.
 * Give the chat screen key={user.user_id} so each user starts a fresh chat and session id.
 * To remove the demo later: delete this component and render the app directly.
 */
export function DemoGate({ children }: DemoGateProps) {
  const user = useActiveUser();
  if (!user) return <UserPicker />;
  return <>{children(user)}</>;
}
