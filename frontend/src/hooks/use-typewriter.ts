import { useEffect, useRef, useState } from "react";

/** Total typing time: about 25 ms per word, never longer than 2 s, never shorter than 0.3 s. */
const MS_PER_WORD = 25;
const MAX_MS = 2000;
const MIN_MS = 300;

/** Splits into words with their following spaces, so joining any prefix gives the original text. */
export function splitWords(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/** Closes a "**" left open by a partial text, so half-typed bold doesn't show raw asterisks. */
export function closeOpenBold(partial: string): string {
  const count = partial.split("**").length - 1;
  return count % 2 === 1 ? `${partial}**` : partial;
}

/**
 * Reveals `text` word by word, always (also when the system asks for less motion, by choice:
 * it lasts at most 2 seconds). With `active` false (older or reloaded answers) the full text
 * shows at once.
 */
export function useTypewriter(text: string, active: boolean, onDone?: () => void) {
  const [skip] = useState(() => !active);
  const words = splitWords(text);
  const [count, setCount] = useState(skip ? words.length : 0);
  const doneRef = useRef(skip);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const done = count >= words.length;
  const total = words.length;

  // One steady timer for the whole answer (not one per word), so timing doesn't depend on renders.
  useEffect(() => {
    if (skip) return;
    const duration = Math.min(MAX_MS, Math.max(MIN_MS, total * MS_PER_WORD));
    const tick = 16;
    const perTick = Math.max(1, Math.ceil((total * tick) / duration));
    const timer = setInterval(() => {
      setCount((c) => {
        const next = Math.min(total, c + perTick);
        if (next >= total) clearInterval(timer);
        return next;
      });
    }, tick);
    return () => clearInterval(timer);
  }, [skip, total]);

  useEffect(() => {
    if (done && !doneRef.current) {
      doneRef.current = true;
      onDoneRef.current?.();
    }
  }, [done]);

  const shown = done ? text : closeOpenBold(words.slice(0, count).join(""));
  return { shown, done };
}
