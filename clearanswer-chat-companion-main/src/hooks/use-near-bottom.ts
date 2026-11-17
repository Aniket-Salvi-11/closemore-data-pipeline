import { useEffect, useRef, useState, type RefObject } from "react";

/** How close (px) to the bottom of the page (or the scroll area) still counts as "at the bottom". */
const THRESHOLD = 48;

function isNearBottom(container?: HTMLElement | null): boolean {
  if (container) {
    return container.clientHeight + container.scrollTop >= container.scrollHeight - THRESHOLD;
  }
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - THRESHOLD;
}

/**
 * Tracks whether the page, or the given scroll area (e.g. the message list inside Cleo's panel), is
 * scrolled to (near) the bottom.
 * `atBottomRef` is the same value, readable inside effects without re-running them.
 */
export function useNearBottom(containerRef?: RefObject<HTMLElement | null>) {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef?.current ?? null;
    const target: HTMLElement | Window = container ?? window;
    const update = () => {
      const near = isNearBottom(container);
      atBottomRef.current = near;
      setAtBottom(near);
    };
    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [containerRef]);

  return { atBottom, atBottomRef };
}

/**
 * Scrolls to the true bottom of the page, so the last message ends just above the input box.
 * (Scrolling a marker into view lined it up with the screen edge, i.e. behind the sticky input box.)
 */
export function scrollToPageBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
}

/** The same for a scroll area: scrolls it to its bottom (falls back to the page without one). */
export function scrollToBottom(container?: HTMLElement | null): void {
  if (!container) {
    scrollToPageBottom();
    return;
  }
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}
