import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ResultView } from "@/components/chat/ResultView";
import type { ResultChartSpec, ResultTableData } from "@/lib/result-data";

// jsdom has no layout, so give ResponsiveContainer a fixed size to let Recharts draw for real.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => React.cloneElement(children, { width: 500, height: 260 }),
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const table: ResultTableData = {
  columns: ["Owner", "Deals"],
  rows: [
    ["Aman Jain", 12],
    ["Raman Mathur", 9],
  ],
  truncated: false,
};
const chart: ResultChartSpec = { type: "bar", x: "Owner", series: ["Deals"], title: "Deals" };

/** Radix tabs switch on mouse down. */
function pick(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("ResultView", () => {
  it("renders nothing without a table", () => {
    const { container } = render(<ResultView table={undefined} chart={chart} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the table, with no switch, when there is no chart", () => {
    render(<ResultView table={table} chart={undefined} />);
    expect(screen.getByTestId("result-table")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("shows no switch when the chart is unsuitable", () => {
    render(<ResultView table={table} chart={{ ...chart, series: ["Owner"] }} />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("result-table")).toBeInTheDocument();
  });

  it("starts on the table and does not draw the chart until asked", () => {
    const { container } = render(<ResultView table={table} chart={chart} />);
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("result-table")).toBeInTheDocument();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("switches to the chart and back", () => {
    const { container } = render(<ResultView table={table} chart={chart} />);
    pick("Chart");
    expect(container.querySelector(".recharts-wrapper")).not.toBeNull();
    expect(screen.queryByTestId("result-table")).not.toBeInTheDocument();
    pick("Table");
    expect(screen.getByTestId("result-table")).toBeInTheDocument();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("notes when the chart covers only the first rows of a truncated result", () => {
    render(<ResultView table={{ ...table, truncated: true }} chart={chart} />);
    expect(
      screen.getByText("Showing the first 2 rows. Refine your question to see the rest."),
    ).toBeInTheDocument();
    pick("Chart");
    expect(screen.getByText("Chart shows the first 2 rows")).toBeInTheDocument();
  });
});
