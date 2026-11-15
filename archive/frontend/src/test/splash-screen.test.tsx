import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLASH_DURATION_MS, SPLASH_FADE_MS, SplashScreen } from "@/components/splash/SplashScreen";

/** The splash is gone from the page entirely (not just hidden). */
const gone = () => document.querySelector(".cm-splash") === null;

/** Timers fire inside act(); React runs the next effect only after it, so advance step by step. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("SplashScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("shows the logo animation with an accessible label and a Skip button", () => {
    render(<SplashScreen />);
    expect(screen.getByRole("status", { name: "CloseMore is loading" })).toBeInTheDocument();
    expect(screen.getByText("Close more deals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("removes itself after the animation and tells the parent", () => {
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    advance(SPLASH_DURATION_MS - 100);
    expect(screen.getByRole("status")).toBeInTheDocument();
    advance(100); // starts fading
    expect(onDone).not.toHaveBeenCalled();
    advance(SPLASH_FADE_MS);
    expect(gone()).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Skip and Escape both end it early", () => {
    const first = render(<SplashScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    advance(SPLASH_FADE_MS);
    expect(gone()).toBe(true);
    first.unmount();

    render(<SplashScreen />);
    fireEvent.keyDown(window, { key: "Escape" });
    advance(SPLASH_FADE_MS);
    expect(gone()).toBe(true);
  });

  it("plays every time by default, but only once per tab with oncePerSession", () => {
    const a = render(<SplashScreen />);
    a.unmount();
    const b = render(<SplashScreen />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    b.unmount();

    const c = render(<SplashScreen oncePerSession />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    c.unmount();
    render(<SplashScreen oncePerSession />);
    expect(gone()).toBe(true);
  });

  it("keeps the still-logo behaviour for reduced motion unless told otherwise", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      // Respecting the setting: gone after the short stay, and the "no animation" rule is present.
      const a = render(<SplashScreen />);
      expect(document.querySelector("style")?.textContent).toContain("prefers-reduced-motion");
      advance(1200);
      advance(SPLASH_FADE_MS);
      expect(gone()).toBe(true);
      a.unmount();

      // Overridden: full-length stay and no "no animation" rule.
      render(<SplashScreen respectReducedMotion={false} />);
      expect(document.querySelector("style")?.textContent).not.toContain("prefers-reduced-motion");
      advance(1200);
      advance(SPLASH_FADE_MS);
      expect(gone()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
