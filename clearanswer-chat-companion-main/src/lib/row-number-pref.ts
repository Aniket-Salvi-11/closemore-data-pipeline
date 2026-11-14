import { useSyncExternalStore } from "react";
import type { RowNumberMode } from "@/lib/table-view";

/** The viewer's choice for the # column, kept in this browser and shared by every table. */
const KEY = "closemore-row-number-mode";
const listeners = new Set<() => void>();

function read(): RowNumberMode {
  try {
    return window.localStorage.getItem(KEY) === "original" ? "original" : "position";
  } catch {
    return "position";
  }
}

let current: RowNumberMode = typeof window === "undefined" ? "position" : read();

export function getRowNumberMode(): RowNumberMode {
  return current;
}

export function setRowNumberMode(mode: RowNumberMode): void {
  current = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Not saved (private window, blocked storage): it still works until the page is reloaded.
  }
  listeners.forEach((l) => l());
}

export function useRowNumberMode(): RowNumberMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getRowNumberMode,
    () => "position",
  );
}
