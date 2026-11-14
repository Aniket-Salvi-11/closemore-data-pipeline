/** Pure helpers for laying out result charts: short numbers, axis ticks, label wrapping, widths. */

const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 248K, 1.2M, 950. */
export function compactNumber(value: number): string {
  return Number.isFinite(value) ? compactFormat.format(value) : "";
}

/** A rounded step (1, 2, 2.5 or 5 × 10^n) that gives about `count` intervals over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Round axis ticks covering every value (always including 0), so the fixed axis and the
 * scrolling chart share exactly the same scale.
 */
export function niceTicks(values: number[], count = 4): number[] {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(0, ...finite);
  const max = Math.max(0, ...finite);
  if (min === max) return [0, 1];
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/**
 * Splits a label into at most `maxLines` lines of about `maxChars`, breaking at spaces.
 * Anything left over is cut with "…" (the full label is shown on hover).
 */
export function wrapLabel(text: string, maxChars: number, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const cut = (line: string) => (line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  // Fill every line but the last one word by word.
  for (; i < words.length && lines.length < maxLines - 1; i++) {
    const word = words[i] ?? "";
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  // The last line takes everything left, cut with "…" if it is too long.
  const rest = [current, ...words.slice(i)].filter(Boolean).join(" ");
  if (lines.length < maxLines - 1 || !rest) {
    if (rest) lines.push(rest);
    return lines.map(cut);
  }
  lines.push(rest);
  return lines.map(cut);
}

/** Room each bar group / line point gets. The chart scrolls sideways when they don't all fit. */
export function pointWidth(type: "bar" | "line", seriesCount: number): number {
  if (type === "line") return 72;
  return Math.max(96, seriesCount * 36 + 32);
}
