/**
 * Types and pure helpers for the optional `table` / `chart` fields of an answer.
 *
 * Display-only: nothing here touches the answer text, and none of these objects
 * are ever sent back to the backend as part of `history`.
 */

export type CellValue = string | number | boolean | null;

export interface ResultTableData {
  columns: string[];
  rows: CellValue[][];
  /** True when the backend capped the rows, i.e. more rows exist than are shown. */
  truncated: boolean;
}

export type ChartType = "bar" | "line";

export interface ResultChartSpec {
  type: ChartType;
  /** Column name used for the x axis. */
  x: string;
  /** Column names plotted as series (blue first, orange second). */
  series: string[];
  title?: string;
}

/** Rows ready for Recharts. Keys are generated so odd column names cannot break data paths. */
export interface ChartData {
  type: ChartType;
  title: string | undefined;
  xLabel: string;
  series: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

/* ------------------------------------------------------------------ */
/* Parsing (the response body is untrusted JSON)                       */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Objects/arrays are not expected; show them as text rather than dropping data.
  return JSON.stringify(value);
}

/** Returns a clean table, or null when the field is missing or malformed. */
export function parseTable(raw: unknown): ResultTableData | null {
  if (!isRecord(raw)) return null;
  const { columns, rows, truncated } = raw;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  if (columns.length === 0 || !columns.every((c) => typeof c === "string")) return null;

  const width = columns.length;
  const cleanRows: CellValue[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    // Pad short rows and cut long ones so every row lines up with the header.
    cleanRows.push(Array.from({ length: width }, (_, i) => toCell(row[i])));
  }

  return { columns: columns as string[], rows: cleanRows, truncated: truncated === true };
}

/** Returns a chart spec, or null when missing/malformed. Only valid next to a table. */
export function parseChart(raw: unknown, table: ResultTableData | null): ResultChartSpec | null {
  if (!table || !isRecord(raw)) return null;
  const { type, x, series, title } = raw;
  if (type !== "bar" && type !== "line") return null;
  if (typeof x !== "string" || !x) return null;
  if (!Array.isArray(series) || series.length === 0) return null;
  if (!series.every((s) => typeof s === "string" && s)) return null;

  const spec: ResultChartSpec = { type, x, series: series as string[] };
  if (typeof title === "string" && title.trim()) spec.title = title.trim();
  return spec;
}

/* ------------------------------------------------------------------ */
/* Rendering decisions                                                 */
/* ------------------------------------------------------------------ */

/** The table is shown only when it has columns and at least one row. */
export function getDisplayTable(table: ResultTableData | null | undefined): ResultTableData | null {
  if (!table || table.columns.length === 0 || table.rows.length === 0) return null;
  return table;
}

/** Columns whose non-empty cells are all numbers are right-aligned. */
export function numericColumns(table: ResultTableData): boolean[] {
  return table.columns.map((_, col) => {
    let sawNumber = false;
    for (const row of table.rows) {
      const cell = row[col];
      if (cell === null || cell === undefined) continue;
      if (typeof cell !== "number") return false;
      sawNumber = true;
    }
    return sawNumber;
  });
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Thousands separators, no currency symbol. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Text shown in a table cell. Empty cells show an em dash. */
export function formatCell(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

/**
 * Decides whether a chart can be drawn and prepares its data.
 * Returns null (draw nothing) when there is no table, the named columns do not
 * exist, a series has no numbers, or there is nothing to plot.
 */
export function buildChartData(
  table: ResultTableData | null | undefined,
  chart: ResultChartSpec | null | undefined,
): ChartData | null {
  const shown = getDisplayTable(table);
  if (!shown || !chart) return null;

  const xIndex = shown.columns.indexOf(chart.x);
  if (xIndex === -1) return null;

  const seriesNames = [...new Set(chart.series)];
  const seriesIndexes = seriesNames.map((name) => shown.columns.indexOf(name));
  if (seriesIndexes.some((i) => i === -1 || i === xIndex)) return null;

  const series = seriesNames.map((label, i) => ({ key: `s${i}`, label }));

  const rows = shown.rows.map((row) => {
    const x = row[xIndex];
    const point: Record<string, string | number | null> = {
      x: x === null || x === undefined ? "—" : String(x),
    };
    series.forEach((s, i) => {
      const value = row[seriesIndexes[i] ?? -1];
      point[s.key] = typeof value === "number" ? value : null;
    });
    return point;
  });

  // Every series needs at least one real number, otherwise the chart would be empty or misleading.
  const hasData = series.every((s) => rows.some((r) => typeof r[s.key] === "number"));
  if (!hasData) return null;

  return { type: chart.type, title: chart.title, xLabel: chart.x, series, rows };
}

/** Plain-language summary for screen readers. */
export function describeChart(data: ChartData): string {
  const names = data.series.map((s) => s.label).join(" and ");
  const kind = data.type === "bar" ? "Bar chart" : "Line chart";
  const title = data.title ? `${data.title}. ` : "";
  return `${title}${kind} of ${names} by ${data.xLabel}, ${data.rows.length} points.`;
}
