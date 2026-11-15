import { describe, expect, it } from "vitest";
import {
  buildChartData,
  formatCell,
  getDisplayTable,
  numericColumns,
  parseChart,
  parseTable,
  type ResultChartSpec,
  type ResultTableData,
} from "@/lib/result-data";

const table: ResultTableData = {
  columns: ["Owner", "Deals"],
  rows: [
    ["Aman Jain", 1],
    ["Raman Mathur", 1],
  ],
  truncated: false,
};
const bar: ResultChartSpec = {
  type: "bar",
  x: "Owner",
  series: ["Deals"],
  title: "Deals by owner",
};

describe("parseTable / parseChart", () => {
  it("returns null when there is no table", () => {
    expect(parseTable(undefined)).toBeNull();
    expect(parseTable(null)).toBeNull();
    expect(parseTable({ columns: [], rows: [] })).toBeNull();
    expect(parseTable({ columns: ["a"], rows: "nope" })).toBeNull();
  });

  it("keeps null cells and pads short rows", () => {
    const parsed = parseTable({ columns: ["a", "b"], rows: [[1], [null, "x"]] });
    expect(parsed?.rows).toEqual([
      [1, null],
      [null, "x"],
    ]);
    expect(parsed?.truncated).toBe(false);
  });

  it("reads the truncated flag", () => {
    expect(parseTable({ columns: ["a"], rows: [[1]], truncated: true })?.truncated).toBe(true);
  });

  it("never returns a chart without a table", () => {
    expect(parseChart(bar, null)).toBeNull();
    expect(parseChart(bar, table)).toEqual(bar);
  });

  it("rejects unknown chart types and empty series", () => {
    expect(parseChart({ ...bar, type: "pie" }, table)).toBeNull();
    expect(parseChart({ ...bar, series: [] }, table)).toBeNull();
  });
});

describe("table display decisions", () => {
  it("shows nothing for a table with no rows", () => {
    expect(getDisplayTable({ ...table, rows: [] })).toBeNull();
    expect(getDisplayTable(null)).toBeNull();
  });

  it("formats cells: separators, no currency, dash for empty", () => {
    expect(formatCell(1234567.5)).toBe("1,234,567.5");
    expect(formatCell(null)).toBe("—");
    expect(formatCell("")).toBe("—");
    expect(formatCell(true)).toBe("Yes");
    expect(formatCell("2026-10-31")).toBe("2026-10-31");
  });

  it("right-aligns only columns that are all numbers (nulls ignored)", () => {
    const t: ResultTableData = {
      columns: ["Name", "Value", "Empty"],
      rows: [
        ["a", 1, null],
        ["b", null, null],
      ],
      truncated: false,
    };
    expect(numericColumns(t)).toEqual([false, true, false]);
  });
});

describe("buildChartData", () => {
  it("draws nothing without a table", () => {
    expect(buildChartData(null, bar)).toBeNull();
    expect(buildChartData(undefined, bar)).toBeNull();
  });

  it("draws nothing without a chart spec", () => {
    expect(buildChartData(table, null)).toBeNull();
  });

  it("builds bar data with one point per row", () => {
    const data = buildChartData(table, bar);
    expect(data?.type).toBe("bar");
    expect(data?.rows).toEqual([
      { x: "Aman Jain", s0: 1 },
      { x: "Raman Mathur", s0: 1 },
    ]);
  });

  it("supports a line chart with a date x axis and two series", () => {
    const t: ResultTableData = {
      columns: ["Day", "A", "B"],
      rows: [
        ["2026-10-30", 1, 2],
        ["2026-10-31", 3, null],
      ],
      truncated: false,
    };
    const data = buildChartData(t, { type: "line", x: "Day", series: ["A", "B"] });
    expect(data?.series.map((s) => s.label)).toEqual(["A", "B"]);
    expect(data?.rows[1]).toEqual({ x: "2026-10-31", s0: 3, s1: null });
  });

  it("draws nothing when a named column is missing", () => {
    expect(buildChartData(table, { ...bar, x: "Nope" })).toBeNull();
    expect(buildChartData(table, { ...bar, series: ["Nope"] })).toBeNull();
  });

  it("draws nothing when a series has no numbers", () => {
    const text: ResultTableData = {
      columns: ["Owner", "Stage"],
      rows: [["a", "won"]],
      truncated: false,
    };
    expect(buildChartData(text, { type: "bar", x: "Owner", series: ["Stage"] })).toBeNull();
    const nulls: ResultTableData = {
      columns: ["Owner", "N"],
      rows: [["a", null]],
      truncated: false,
    };
    expect(buildChartData(nulls, { type: "bar", x: "Owner", series: ["N"] })).toBeNull();
  });
});
