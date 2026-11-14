import type { PersonRef } from "@/lib/people";
import { useEffect, useState } from "react";
import { ChartColumn, ChartLine, Table as TableIcon } from "lucide-react";
import { ResultChart } from "@/components/chat/ResultChart";
import { ResultTable } from "@/components/chat/ResultTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildChartData,
  getDisplayTable,
  type ResultChartSpec,
  type ResultTableData,
} from "@/lib/result-data";

interface ResultViewProps {
  table: ResultTableData | null | undefined;
  chart: ResultChartSpec | null | undefined;
  /** Several-people answer: letters in the Person column show as coloured badges. */
  people?: PersonRef[] | undefined;
  /** True for a brand-new answer: the table cascades in once. */
  animate?: boolean;
}

type View = "table" | "chart";

/**
 * Shows result rows under an answer. The table is the default view.
 * When the backend also sent a usable chart, a small Table | Chart switch appears so the
 * user can look at the chart only if they want to. Display-only: nothing is sent to the backend.
 */
export function ResultView({ table, chart, people, animate = false }: ResultViewProps) {
  const [view, setView] = useState<View>("table");
  // Only the first appearance cascades; switching Chart → Table later shows the table instantly.
  const [firstShow, setFirstShow] = useState(animate);
  useEffect(() => {
    if (!firstShow) return;
    const timer = setTimeout(() => setFirstShow(false), 1200);
    return () => clearTimeout(timer);
  }, [firstShow]);

  const shown = getDisplayTable(table);
  if (!shown) return null;

  const chartData = buildChartData(shown, chart);
  // No chart (or an unsuitable one): plain table, no switch.
  if (!chartData) return <ResultTable table={shown} people={people} animate={firstShow} />;

  const ChartIcon = chartData.type === "line" ? ChartLine : ChartColumn;

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v === "chart" ? "chart" : "table")}
      className="mt-3"
    >
      <TabsList aria-label="Result view" className="h-8">
        <TabsTrigger value="table" className="gap-1.5 px-2.5 text-xs">
          <TableIcon className="size-3.5" aria-hidden="true" />
          Table
        </TabsTrigger>
        <TabsTrigger value="chart" className="gap-1.5 px-2.5 text-xs">
          <ChartIcon className="size-3.5" aria-hidden="true" />
          Chart
        </TabsTrigger>
      </TabsList>
      <TabsContent value="table" className="mt-0">
        <ResultTable table={shown} people={people} animate={firstShow} />
      </TabsContent>
      <TabsContent value="chart" className="mt-0">
        <ResultChart table={shown} chart={chart} />
        {shown.truncated ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Chart shows the first {shown.rows.length} rows
          </p>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
