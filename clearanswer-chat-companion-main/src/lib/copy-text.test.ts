import { describe, expect, it } from "vitest";
import { answerToText, tableToTsv, titledTablesToText } from "@/lib/copy-text";
import { formatElapsed, formatTime } from "@/lib/format-message-meta";

const table = {
  columns: ["Deal", "Value"],
  rows: [
    ["A\tB", 1200.5],
    ["C", null],
  ],
  truncated: false,
};

describe("copy text", () => {
  it("makes tab-separated text with raw numbers and no stray tabs or line breaks", () => {
    expect(tableToTsv(table)).toBe("Deal\tValue\nA B\t1200.5\nC\t");
  });

  // A table that is not on screen copies all rows in the received order, with the # column.
  const numbered = "#\tDeal\tValue\n1\tA B\t1200.5\n2\tC\t";

  it("puts a title line, header (with #), rows and a blank line between tables", () => {
    const text = titledTablesToText([
      { title: "Profile", table },
      { title: "", table },
    ]);
    expect(text).toBe(`Profile\n${numbered}\n\nTable 2\n${numbered}`);
  });

  it("the answer copy is the text followed by its table(s)", () => {
    expect(answerToText({ content: "Hi" })).toBe("Hi");
    expect(answerToText({ content: "Hi", table })).toBe(`Hi\n\n${numbered}`);
    expect(answerToText({ content: "Hi", tables: [{ title: "T", table }] })).toBe(
      `Hi\n\nT\n${numbered}`,
    );
  });
});

describe("message meta", () => {
  it("formats the time as HH:MM and tolerates a missing one", () => {
    expect(formatTime(new Date(2026, 10, 8, 13, 42).getTime())).toBe("13:42");
    expect(formatTime(undefined)).toBe("");
  });

  it("rounds elapsed time to whole seconds, and says <1 s for fast answers", () => {
    expect(formatElapsed(12400)).toBe("answered in 12 s");
    expect(formatElapsed(800)).toBe("answered in <1 s");
    expect(formatElapsed(undefined)).toBe("");
  });
});
