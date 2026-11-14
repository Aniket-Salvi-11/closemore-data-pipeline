import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ChatMessageView } from "@/components/chat/ChatMessage";
import { ResultChart } from "@/components/chat/ResultChart";
import { ResultTable } from "@/components/chat/ResultTable";
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
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const table: ResultTableData = {
  columns: ["Owner", "Deals"],
  rows: [
    ["Aman Jain", 1200],
    ["Raman Mathur", null],
  ],
  truncated: false,
};
const chart: ResultChartSpec = {
  type: "bar",
  x: "Owner",
  series: ["Deals"],
  title: "Deals by owner",
};

describe("ResultTable", () => {
  it("renders nothing without a table", () => {
    const { container } = render(<ResultTable table={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows null cells as a dash and formats numbers", () => {
    render(<ResultTable table={table} />);
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toHaveClass("text-right");
  });

  it("shows the truncated notice only when truncated", () => {
    const { rerender } = render(<ResultTable table={table} />);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
    rerender(<ResultTable table={{ ...table, truncated: true }} />);
    expect(
      screen.getByText("Showing the first 2 rows. Refine your question to see the rest."),
    ).toBeInTheDocument();
  });
});

describe("ResultChart", () => {
  it("draws nothing without a table", () => {
    const { container } = render(<ResultChart table={undefined} chart={chart} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing when the data is unsuitable", () => {
    const { container } = render(
      <ResultChart table={table} chart={{ ...chart, series: ["Owner"] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a titled, labelled chart for suitable data", () => {
    render(<ResultChart table={table} chart={chart} />);
    expect(screen.getByText("Deals by owner")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Bar chart"),
    );
  });
});

describe("ResultChart axes", () => {
  it("draws grid, both axes and, for several series, a legend (bar and line)", () => {
    const multi: ResultTableData = {
      columns: ["Owner", "Deals", "Won"],
      rows: [
        ["A", 10, 4],
        ["B", 7, 2],
      ],
      truncated: false,
    };
    for (const type of ["bar", "line"] as const) {
      const { container, unmount } = render(
        <ResultChart table={multi} chart={{ type, x: "Owner", series: ["Deals", "Won"] }} />,
      );
      expect(container.querySelector(".recharts-cartesian-grid")).not.toBeNull();
      expect(container.querySelector(".recharts-xAxis")).not.toBeNull();
      expect(container.querySelector(".recharts-yAxis")).not.toBeNull();
      // Our own legend under the chart (a Recharts legend would shift the plot area off the fixed axis).
      expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("DealsWon");
      unmount();
    }
  });

  it("shows each bar's value on top in short form, and long names wrapped with the full name on hover", async () => {
    const long: ResultTableData = {
      columns: ["Deal Name", "Deal Value"],
      rows: [
        ["Seed Deal 19 — Wonka Industries", 248000],
        ["TATA DEAL", 1200000],
      ],
      truncated: false,
    };
    const { container } = render(
      <ResultChart table={long} chart={{ type: "bar", x: "Deal Name", series: ["Deal Value"] }} />,
    );
    // Recharts draws the value labels once the bar animation has finished.
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-label-list text").length).toBe(2),
    );
    const labels = [...container.querySelectorAll(".recharts-label-list text")].map(
      (t) => t.textContent,
    );
    expect(labels).toEqual(["248K", "1.2M"]);
    const titles = [...container.querySelectorAll(".recharts-xAxis title")].map(
      (t) => t.textContent,
    );
    expect(titles).toContain("Seed Deal 19 — Wonka Industries");
    // The y axis uses short numbers too.
    expect(container.textContent).toContain("1.2M");
  });

  it("gives every bar a fixed width so many bars scroll instead of squeezing", () => {
    const many: ResultTableData = {
      columns: ["Owner", "Deals"],
      rows: Array.from({ length: 20 }, (_, i) => [`Owner ${i + 1}`, i + 1]),
      truncated: false,
    };
    const { container } = render(
      <ResultChart table={many} chart={{ type: "bar", x: "Owner", series: ["Deals"] }} />,
    );
    const inner = container.querySelector<HTMLElement>(".overflow-x-auto > div");
    expect(inner?.style.minWidth).toBe("1920px"); // 20 bars × 96 px
  });

  it("has a fullscreen button that opens a larger copy of the chart", () => {
    render(<ResultChart table={table} chart={chart} />);
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Deals by owner");
    expect(dialog.querySelector(".recharts-surface")).not.toBeNull();
  });
});

describe("ResultTable fullscreen", () => {
  it("opens the table big in an overlay, closes with Escape", () => {
    render(<ResultTable table={table} title="Deals" />);
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Aman Jain");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ChatMessageView", () => {
  it("shows the answer text unchanged and the table under it", () => {
    render(
      <ChatMessageView
        message={{
          id: "1",
          role: "assistant",
          content: "Two owners.\nInterpreted as: deals",
          table,
        }}
      />,
    );
    expect(screen.getByText(/Two owners\./)).toBeInTheDocument();
    expect(screen.getByTestId("result-table")).toBeInTheDocument();
  });

  it("shows only text when there is no table", () => {
    render(<ChatMessageView message={{ id: "1", role: "assistant", content: "Just text" }} />);
    expect(screen.queryByTestId("result-table")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /chart/i })).not.toBeInTheDocument();
  });

  describe("paging", () => {
    const big = {
      columns: ["N"],
      rows: Array.from({ length: 74 }, (_, i) => [i + 1]),
      truncated: false,
    };

    it("shows 50 rows, then reveals the rest 50 at a time without a new request", () => {
      render(<ResultTable table={big} />);
      expect(screen.getAllByRole("row")).toHaveLength(51); // header + 50
      fireEvent.click(screen.getByRole("button", { name: "Show 50 more (24 left)" }));
      expect(screen.getAllByRole("row")).toHaveLength(75);
      expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
    });

    it("numbers the rows, and keeps counting after Show more; the number is not part of the data", () => {
      render(<ResultTable table={big} />);
      expect(screen.getByRole("columnheader", { name: "Row number" })).toHaveTextContent("#");
      fireEvent.click(screen.getByRole("button", { name: /Show 50 more/ }));
      const last = screen.getAllByRole("row").at(-1);
      expect(last?.textContent).toBe("7474");
    });

    it("says to refine the question once every received row is visible and more exist", () => {
      render(<ResultTable table={{ ...big, rows: big.rows.slice(0, 40), truncated: true }} />);
      expect(
        screen.getByText("Showing the first 40 rows. Refine your question to see the rest."),
      ).toBeInTheDocument();
    });

    it("keeps the sticky header inside the table's own box (below the page header)", () => {
      const { container } = render(<ResultTable table={big} />);
      expect(container.querySelector(".isolate")).not.toBeNull();
      const th = container.querySelector("th");
      expect(th?.className).toContain("sticky");
      expect(th?.className).not.toContain("z-10");
    });
  });
});
