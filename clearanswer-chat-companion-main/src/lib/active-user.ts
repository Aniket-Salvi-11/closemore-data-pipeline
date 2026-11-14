/**
 * DEMO ONLY. Tiny store that remembers which demo user is active.
 * It keeps the WHOLE person object (not just the id), so the header can show scope_label and
 * profile_regions without another request. The API clients read the id through getActiveUserId().
 */
import { useSyncExternalStore } from "react";
import { parseDemoUser, type DemoUser } from "@/lib/demo-users";

const STORAGE_KEY = "closemore-demo-user";
const listeners = new Set<() => void>();

/** Shown on the start screen after the backend rejected the active user (HTTP 401). */
export const SESSION_ENDED_MESSAGE = "That user isn't available anymore. Please choose again.";

function readStored(): DemoUser | null {
  try {
    if (typeof window === "undefined") return null;
    const text = window.sessionStorage.getItem(STORAGE_KEY);
    // A missing or damaged value simply means "nobody selected": the picker shows.
    return text ? parseDemoUser(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

let active: DemoUser | null = readStored();
let notice: string | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getActiveUser(): DemoUser | null {
  return active;
}

export function getActiveUserId(): string | null {
  return active?.user_id ?? null;
}

/** Pass null to go back to the start screen ("Switch user"). */
export function setActiveUser(user: DemoUser | null): void {
  if (user === active) return;
  active = user;
  if (user) notice = null;
  try {
    if (typeof window !== "undefined") {
      if (user) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be blocked; the in-memory value still works.
  }
  emit();
}

/**
 * The backend answered 401 (no header, unknown or inactive user): forget the active user so the
 * start screen shows again, with a short note. Adds nothing to any chat.
 */
export function reportUnauthorized(): void {
  if (active === null) return;
  notice = SESSION_ENDED_MESSAGE;
  setActiveUser(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveUser(): DemoUser | null {
  return useSyncExternalStore(subscribe, getActiveUser, () => null);
}

/** The note to show on the start screen after a 401, or null. */
export function useAuthNotice(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => notice,
    () => null,
  );
}
