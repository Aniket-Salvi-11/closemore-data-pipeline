/**
 * What the loading line says, changing every 10 seconds. These are friendly progress words,
 * not the backend's real steps (the backend doesn't report its steps yet).
 */
export const THINKING_STAGES = [
  "Understanding your question…",
  "Analyzing your data…",
  "Searching records and documents…",
  "Putting the answer together…",
  "Still working, complex questions take longer…",
  "Almost there, this can take up to a minute…",
];

export function thinkingStage(seconds: number): string {
  const index = Math.min(THINKING_STAGES.length - 1, Math.floor(seconds / 10));
  return THINKING_STAGES[index] ?? THINKING_STAGES[0] ?? "";
}
