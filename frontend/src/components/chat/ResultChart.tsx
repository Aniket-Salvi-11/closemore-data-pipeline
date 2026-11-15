import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";
import { FullscreenButton } from "@/components/chat/FullscreenButton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { compactNumber, niceTicks, pointWidth, wrapLabel } from "@/lib/chart-layout";
import {
  buildChartData,
  describeChart,
  formatNumber,
  type ResultChartSpec,
  type ResultTableData,
} from "@/lib/result-data";
import { cn } from "@/lib/utils";

interface ResultChartProps {
  table: ResultTableData | null | undefined;
  chart: ResultChartSpec | null | undefined;
  /** True inside the fullscreen overlay: taller, and no fullscreen button. */
  expanded?: boolean;
}

/** Blue first, orange second, then the remaining theme chart colours. */
const SERIES_COLORS = [
  "var(--primary)",
  "var(--brand-orange)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
];

function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "var(--primary)";
}

/** Shared by the fixed axis and the scrolling chart, so both have the same plot area. */
const MARGIN_TOP = 22;
const X_AXIS_HEIGHT = 44;

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
}

/** An x-axis label on up to two lines, cut with "…"; the full text is in a hover title. */
function wrappedTick(maxChars: number) {
  return function WrappedTick({ x = 0, y = 0, payload }: TickProps) {
    const full = String(payload?.value ?? "");
    const lines = wrapLabel(full, maxChars);
    return (
      <g transform={`translate(${x},${y})`}>
        <title>{full}</title>
        <text textAnchor="middle" fill="var(--muted-foreground)" fontSize={12}>
          {lines.map((line, i) => (
            <tspan key={i} x={0} dy={i === 0 ? 12 : 14}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  };
}

/** True while the element's content is wider than the element (so it can scroll sideways). */
function useOverflowsX(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return overflows;
}

/**
 * Bar or line chart for a data answer. Draws nothing when the data is unsuitable.
 * - Every bar (or point) gets a fixed width; when they don't fit, the chart scrolls sideways while
 *   the number axis on the left stays in place.
 * - Long names wrap onto two lines (full name on hover); bars show their value on top ("248K").
 * - The hover box shows the full name and the exact value.
 */
export function ResultChart({ table, chart, expanded = false }: ResultChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflows = useOverflowsX(scrollRef);
  const data = buildChartData(table, chart);
  if (!data) return null;

  const config: ChartConfig = {};
  data.series.forEach((s, i) => {
    config[s.key] = { label: s.label, color: seriesColor(i) };
  });

  const caption =
    data.title || `${data.series.map((s) => s.label).join(" and ")} by ${data.xLabel}`;
  const summary = describeChart(data);
  const values = data.rows.flatMap((r) =>
    data.series.map((s) => r[s.key]).filter((v): v is number => typeof v === "number"),
  );
  const ticks = niceTicks(values);
  const domain: [number, number] = [ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1];
  const axisWidth = Math.max(36, Math.max(...ticks.map((t) => compactNumber(t).length)) * 8 + 12);
  const perPoint = pointWidth(data.type, data.series.length);
  const minWidth = data.rows.length * perPoint;
  const Tick = wrappedTick(Math.max(8, Math.floor(perPoint / 7)));
  const height = expanded ? "h-[60vh]" : "h-72";
  const showValues = data.type === "bar" && data.series.length <= 2;

  const yAxisProps = {
    domain,
    ticks,
    tickLine: false,
    axisLine: false,
    allowDataOverflow: true,
  } as const;
  const xAxisBase = {
    dataKey: "x",
    tickLine: false,
    axisLine: false,
    height: X_AXIS_HEIGHT,
    interval: 0 as const,
  };

  // An array of keyed elements, NOT a Fragment: Recharts ignores axes, grid and tooltip
  // wrapped in <>...</> and would draw bare bars/lines.
  const parts = [
    <CartesianGrid key="grid" vertical={false} />,
    <XAxis
      key="x-axis"
      {...xAxisBase}
      tick={Tick}
      padding={data.type === "line" ? { left: 24, right: 24 } : {}}
    />,
    <YAxis key="y-axis" {...yAxisProps} hide />,
    <ChartTooltip
      key="tooltip"
      content={
        <ChartTooltipContent
          labelClassName="max-w-64 whitespace-normal break-words"
          formatter={(value, name, item) => (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                {name}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {typeof value === "number" ? formatNumber(value) : "—"}
              </span>
            </div>
          )}
        />
      }
    />,
  ];
  const margin = { top: MARGIN_TOP, right: 8, bottom: 0, left: 8 };

  const chartBody = (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full justify-center", height)}
      role="img"
      aria-label={summary}
    >
      {data.type === "bar" ? (
        <BarChart data={data.rows} margin={margin} accessibilityLayer>
          {parts}
          {data.series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={`var(--color-${s.key})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            >
              {showValues ? (
                <LabelList
                  dataKey={s.key}
                  position="top"
                  className="fill-foreground"
                  fontSize={11}
                  formatter={(v: unknown) => (typeof v === "number" ? compactNumber(v) : "")}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      ) : (
        <LineChart data={data.rows} margin={margin} accessibilityLayer>
          {parts}
          {data.series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      )}
    </ChartContainer>
  );

  return (
    <figure
      className={cn("rounded-xl border border-border bg-card px-3 pb-2 pt-2", !expanded && "mt-3")}
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        {/* In fullscreen the overlay already shows the title. */}
        <figcaption className={cn("text-sm font-medium text-foreground", expanded && "sr-only")}>
          {caption}
        </figcaption>
        {expanded ? null : (
          <FullscreenButton title={caption}>
            <ResultChart table={table} chart={chart} expanded />
          </FullscreenButton>
        )}
      </div>
      <div className="flex">
        {/* Fixed number axis: stays in place while the chart scrolls. Same scale as the chart. */}
        <div className="shrink-0" style={{ width: axisWidth }} aria-hidden="true">
          <ChartContainer config={config} className={cn("aspect-auto w-full", height)}>
            <BarChart data={data.rows} margin={{ top: MARGIN_TOP, right: 0, bottom: 0, left: 0 }}>
              <YAxis
                {...yAxisProps}
                width={axisWidth}
                tickFormatter={(v: number) => compactNumber(v)}
              />
              <XAxis {...xAxisBase} tick={false} />
            </BarChart>
          </ChartContainer>
        </div>
        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-x-auto"
          tabIndex={overflows ? 0 : -1}
          aria-label={overflows ? "Chart, scroll sideways for more" : undefined}
        >
          <div style={{ minWidth }}>{chartBody}</div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1">
        {data.series.length > 1 ? (
          <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
            {data.series.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-[2px]"
                  style={{ backgroundColor: seriesColor(i) }}
                  aria-hidden="true"
                />
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        {overflows ? (
          <span className="text-xs text-muted-foreground">Scroll for more →</span>
        ) : null}
      </div>
    </figure>
  );
}
