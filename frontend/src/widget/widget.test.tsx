import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotWidget } from "@/components/copilot/CopilotWidget";
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

  it("returns @property and @font-face separately for the page head", () => {
    const { shadowCss, documentCss } = prepareCss(raw);
    expect(documentCss).toContain("@property --tw-shadow");
    expect(documentCss).toContain("@font-face");
    expect(shadowCss).not.toContain("@property");
    expect(shadowCss).not.toContain("@font-face");
  });
});

describe("CopilotWidget (launcher and panel)", () => {
  it("starts closed with just the icon; clicking opens the chat panel", () => {
    render(<CopilotWidget />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI Copilot" }));
    expect(screen.getByRole("dialog", { name: "CloseMore AI Copilot" })).toBeInTheDocument();
    expect(screen.getByText("What can I help you with?")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("closes with the panel's close button, the icon, or Escape", () => {
    render(<CopilotWidget />);
    const launcher = screen.getByRole("button", { name: "Open AI Copilot" });
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole("button", { name: "Close AI Copilot" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(launcher);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open on the next page of the website (same browser tab)", () => {
    const { unmount } = render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Copilot" }));
    unmount();
    render(<CopilotWidget />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no user picker, no documents and no demo notes", () => {
    render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Copilot" }));
    const panel = screen.getByRole("dialog");
    expect(panel.textContent).not.toMatch(/Switch user|Documents|Demo mode|Viewing as/);
  });

  it("can be made wider for big tables", () => {
    render(<CopilotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Copilot" }));
    fireEvent.click(screen.getByRole("button", { name: "Make wider" }));
    expect(screen.getByRole("dialog").className).toContain("sm:w-[min(960px");
    expect(screen.getByRole("button", { name: "Make narrower" })).toBeInTheDocument();
  });

  it("gives the page script open/close/toggle controls", () => {
    let controls: { open: () => void; close: () => void; toggle: () => void } | null = null;
    render(<CopilotWidget onReady={(c) => (controls = c)} />);
    act(() => controls?.open());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => controls?.toggle());
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
