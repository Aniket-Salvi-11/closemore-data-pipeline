import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { isNearBottom, scrollToBottom, useNearBottom } from "@/hooks/use-near-bottom";

/** A fake scrolling message list: total height, visible height and scroll position. */
function box(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

describe("message list position", () => {
  it("counts as at the bottom within 48 px", () => {
    expect(isNearBottom(box(3000, 600, 2400))).toBe(true);
    expect(isNearBottom(box(3000, 600, 2360))).toBe(true);
    expect(isNearBottom(box(3000, 600, 2300))).toBe(false);
  });

  it("useNearBottom follows the list's own scrolling (not the website page)", () => {
    const el = box(3000, 600, 2400);
    const ref = { current: el };
    const { result } = renderHook(() => useNearBottom(ref));
    expect(result.current.atBottom).toBe(true);
    act(() => {
      el.scrollTop = 500;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.atBottom).toBe(false);
    expect(result.current.atBottomRef.current).toBe(false);
  });

  it("scrollToBottom scrolls the list to its very end", () => {
    const el = box(3000, 600, 0);
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
    scrollToBottom(el);
    expect(scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: "smooth" });
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
