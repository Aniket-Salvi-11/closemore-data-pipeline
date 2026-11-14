/**
 * Sorting, searching and numbering of result rows. Display only: works on the rows already
 * received, never changes the data and never sends anything to the backend.
 */
import { formatCell, type CellValue, type ResultTableData } from "@/lib/result-data";

export type SortDir = "asc" | "desc";
export interface SortState {
  col: number;
  dir: SortDir;
}
export type RowNumberMode = "position" | "original";
type ColumnKind = "number" | "date" | "text";

export interface ViewRow {
  cells: CellValue[];
  /** 1-based row number in the table as received. */
  original: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/;

function isEmpty(cell: CellValue | undefined): boolean {
  return cell === null || cell === undefined || cell === "";
}

/** A column is "number" or "date" only when every non-empty cell is one; otherwise "text". */
export function columnKinds(table: ResultTableData): ColumnKind[] {
  return table.columns.map((_, col) => {
    let kind: ColumnKind | null = null;
    for (const row of table.rows) {
      const cell = row[col];
      if (isEmpty(cell)) continue;
      const k: ColumnKind =
        typeof cell === "number"
          ? "number"
          : typeof cell === "string" && DATE_RE.test(cell) && !Number.isNaN(Date.parse(cell))
            ? "date"
            : "text";
      if (kind === null) kind = k;
      else if (kind !== k) return "text";
    }
    return kind ?? "text";
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: CellValue | undefined, b: CellValue | undefined, kind: ColumnKind): number {
  if (kind === "number") return (a as number) - (b as number);
  if (kind === "date") return Date.parse(String(a)) - Date.parse(String(b));
  return collator.compare(String(a), String(b));
}

/** Text the search looks at: both the raw value and how it is shown (e.g. "40790.18" and "40,790.18"). */
function searchText(cell: CellValue | undefined): string {
  if (isEmpty(cell)) return "";
  return `${String(cell)} ${formatCell(cell ?? null)}`.toLowerCase();
}

/** Rows after search and sort. Empty cells always sort last. Ties keep the received order. */
export function buildView(
  table: ResultTableData,
  query: string,
  sort: SortState | null,
): ViewRow[] {
  let rows: ViewRow[] = table.rows.map((cells, i) => ({ cells, original: i + 1 }));
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.cells.some((c) => searchText(c).includes(q)));
  if (sort) {
    const kind = columnKinds(table)[sort.col] ?? "text";
    const sign = sort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      const a = x.cells[sort.col];
      const b = y.cells[sort.col];
      if (isEmpty(a) && isEmpty(b)) return x.original - y.original;
      if (isEmpty(a)) return 1;
      if (isEmpty(b)) return -1;
      return sign * compare(a, b, kind) || x.original - y.original;
    });
  }
  return rows;
}

/** asc → desc → back to the received order. */
export function nextSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: "asc" };
  if (current.dir === "asc") return { col, dir: "desc" };
  return null;
}

/** The number shown in the # column. */
export function rowNumber(row: ViewRow, position: number, mode: RowNumberMode): number {
  return mode === "original" ? row.original : position;
}

/** Column order on screen: a pinned column moves right after #, the rest keep their order. */
export function columnOrder(count: number, pinned: number | null): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (pinned === null || pinned < 0 || pinned >= count) return all;
  return [pinned, ...all.filter((i) => i !== pinned)];
}

/** A plain table with the # column first, exactly as on screen (incl. a pinned column). Used by Copy. */
export function numberedTable(
  table: ResultTableData,
  rows: ViewRow[],
  mode: RowNumberMode,
  pinned: number | null = null,
): ResultTableData {
  const order = columnOrder(table.columns.length, pinned);
  return {
    columns: ["#", ...order.map((c) => table.columns[c] ?? "")],
    rows: rows.map((r, i) => [rowNumber(r, i + 1, mode), ...order.map((c) => r.cells[c] ?? null)]),
    truncated: table.truncated,
  };
}

/*
 * What Copy copies for each table: the view on screen (sorted, filtered, numbered).
 * A table can be on screen twice (inline and fullscreen); the most recent view wins.
 */
const copyViews = new WeakMap<ResultTableData, ResultTableData[]>();

/** Registers a view; returns a function that removes exactly this view again. */
export function setCopyView(table: ResultTableData, view: ResultTableData): () => void {
  const list = copyViews.get(table) ?? [];
  copyViews.set(table, [...list, view]);
  return () => {
    const now = copyViews.get(table) ?? [];
    const rest = now.filter((v) => v !== view);
    if (rest.length) copyViews.set(table, rest);
    else copyViews.delete(table);
  };
}

/** The on-screen view if the table is showing, otherwise all rows in received order, numbered. */
export function copyViewOf(
  table: ResultTableData,
  mode: RowNumberMode = "position",
): ResultTableData {
  const list = copyViews.get(table);
  return list?.[list.length - 1] ?? numberedTable(table, buildView(table, "", null), mode);
}
