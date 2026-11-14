import { describe, expect, it } from "vitest";
import { groupByRole, parseDemoUser, regionLabel, type DemoUser } from "@/lib/demo-users";
import { MOCK_USERS } from "@/lib/mock-users";

const full = {
  user_id: "u1",
  name: "Priya Nair",
  role: "Sales_Rep",
  role_label: "Sales rep",
  regions: ["Indore"],
  profile_regions: ["Indore"],
  all_regions: false,
  scope_label: "Your deals in Indore",
  demo_mode: true,
};

describe("parseDemoUser", () => {
  it("reads a complete person", () => {
    expect(parseDemoUser(full)).toEqual(full);
  });

  it("needs a user_id and a name", () => {
    expect(parseDemoUser({ ...full, user_id: "" })).toBeNull();
    expect(parseDemoUser({ ...full, name: undefined })).toBeNull();
    expect(parseDemoUser(null)).toBeNull();
    expect(parseDemoUser("x")).toBeNull();
  });

  it("falls back to safe defaults and a label made from the role", () => {
    const p = parseDemoUser({ user_id: "u2", name: "Sam", role: "Sales_Rep" });
    expect(p?.role_label).toBe("Sales rep");
    expect(p?.regions).toEqual([]);
    expect(p?.all_regions).toBe(false);
    expect(p?.demo_mode).toBe(false);
    expect(p?.scope_label).toBe("");
  });
});

describe("groupByRole", () => {
  it("orders known groups and puts unknown labels after them", () => {
    const mk = (label: string, id: string): DemoUser => ({
      ...full,
      user_id: id,
      role_label: label,
    });
    const groups = groupByRole([
      mk("Sales rep", "a"),
      mk("Auditor", "b"),
      mk("System admin", "c"),
      mk("Executive", "d"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "System admin",
      "Executive",
      "Sales rep",
      "Auditor",
    ]);
  });

  it("groups the eight demo people into three roles", () => {
    expect(groupByRole(MOCK_USERS).map((g) => [g.label, g.users.length])).toEqual([
      ["System admin", 1],
      ["Sales admin", 2],
      ["Sales rep", 5],
    ]);
  });
});

describe("regionLabel", () => {
  it("joins profile regions, or says All regions / No region", () => {
    expect(regionLabel({ ...full, profile_regions: ["Indore", "Australia"] })).toBe(
      "Indore, Australia",
    );
    expect(regionLabel({ ...full, profile_regions: [], all_regions: true })).toBe("All regions");
    expect(regionLabel({ ...full, profile_regions: [], all_regions: false })).toBe("No region");
  });
});
