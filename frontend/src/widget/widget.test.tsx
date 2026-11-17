import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotWidget,
  GREETING_DELAY_MS,
  GREETING_TEXT,
  PANEL_CLOSE_MS,
} from "@/components/copilot/CopilotWidget";
import { parsePosition, setConfig } from "@/lib/runtime-config";
import { prepareCss } from "./prepare-css";

beforeEach(() => window.sessionStorage.clear());

describe("prepareCss (Shadow DOM styles)", () => {
  const raw = `@property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
:root { --primary: blue; }
.p-4 { padding: 1rem; } .m { margin: -0.5rem 2.25rem; }
@font-face { font-family: X; src: url(x.woff2); }`;

  it("moves :root tokens to :host and turns rem into px", () => {
    const { shadowCss } = prepareCss(raw);
    expect(shadowCss).toContain(":host { --primary: blue; }");
    expect(shadowCss).toContain("padding: 16px;");
    expect(shadowCss).toContain("margin: -8px 36px;");
    expect(shadowCss).not.toContain("rem");
  });

  it("keeps rem inside class names (selectors) unchanged, so the rule still matches the element", () => {
    const css =
      ".sm\\:w-\\[min\\(720px\\,calc\\(100vw-3rem\\)\\)\\]{width:min(720px,100vw - 3rem)} .min-w-\\[8rem\\]{min-width:8rem}";
    const { shadowCss } = prepareCss(css);
    expect(shadowCss).toContain(
      ".sm\\:w-\\[min\\(720px\\,calc\\(100vw-3rem\\)\\)\\]{width:min(720px,100vw - 48px)}",
    );
    expect(shadowCss).toContain(".min-w-\\[8rem\\]{min-width:128px}");
  });

  it("returns @property and @font-face separately for the page head", () => {
    const { shadowCss, documentCss } = prepareCss(raw);
    expect(documentCss).toContain("@property --tw-shadow");
    expect(documentCss).toContain("@font-face");
    expect(shadowCss).not.toContain("@property");
    expect(shadowCss).not.toContain("@font-face");
  });
});

describe("CopilotWidget (Cleo's button and panel)", () => {
  afterEach(() => {
    vi.useRealTimers();
    setConfig({ position: "right" });
  });

  /** Closing plays a short animation first; then the panel is removed. */
  const finishClosing = () => act(() => vi.advanceTimersByTime(PANEL_CLOSE_MS + 10));

  it("starts closed with just Cleo's face; clicking opens the chat panel", () => {
    render(<CopilotWidget />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    expect(screen.getByRole("dialog", { name: "Cleo" })).toBeInTheDocument();
    expect(screen.getByText("Hi, I'm Cleo")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("closes with the panel's close button or Escape (after the closing animation)", () => {
    vi.useFakeTimers();
    render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    finishClosing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    finishClosing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Cleo" })).toBeInTheDocument();
  });

  it("stays open on the next page of the website (same browser tab)", () => {
    const { unmount } = render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    unmount();
    render(<CopilotWidget />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no user picker, no documents and no demo notes", () => {
    render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    const panel = screen.getByRole("dialog");
    expect(panel.textContent).not.toMatch(/Switch user|Documents|Demo mode|Viewing as/);
  });

  it("size button: normal -> wide -> full screen -> normal, remembered on the next page", () => {
    const { unmount } = render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    expect(screen.getByRole("dialog").className).toContain("sm:w-[400px]");
    fireEvent.click(screen.getByRole("button", { name: "Make wider" }));
    expect(screen.getByRole("dialog").className).toContain("sm:w-[min(720px");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog").className).toContain("sm:w-screen");
    unmount();
    render(<CopilotWidget />);
    expect(screen.getByRole("dialog").className).toContain("sm:w-screen");
    fireEvent.click(screen.getByRole("button", { name: "Back to normal size" }));
    expect(screen.getByRole("dialog").className).toContain("sm:w-[400px]");
  });

  it("shows the greeting once per browser tab, not on every page", () => {
    vi.useFakeTimers();
    const { unmount } = render(<CopilotWidget />);
    expect(screen.queryByText(GREETING_TEXT)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(GREETING_DELAY_MS + 10));
    expect(screen.getByText(GREETING_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close greeting" }));
    expect(screen.queryByText(GREETING_TEXT)).not.toBeInTheDocument();
    unmount(); // the user opens another page of the website
    render(<CopilotWidget />);
    act(() => vi.advanceTimersByTime(GREETING_DELAY_MS + 10));
    expect(screen.queryByText(GREETING_TEXT)).not.toBeInTheDocument();
  });

  it("data-position=left puts Cleo in the bottom-left corner", () => {
    setConfig({ position: "left" });
    render(<CopilotWidget />);
    const launcherBox = screen.getByRole("button", { name: "Ask Cleo" }).parentElement;
    expect(launcherBox?.className).toContain("left-6");
    fireEvent.click(screen.getByRole("button", { name: "Ask Cleo" }));
    expect(screen.getByRole("dialog").className).toContain("sm:left-6");
    expect(parsePosition("bottom-left")).toBe("left");
    expect(parsePosition("anything else")).toBe("right");
  });

  it("gives the page script open/close/toggle controls", () => {
    vi.useFakeTimers();
    let controls: { open: () => void; close: () => void; toggle: () => void } | null = null;
    render(<CopilotWidget onReady={(c) => (controls = c)} />);
    act(() => controls?.open());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => controls?.toggle());
    finishClosing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("widget script (window.CloseMoreCopilot)", () => {
  afterEach(() => {
    window.CloseMoreCopilot?.destroy();
    vi.resetModules();
  });

  it("adds one host element with a Shadow DOM and exposes the page API; reset removes it", async () => {
    await import("./main");
    await act(async () => {});
    const host = document.getElementById("closemore-copilot");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
    expect(typeof window.CloseMoreCopilot?.open).toBe("function");
    window.sessionStorage.setItem("closemore-chat:current", "{}");
    act(() => window.CloseMoreCopilot?.reset());
    expect(document.getElementById("closemore-copilot")).toBeNull();
    expect(window.sessionStorage.getItem("closemore-chat:current")).toBeNull();
  });
});
