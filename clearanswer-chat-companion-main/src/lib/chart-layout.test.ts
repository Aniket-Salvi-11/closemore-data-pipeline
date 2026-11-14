import { describe, expect, it } from "vitest";
import { compactNumber, niceTicks, pointWidth, wrapLabel } from "@/lib/chart-layout";

describe("chart layout", () => {
  it("short numbers", () => {
    expect(compactNumber(248000)).toBe("248K");
    expect(compactNumber(1234567)).toBe("1.2M");
    expect(compactNumber(950)).toBe("950");
  });

  it("round ticks from 0 that cover every value", () => {
    expect(niceTicks([248000, 40790.18])).toEqual([0, 100000, 200000, 300000]);
    expect(niceTicks([-5, 12])).toEqual([-5, 0, 5, 10, 15]);
    expect(niceTicks([])).toEqual([0, 1]);
  });

  it("wraps labels onto two lines and cuts the rest with …", () => {
    expect(wrapLabel("TATA DEAL", 13)).toEqual(["TATA DEAL"]);
    expect(wrapLabel("Seed Deal 19 — Wonka Industries", 13)).toEqual([
      "Seed Deal 19",
      "— Wonka Indu…",
    ]);
    expect(wrapLabel("Supercalifragilistic", 8)).toEqual(["Superca…"]);
  });

  it("gives bars more room than line points, and more per extra series", () => {
    expect(pointWidth("line", 1)).toBe(72);
    expect(pointWidth("bar", 1)).toBe(96);
    expect(pointWidth("bar", 3)).toBe(140);
  });
});
