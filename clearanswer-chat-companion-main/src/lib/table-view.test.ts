import { describe, expect, it } from "vitest";
import { buildView, columnKinds, nextSort, numberedTable } from "@/lib/table-view";

const table = {
  columns: ["Name", "Value", "Close"],
  rows: [
    ["Priya Nair", 9, "2026-10-19"],
    ["asha", 100, null],
    ["Rahul", null, "2026-08-29"],
    ["priya Sharma", 40790.18, "2026-01-02"],
  ],
  truncated: false,
};

const names = (rows: { cells: unknown[] }[]) => rows.map((r) => r.cells[0]);

describe("table view", () => {
  it("knows number, date and text columns", () => {
    expect(columnKinds(table)).toEqual(["text", "number", "date"]);
    expect(
      columnKinds({
        ...table,
        rows: [
          ["a", 1, "2026-01-01"],
          ["b", "x", "soon"],
        ],
      }),
    ).toEqual(["text", "text", "text"]);
  });

  it("sorts numbers as numbers, with empty cells last both ways", () => {
    expect(names(buildView(table, "", { col: 1, dir: "asc" }))).toEqual([
      "Priya Nair",
      "asha",
      "priya Sharma",
      "Rahul",
    ]);
    expect(names(buildView(table, "", { col: 1, dir: "desc" }))).toEqual([
      "priya Sharma",
      "asha",
      "Priya Nair",
      "Rahul",
    ]);
  });

  it("sorts dates as dates and text ignoring capitals", () => {
    expect(names(buildView(table, "", { col: 2, dir: "asc" }))).toEqual([
      "priya Sharma",
      "Rahul",
      "Priya Nair",
      "asha",
    ]);
    expect(names(buildView(table, "", { col: 0, dir: "asc" }))).toEqual([
      "asha",
      "Priya Nair",
      "priya Sharma",
      "Rahul",
    ]);
  });

  it("searches every column, ignoring capitals, and also matches the formatted number", () => {
    const hits = buildView(table, "PRIYA", null);
    expect(names(hits)).toEqual(["Priya Nair", "priya Sharma"]);
    expect(hits.map((r) => r.original)).toEqual([1, 4]);
    expect(names(buildView(table, "40,790", null))).toEqual(["priya Sharma"]);
    expect(buildView(table, "zzz", null)).toEqual([]);
  });

  it("cycles a column: ascending, descending, back to the received order", () => {
    const a = nextSort(null, 1);
    const d = nextSort(a, 1);
    expect(a).toEqual({ col: 1, dir: "asc" });
    expect(d).toEqual({ col: 1, dir: "desc" });
    expect(nextSort(d, 1)).toBeNull();
    expect(nextSort(d, 2)).toEqual({ col: 2, dir: "asc" });
  });

  it("numbers rows by position or by original row", () => {
    const view = buildView(table, "priya", null);
    expect(numberedTable(table, view, "position").rows.map((r) => r[0])).toEqual([1, 2]);
    expect(numberedTable(table, view, "original").rows.map((r) => r[0])).toEqual([1, 4]);
    expect(numberedTable(table, view, "position").columns[0]).toBe("#");
  });
});
