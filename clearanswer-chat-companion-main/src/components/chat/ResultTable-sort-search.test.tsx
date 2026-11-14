import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultTable } from "@/components/chat/ResultTable";
import { answerToText } from "@/lib/copy-text";
import { setRowNumberMode } from "@/lib/row-number-pref";

const table = {
  columns: ["Owner", "Value"],
  rows: [
    ["Priya Nair", 4000],
    ["Rahul", 9],
    ["Asha", 100],
    ["Priya Sharma", 2500],
    ["Kenji", null],
    ["Priya Nair", 6000],
  ],
  truncated: false,
};

function bodyRows() {
  const [, ...rows] = screen.getAllByRole("row");
  return rows.map((r) =>
    within(r)
      .getAllByRole("cell")
      .map((c) => c.textContent),
  );
}

afterEach(() => act(() => setRowNumberMode("position")));

describe("ResultTable: sorting", () => {
  it("sorts a column up, down, then back to the received order", () => {
    render(<ResultTable table={table} />);
    const header = screen.getByRole("button", { name: "Value" });
    fireEvent.click(header);
    expect(screen.getByRole("columnheader", { name: "Value" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(bodyRows().map((r) => r[2])).toEqual(["9", "100", "2,500", "4,000", "6,000", "—"]);
    fireEvent.click(header);
    expect(bodyRows().map((r) => r[2])).toEqual(["6,000", "4,000", "2,500", "100", "9", "—"]);
    fireEvent.click(header);
    expect(bodyRows().map((r) => r[1])).toEqual(table.rows.map((r) => r[0]));
  });
});

describe("ResultTable: search", () => {
  it("keeps matching rows, shows the count, highlights, and clears with ✕ or Esc", () => {
    const { container } = render(<ResultTable table={table} />);
    const box = screen.getByRole("searchbox", { name: "Search this table" });
    fireEvent.change(box, { target: { value: "priya" } });
    expect(screen.getByText("3 of 6 rows")).toBeInTheDocument();
    expect(bodyRows().map((r) => r[1])).toEqual(["Priya Nair", "Priya Sharma", "Priya Nair"]);
    expect(container.querySelectorAll("mark")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(bodyRows()).toHaveLength(6);

    fireEvent.change(box, { target: { value: "rahul" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(bodyRows()).toHaveLength(6);
  });

  it("says when nothing matches", () => {
    render(<ResultTable table={table} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByText('No rows match "xyz".')).toBeInTheDocument();
  });

  it("no search box for small tables (sorting still works)", () => {
    render(<ResultTable table={{ ...table, rows: table.rows.slice(0, 3) }} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owner" })).toBeInTheDocument();
  });
});

describe("ResultTable: # column choice", () => {
  it("shows position by default and the original row when chosen; the choice appears once something changed", () => {
    render(<ResultTable table={table} />);
    expect(screen.queryByRole("group", { name: "Row numbers" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "priya" } });
    expect(bodyRows().map((r) => r[0])).toEqual(["1", "2", "3"]);
    fireEvent.click(screen.getByRole("button", { name: "Original row" }));
    expect(bodyRows().map((r) => r[0])).toEqual(["1", "4", "6"]);
    expect(screen.getByRole("button", { name: "Original row" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ResultTable: copy follows the screen", () => {
  it("copies the sorted and filtered rows with the # shown", () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() } });
    render(<ResultTable table={table} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(answerToText({ content: "A", table })).toBe(
      "A\n\n#\tOwner\tValue\n1\tPriya Sharma\t2500\n2\tPriya Nair\t4000\n3\tPriya Nair\t6000",
    );
    act(() => setRowNumberMode("original"));
    expect(answerToText({ content: "A", table })).toBe(
      "A\n\n#\tOwner\tValue\n4\tPriya Sharma\t2500\n1\tPriya Nair\t4000\n6\tPriya Nair\t6000",
    );
    vi.unstubAllGlobals();
  });
});

describe("ResultTable: # locked, one pinned column", () => {
  const wide = {
    columns: ["Owner", "Region", "Value"],
    rows: [
      ["Priya Nair", "Indore", 4000],
      ["Rahul", "East", 9],
    ],
    truncated: false,
  };

  function headers() {
    return screen
      .getAllByRole("columnheader")
      .map((h) => h.getAttribute("aria-label") ?? h.textContent);
  }

  it("# is always locked to the left", () => {
    render(<ResultTable table={wide} />);
    const hash = screen.getByRole("columnheader", { name: "Row number" });
    expect(hash.className).toContain("sticky");
    expect(hash.className).toContain("left-0");
  });

  it("pinning a column moves it next to # and locks it; pinning another replaces it; unpin restores the order", () => {
    render(<ResultTable table={wide} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Value" }));
    expect(headers()).toEqual(["Row number", "Value", "Owner", "Region"]);
    const pinnedHead = screen.getByRole("columnheader", { name: /Value/ });
    expect(pinnedHead.className).toContain("left-10");
    expect(screen.getByRole("button", { name: "Unpin Value" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(bodyRows()[0]).toEqual(["1", "4,000", "Priya Nair", "Indore"]);

    fireEvent.click(screen.getByRole("button", { name: "Pin Region" }));
    expect(headers()).toEqual(["Row number", "Region", "Owner", "Value"]);
    expect(screen.queryByRole("button", { name: "Unpin Value" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpin Region" }));
    expect(headers()).toEqual(["Row number", "Owner", "Region", "Value"]);
  });

  it("sorting still works on the pinned column, and Copy follows the screen order", () => {
    render(<ResultTable table={wide} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(bodyRows().map((r) => r[1])).toEqual(["9", "4,000"]);
    expect(answerToText({ content: "A", table: wide })).toBe(
      "A\n\n#\tValue\tOwner\tRegion\n1\t9\tRahul\tEast\n2\t4000\tPriya Nair\tIndore",
    );
  });

  it("fullscreen opens with the same pinned column", () => {
    render(<ResultTable table={wide} title="Deals" />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Unpin Region" })).toBeInTheDocument();
  });

  it("no divider line at rest; a soft edge shadow appears only while scrolled sideways", () => {
    render(<ResultTable table={wide} />);
    const hash = screen.getByRole("columnheader", { name: "Row number" });
    expect(hash.className).not.toContain("inset_-1px");
    expect(hash.className).toContain("after:opacity-0");

    const box = screen.getByRole("table").parentElement as HTMLElement;
    box.scrollLeft = 120;
    fireEvent.scroll(box);
    expect(hash.className).toContain("after:opacity-100");

    // With a pinned column, the shadow moves to the pinned column's edge.
    fireEvent.click(screen.getByRole("button", { name: "Pin Region" }));
    expect(hash.className).not.toContain("after:opacity");
    expect(screen.getByRole("columnheader", { name: /Region/ }).className).toContain(
      "after:opacity-100",
    );

    box.scrollLeft = 0;
    fireEvent.scroll(box);
    expect(screen.getByRole("columnheader", { name: /Region/ }).className).toContain(
      "after:opacity-0",
    );
  });
});
