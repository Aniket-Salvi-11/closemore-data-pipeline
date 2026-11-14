import { useCallback, useEffect, useState } from "react";
import { listDemoUsers } from "@/lib/demo-users-api";
import type { DemoUser } from "@/lib/demo-users";
import { DocumentsApiError } from "@/lib/documents-types";

export type DemoUsersState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: DemoUser[] };

/** DEMO ONLY. Loads the picker's people, with a loading state and a retry after a failure. */
export function useDemoUsers() {
  const [state, setState] = useState<DemoUsersState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    listDemoUsers()
      .then((users) => {
        if (!cancelled) setState({ status: "ready", users });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message =
          caught instanceof DocumentsApiError && caught.kind === "network"
            ? caught.message
            : "Couldn't load the list of users. Try again.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
