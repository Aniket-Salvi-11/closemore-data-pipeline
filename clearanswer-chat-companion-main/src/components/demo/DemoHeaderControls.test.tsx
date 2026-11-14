import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/documents/DocumentsButton", () => ({
  DocumentsButton: () => <button type="button">Documents</button>,
}));

import { DemoHeaderControls } from "@/components/demo/DemoHeaderControls";
import { getActiveUser, setActiveUser } from "@/lib/active-user";
import { findMockUser } from "@/lib/mock-users";

const priya = findMockUser("seed-u-5");
if (!priya) throw new Error("missing mock user");

afterEach(() => act(() => setActiveUser(null)));

describe("DemoHeaderControls", () => {
  it("shows who is active, what they can see, and the demo note", () => {
    setActiveUser(priya);
    render(<DemoHeaderControls />);
    expect(screen.getByText("Priya Nair · Sales rep · Indore")).toBeInTheDocument();
    expect(screen.getByText(`Showing: ${priya.scope_label}`)).toBeInTheDocument();
    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();
  });

  it("omits the demo note when demo_mode is off", () => {
    setActiveUser({ ...priya, demo_mode: false });
    render(<DemoHeaderControls />);
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument();
  });

  it("Switch user clears the active user", () => {
    setActiveUser(priya);
    render(<DemoHeaderControls />);
    fireEvent.click(screen.getByRole("button", { name: "Switch user" }));
    expect(getActiveUser()).toBeNull();
  });
});
