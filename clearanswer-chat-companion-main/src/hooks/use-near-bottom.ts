import { useEffect, useRef, useState } from "react";

/** How close (px) to the bottom of the page still counts as "at the bottom". */
const THRESHOLD = 48;

function isNearBottom(): boolean {
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - THRESHOLD;
}

/**
 * Tracks whether the page is scrolled to (near) the bottom.
 * `atBottomRef` is the same value, readable inside effects without re-running them.
 */
export function useNearBottom() {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const update = () => {
      const near = isNearBottom();
      atBottomRef.current = near;
      setAtBottom(near);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { atBottom, atBottomRef };
}

/**
 * Scrolls to the true bottom of the page, so the last message ends just above the input box.
 * (Scrolling a marker into view lined it up with the screen edge, i.e. behind the sticky input box.)
 */
export function scrollToPageBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
}
