import { describe, expect, it } from "vitest";
import { routeBadge } from "@/lib/route-badge";

describe("routeBadge", () => {
  it("names the document and data routes", () => {
    expect(routeBadge("rag")).toBe("From documents");
    expect(routeBadge(" RAG ")).toBe("From documents");
    expect(routeBadge("SQL")).toBe("From CRM data");
    expect(routeBadge("RAG")).toBe("From documents");
    expect(routeBadge("BOTH")).toBe("From CRM data + documents");
  });
  it("shows no badge for missing or unknown routes", () => {
    expect(routeBadge(undefined)).toBeNull();
    expect(routeBadge("")).toBeNull();
    expect(routeBadge("something_new")).toBeNull();
    for (const r of ["CHAT", "BLOCKED", "REPEAT", "ERROR"]) expect(routeBadge(r)).toBeNull();
  });
});
