import { describe, expect, it } from "vitest";
import { dealsByOwner, scopedMockAnswer, visibleDeals } from "@/lib/mock-rbac";
import { findMockUser } from "@/lib/mock-users";

const ID = {
  asha: "seed-u-1",
  dev: "u-1786635589299-566",
  meera: "seed-u-2",
  priya: "seed-u-5",
  rahul: "seed-u-12",
  neha: "seed-u-30",
  kenji: "seed-u-15",
  imran: "seed-u-6",
};

function ids(userId: string): string[] {
  const user = findMockUser(userId);
  if (!user) throw new Error(`unknown demo user ${userId}`);
  return visibleDeals(user).map((d) => d.id);
}

describe("mock deal visibility (same rules as the backend)", () => {
  it("rep sees own and deal-team deals only inside their regions", () => {
    expect(ids(ID.priya)).toEqual(["d1", "d2"]); // d3 is hers but in East
    expect(ids(ID.rahul)).toEqual(["d1", "d4"]); // d1 via the deal team
  });

  it("rep with two regions sees both", () => {
    expect(ids(ID.neha)).toEqual(["d9", "d10", "d11"]);
  });

  it("reps in other regions see only their own region", () => {
    expect(ids(ID.kenji)).toEqual(["d7", "d8"]);
    expect(ids(ID.imran)).toEqual(["d5", "d6"]);
  });

  it("sales admin with a region sees every deal there", () => {
    expect(ids(ID.meera)).toEqual(["d3", "d5", "d6"]);
  });

  it("sales admin with no region and the system admin see everything", () => {
    expect(ids(ID.dev)).toHaveLength(12);
    expect(ids(ID.asha)).toHaveLength(12);
  });

  it("answers 'deals by owner' only from visible deals", () => {
    const priya = findMockUser(ID.priya);
    if (!priya) throw new Error("missing user");
    const result = dealsByOwner(priya);
    expect(result.answer).toMatch(/can see 2 deals\./);
    expect(result.table?.rows.reduce((n, row) => n + Number(row[1]), 0)).toBe(2);
  });

  it("returns null for questions it has no scoped answer for", () => {
    const priya = findMockUser(ID.priya);
    if (!priya) throw new Error("missing user");
    expect(scopedMockAnswer("hello there", priya)).toBeNull();
    expect(scopedMockAnswer("deals per month trend", priya)).not.toBeNull();
  });
});
