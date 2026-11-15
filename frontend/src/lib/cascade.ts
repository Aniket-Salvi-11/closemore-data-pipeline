import type { CSSProperties } from "react";

/** Cascade for things in a brand-new answer: items fade and slide in one after another. */
export const CASCADE_STEP_MS = 45;
/** Only the first items are staggered, so long lists take no longer than short ones. */
export const CASCADE_MAX_STAGGER = 12;
/** After this the cascade is over; later changes show instantly. */
export const CASCADE_TOTAL_MS = 1200;

/**
 * Inline style for item `index` of a cascade. Inline (not a class) so it also plays when the
 * system asks for less motion, by choice, like the typing effect.
 */
export function cascadeStyle(index: number): CSSProperties {
  return {
    animation: "answer-fade-in 0.35s ease-out both",
    animationDelay: `${Math.min(index, CASCADE_MAX_STAGGER) * CASCADE_STEP_MS}ms`,
  };
}
