import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_CONFIG } from "@/lib/api-service";
import { getActiveUser, setActiveUser } from "@/lib/active-user";
import { findMockUser } from "@/lib/mock-users";

const priya = findMockUser("seed-u-5");
if (!priya) throw new Error("missing mock user");
import { deleteDocument, getMe, listDocuments } from "@/lib/documents-api";
import { DocumentsApiError } from "@/lib/documents-types";

const fetchMock = vi.fn();

const doc = {
  doc_id: "d1",
  filename: "a.pdf",
  region: "Indore",
  owner_id: "seed-u-5",
  size: 120000,
  owner_name: "Priya Nair",
  uploaded_at: "2026-11-05T10:00:00Z",
  status: "ready",
  can_delete: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setActiveUser(priya);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveUser(null);
});

describe("documents API client", () => {
  it("lists documents, sends the user header, and skips malformed entries", async () => {
    fetchMock.mockResolvedValueOnce(json([doc, { nope: true }]));
    const docs = await listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.can_delete).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_CONFIG.baseUrl}/documents`);
    expect((init.headers as Record<string, string>)["X-Demo-User"]).toBe("seed-u-5");
  });

  it("sends no identity header when nobody is selected", async () => {
    setActiveUser(null);
    fetchMock.mockResolvedValueOnce(json([]));
    await listDocuments();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("X-Demo-User");
  });

  it("reads /me with the backend's fields", async () => {
    fetchMock.mockResolvedValueOnce(json(priya));
    const me = await getMe();
    expect(me.regions).toEqual(["Indore"]);
    expect(me.scope_label).toBe(priya.scope_label);
  });

  it("clears the active user when the backend answers 401", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "x" }, 401));
    await listDocuments().catch(() => undefined);
    expect(getActiveUser()).toBeNull();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [413, "too_large"],
    [415, "not_pdf"],
    [500, "server"],
  ])("maps HTTP %i to a friendly error and never shows the server text", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Traceback: secret internals" }, status));
    const error = await listDocuments().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentsApiError);
    expect((error as DocumentsApiError).kind).toBe(kind);
    expect((error as DocumentsApiError).message).not.toContain("Traceback");
  });

  it("reports network failures as retryable network errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await listDocuments().catch((e: unknown) => e);
    expect((error as DocumentsApiError).kind).toBe("network");
  });

  it("deletes with DELETE and accepts 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteDocument("d1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_CONFIG.baseUrl}/documents/d1`);
    expect(init.method).toBe("DELETE");
  });
});
