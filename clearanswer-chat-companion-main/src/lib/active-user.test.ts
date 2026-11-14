import { beforeEach, describe, expect, it, vi } from "vitest";
import { findMockUser } from "@/lib/mock-users";

const priya = findMockUser("seed-u-5");
if (!priya) throw new Error("missing mock user");

async function freshModule() {
  vi.resetModules();
  return import("@/lib/active-user");
}

describe("active user store", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the whole person and survives a reload", async () => {
    const first = await freshModule();
    first.setActiveUser(priya);
    expect(first.getActiveUserId()).toBe("seed-u-5");

    const second = await freshModule();
    expect(second.getActiveUser()?.scope_label).toBe(priya.scope_label);
  });

  it("treats damaged storage as nobody selected", async () => {
    window.sessionStorage.setItem("closemore-demo-user", "{not json");
    const mod = await freshModule();
    expect(mod.getActiveUser()).toBeNull();
  });

  it("reportUnauthorized clears the user and leaves a notice", async () => {
    const mod = await freshModule();
    mod.setActiveUser(priya);
    mod.reportUnauthorized();
    expect(mod.getActiveUser()).toBeNull();
    expect(window.sessionStorage.getItem("closemore-demo-user")).toBeNull();
  });

  it("reportUnauthorized does nothing when nobody is selected", async () => {
    const mod = await freshModule();
    mod.reportUnauthorized();
    expect(mod.getActiveUser()).toBeNull();
  });
});
