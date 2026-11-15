/** Local time such as "13:42". Empty when the time is unknown (older saved messages). */
export function formatTime(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "answered in 12 s", or "answered in <1 s". Empty when the backend sent no time. */
export function formatElapsed(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? "answered in <1 s" : `answered in ${Math.round(ms / 1000)} s`;
}
