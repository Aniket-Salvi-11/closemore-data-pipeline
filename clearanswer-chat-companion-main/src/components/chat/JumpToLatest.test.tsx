import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { scrollToPageBottom, useNearBottom } from "@/hooks/use-near-bottom";

function setPage(scrollHeight: number, scrollY: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
}

afterEach(() => setPage(0, 0));

describe("useNearBottom", () => {
  it("is true at the bottom and false after scrolling up", () => {
    setPage(3000, 2200); // 2200 + 800 = 3000: at the bottom
    const { result } = renderHook(() => useNearBottom());
    expect(result.current.atBottom).toBe(true);

    act(() => {
      setPage(3000, 500);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.atBottom).toBe(false);
    expect(result.current.atBottomRef.current).toBe(false);

    act(() => {
      setPage(3000, 2160); // within the 48 px allowance
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.atBottom).toBe(true);
  });
});

describe("JumpToLatest", () => {
  it("says 'New answer' when an answer arrived unseen, otherwise 'Jump to latest'", () => {
    const onClick = vi.fn();
    const { rerender } = render(<JumpToLatest unseen onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "New answer" }));
    expect(onClick).toHaveBeenCalled();
    rerender(<JumpToLatest unseen={false} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
  });
});

describe("scrollToPageBottom", () => {
  it("scrolls to the true bottom of the page (not a marker behind the input box)", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    setPage(3000, 0);
    scrollToPageBottom();
    expect(scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: "smooth" });
    vi.unstubAllGlobals();
  });

  it("a page 100 px short of the bottom is no longer counted as at the bottom", () => {
    setPage(3000, 2100);
    const { result } = renderHook(() => useNearBottom());
    expect(result.current.atBottom).toBe(false);
  });
});
