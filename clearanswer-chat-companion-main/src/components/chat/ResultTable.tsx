import { ArrowDown, ArrowUp, ArrowUpDown, Pin, PinOff, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FullscreenButton } from "@/components/chat/FullscreenButton";
import { PersonBadge } from "@/components/chat/PeopleChips";
import { letterColumns, type PersonRef } from "@/lib/people";
import { CASCADE_TOTAL_MS, cascadeStyle } from "@/lib/cascade";
import { cn } from "@/lib/utils";
import {
  formatCell,
  getDisplayTable,
  numericColumns,
  type ResultTableData,
} from "@/lib/result-data";
import { setRowNumberMode, useRowNumberMode } from "@/lib/row-number-pref";
import {
  buildView,
  columnOrder,
  nextSort,
  numberedTable,
  rowNumber,
  setCopyView,
  type SortState,
} from "@/lib/table-view";

/** How many rows show at first, and how many more each "Show more" click adds. */
export const PAGE_SIZE = 50;
/** Tables with fewer rows than this get no search box (sorting still works). */
const SEARCH_MIN_ROWS = 6;

interface ResultTableProps {
  table: ResultTableData | null | undefined;
  /** True inside the fullscreen overlay: taller box, and no fullscreen button. */
  expanded?: boolean;
  /** Heading for the fullscreen overlay. */
  title?: string;
  /** Several-people answer: the "Person" column's letters show as coloured badges. */
  people?: PersonRef[] | undefined;
  /** Column pinned when the table opens (fullscreen starts with the inline table's pin). */
  initialPin?: number | null;
  /** True for a table in a brand-new answer: rows cascade in once. */
  animate?: boolean;
}

/** Wraps every match of `query` in a highlight. */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-brand-orange/25 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * Result rows under an answer.
 * - Click a column header to sort: ascending, descending, then back to the received order.
 * - The search box keeps only rows containing the text (any column) and highlights it.
 * - The first 50 matching rows show; "Show 50 more" reveals the next 50 (no new request).
 * - # shows the position on screen or the original row number (the viewer's choice).
 * The header stays visible inside the table's own scroll box.
 */
export function ResultTable({
  table,
  expanded = false,
  title = "Table",
  people,
  initialPin = null,
  animate = false,
}: ResultTableProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  // # is always locked; one more column can be pinned next to it.
  const [pinned, setPinned] = useState<number | null>(initialPin);
  // The cascade plays once, when the table first appears; any later change shows instantly.
  const [cascade, setCascade] = useState(animate);
  useEffect(() => {
    if (!cascade) return;
    const timer = setTimeout(() => setCascade(false), CASCADE_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [cascade]);
  // True while the table is scrolled sideways: shows the edge shadow of the locked columns.
  const [scrolledX, setScrolledX] = useState(false);
  const mode = useRowNumberMode();
  const shown = getDisplayTable(table);

  const viewRows = useMemo(
    () => (shown ? buildView(shown, query, sort) : []),
    [shown, query, sort],
  );

  // Copy / Copy all take exactly what is on screen (sorted, filtered, numbered).
  useEffect(() => {
    if (!shown) return;
    return setCopyView(shown, numberedTable(shown, viewRows, mode, pinned));
  }, [shown, viewRows, mode, pinned]);

  if (!shown) return null;

  const numeric = numericColumns(shown);
  const order = columnOrder(shown.columns.length, pinned);
  const hasPin = pinned !== null && pinned < shown.columns.length;
  // Sticky-left cells need a solid background so scrolled cells don't show through.
  const stickyBody =
    "sticky z-[1] bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";
  // No line at rest. While the table is scrolled sideways, a soft shadow fades in on the right
  // edge of the locked columns, so you can see where the fixed part ends.
  const edge = cn(
    "after:pointer-events-none after:absolute after:inset-y-0 after:-right-2 after:w-2 after:bg-linear-to-r after:from-foreground/10 after:to-transparent after:transition-opacity after:content-['']",
    scrolledX ? "after:opacity-100" : "after:opacity-0",
  );
  const pinWidth = expanded ? "max-w-[40vw]" : "max-w-[min(40vw,16rem)]";
  // Person / Deal / Contact / Product columns that hold the letters from the key.
  const letterCols = letterColumns(shown.columns, people);
  const total = shown.rows.length;
  const matches = viewRows.length;
  const rows = viewRows.slice(0, visible);
  const left = matches - rows.length;
  const searching = query.trim() !== "";
  const changed = searching || sort !== null;
  const showSearch = total >= SEARCH_MIN_ROWS;

  const onQuery = (value: string) => {
    setCascade(false);
    setQuery(value);
    setVisible(PAGE_SIZE);
  };

  return (
    <div className={cn(!expanded && "mt-3")} data-testid="result-table">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 empty:hidden">
        {showSearch ? (
          <div className="relative w-full max-w-60">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onQuery("");
              }}
              placeholder="Search this table"
              aria-label="Search this table"
              className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => onQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        {searching ? (
          <span className="text-xs text-muted-foreground" role="status">
            {matches} of {total} rows
          </span>
        ) : null}
        {changed ? (
          <div
            role="group"
            aria-label="Row numbers"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span>#:</span>
            {(["position", "original"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setRowNumberMode(m)}
                className={cn(
                  "rounded px-1.5 py-0.5 hover:text-foreground",
                  mode === m && "bg-muted font-medium text-foreground",
                )}
              >
                {m === "position" ? "Position" : "Original row"}
              </button>
            ))}
          </div>
        ) : null}
        {expanded ? null : (
          <div className={cn(!changed && "ml-auto")}>
            <FullscreenButton title={title}>
              <ResultTable
                table={table}
                expanded
                title={title}
                people={people}
                initialPin={pinned}
              />
            </FullscreenButton>
          </div>
        )}
      </div>

      {/* isolate: keeps the sticky header's z-index inside this box, so it never covers the page header. */}
      <div
        className="isolate overflow-hidden rounded-xl border border-border bg-card"
        // Scroll events don't bubble, but the capture phase still reaches this box.
        onScrollCapture={(e) => {
          const target = e.target as HTMLElement;
          if (target.tagName === "TABLE" || !target.querySelector?.("table")) return;
          const next = target.scrollLeft > 0;
          setScrolledX((prev) => (prev === next ? prev : next));
        }}
      >
        <Table
          aria-label="Query results"
          containerClassName={expanded ? "max-h-[72vh]" : "max-h-[420px]"}
          className="text-[13px]"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {/* Corner cells stay fixed both ways, above everything else in the table. */}
              <TableHead
                scope="col"
                aria-label="Row number"
                className={cn(
                  "sticky left-0 top-0 z-[3] w-10 min-w-10 whitespace-nowrap bg-muted px-3 text-right text-muted-foreground",
                  "shadow-[inset_0_-1px_0_var(--border)]",
                  !hasPin && edge,
                )}
              >
                #
              </TableHead>
              {order.map((col) => {
                const column = shown.columns[col] ?? "";
                const dir = sort?.col === col ? sort.dir : null;
                const SortIcon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
                const isPinned = col === pinned;
                const PinIcon = isPinned ? PinOff : Pin;
                return (
                  <TableHead
                    key={`${column}-${col}`}
                    scope="col"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    className={cn(
                      "group/head sticky top-0 whitespace-nowrap bg-muted px-3 text-foreground",
                      isPinned
                        ? cn("left-10 z-[3] shadow-[inset_0_-1px_0_var(--border)]", edge, pinWidth)
                        : "z-[2] shadow-[inset_0_-1px_0_var(--border)]",
                      numeric[col] && "text-right",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex max-w-full items-center gap-1",
                        numeric[col] && "flex-row-reverse",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCascade(false);
                          setSort((s) => nextSort(s, col));
                          setVisible(PAGE_SIZE);
                        }}
                        className={cn(
                          "group inline-flex min-w-0 items-center gap-1 rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          numeric[col] && "flex-row-reverse",
                        )}
                      >
                        <span className={cn(isPinned && "truncate")}>{column}</span>
                        <SortIcon
                          className={cn(
                            "size-3.5 shrink-0",
                            dir
                              ? "text-primary"
                              : "text-muted-foreground/0 group-hover:text-muted-foreground group-focus-visible:text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={isPinned ? `Unpin ${column}` : `Pin ${column}`}
                        aria-pressed={isPinned}
                        title={
                          isPinned
                            ? "Unpin column"
                            : "Pin column (keeps it visible while scrolling sideways)"
                        }
                        onClick={() => {
                          setCascade(false);
                          setPinned(isPinned ? null : col);
                        }}
                        className={cn(
                          "shrink-0 rounded p-0.5 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isPinned
                            ? "text-primary"
                            : "text-muted-foreground opacity-0 hover:text-primary group-hover/head:opacity-100",
                        )}
                      >
                        <PinIcon className="size-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={shown.columns.length + 1}
                  className="px-3 py-4 text-center text-muted-foreground"
                >
                  No rows match "{query.trim()}".
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow
                  key={row.original}
                  className="group/row"
                  style={cascade ? cascadeStyle(i) : undefined}
                >
                  <TableCell
                    className={cn(
                      "left-0 w-10 min-w-10 whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground",
                      stickyBody,
                      !hasPin && edge,
                    )}
                  >
                    {rowNumber(row, i + 1, mode)}
                  </TableCell>
                  {order.map((col) => {
                    const cell = row.cells[col];
                    const empty = cell === null || cell === undefined || cell === "";
                    const isPinned = col === pinned;
                    const text = formatCell(cell ?? null);
                    const content =
                      typeof cell === "string" && letterCols.get(col)?.has(cell) ? (
                        <PersonBadge letter={cell} title={letterCols.get(col)?.get(cell)?.name} />
                      ) : empty ? (
                        text
                      ) : (
                        highlight(text, query)
                      );
                    return (
                      <TableCell
                        key={col}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5",
                          numeric[col] && "text-right tabular-nums",
                          empty && "text-muted-foreground",
                          isPinned && cn("left-10", stickyBody, edge, pinWidth),
                        )}
                      >
                        {isPinned ? (
                          <span className="block truncate" title={text}>
                            {content}
                          </span>
                        ) : (
                          content
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {left > 0 ? (
        <button
          type="button"
          onClick={() => {
            setCascade(false);
            setVisible((v) => v + PAGE_SIZE);
          }}
          className="mt-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Show {PAGE_SIZE} more ({left} left)
        </button>
      ) : shown.truncated ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {changed
            ? `Sorted and searched within the first ${total} rows. Refine your question to see the rest.`
            : `Showing the first ${total} rows. Refine your question to see the rest.`}
        </p>
      ) : null}
    </div>
  );
}
