import { useEffect, useRef, useState, type RefObject } from "react";

/** How close (px) to the bottom of the message list still counts as "at the bottom". */
const THRESHOLD = 48;

export function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= THRESHOLD;
}

/**
 * Tracks whether the message list (the scrolling box inside the chat panel) is scrolled to
 * (near) its bottom. `atBottomRef` is the same value, readable inside effects without re-running them.
 */
export function useNearBottom(ref: RefObject<HTMLElement | null>) {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const near = isNearBottom(el);
      atBottomRef.current = near;
      setAtBottom(near);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Content growing (typing, tables appearing) also changes whether we're at the bottom.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref]);

  return { atBottom, atBottomRef };
}

/** Scrolls the message list to its very bottom. */
export function scrollToBottom(el: HTMLElement | null): void {
  if (!el) return;
  if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  else el.scrollTop = el.scrollHeight;
}
