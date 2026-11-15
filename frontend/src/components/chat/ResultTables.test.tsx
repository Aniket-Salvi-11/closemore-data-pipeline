import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultTables } from "@/components/chat/ResultTables";

const table = (name: string, n = 1) => ({
  title: name,
  table: {
    columns: ["Col"],
    rows: Array.from({ length: n }, (_, i) => [`${name} row ${i + 1}`]),
    truncated: false,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("ResultTables", () => {
  it("shows every table open, with its title and row count, in order", () => {
    render(
      <ResultTables tables={[table("Profile"), table("Deals owned", 4), table("Contacts")]} />,
    );
    expect(screen.getByRole("button", { name: "Profile · 1" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Deals owned · 4" })).toBeInTheDocument();
    expect(screen.getByText("Contacts row 1")).toBeInTheDocument();
  });

  it("each section folds and unfolds", () => {
    render(<ResultTables tables={[table("Profile"), table("Contacts")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Profile · 1" }));
    expect(screen.getByText("Profile row 1")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Profile · 1" }));
    expect(screen.getByText("Profile row 1")).toBeVisible();
  });

  it("Collapse all / Expand all is one toggle", () => {
    render(<ResultTables tables={[table("Profile"), table("Contacts")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getByText("Profile row 1")).not.toBeVisible();
    expect(screen.getByText("Contacts row 1")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Profile row 1")).toBeVisible();
  });

  it("Copy all copies every table with its title, all received rows, tab-separated", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const many = {
      title: "Deals owned",
      table: {
        columns: ["Deal", "Value"],
        rows: Array.from({ length: 60 }, (_, i) => [`D${i}`, i]),
        truncated: false,
      },
    };
    render(<ResultTables tables={[table("Profile"), many]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    await screen.findByText("Copied ✓");
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(
      text.startsWith("Profile\n#\tCol\n1\tProfile row 1\n\nDeals owned\n#\tDeal\tValue\n1\tD0\t0"),
    ).toBe(true);
    expect(text).toContain("60\tD59\t59"); // beyond the 50 visible rows
  });
});
