import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/documents-api", () => ({
  getMe: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
}));

import { POLL_INTERVAL_MS, useDocuments } from "@/hooks/use-documents";
import { getDocument, getMe, listDocuments, uploadDocument } from "@/lib/documents-api";
import type { DemoUser } from "@/lib/demo-users";
import { findMockUser } from "@/lib/mock-users";

const base = {
  doc_id: "d1",
  filename: "a.pdf",
  region: "Indore",
  owner_id: "seed-u-5",
  size: 120000,
  status_detail: null,
  owner_name: "Priya Nair",
  uploaded_at: "2026-11-05T10:00:00Z",
  can_delete: true,
};
const me = findMockUser("seed-u-5") as DemoUser;

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getMe).mockReset().mockResolvedValue(me);
  vi.mocked(listDocuments).mockReset();
  vi.mocked(getDocument).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useDocuments polling", () => {
  it.each(["ready", "failed"] as const)(
    "polls every 3 seconds and stops once %s",
    async (final) => {
      vi.mocked(listDocuments).mockResolvedValue([{ ...base, status: "processing" }]);
      vi.mocked(getDocument)
        .mockResolvedValueOnce({ ...base, status: "processing" })
        .mockResolvedValue({ ...base, status: final });

      const { result } = renderHook(() => useDocuments("seed-u-5"));
      await tick(0);
      expect(result.current.docs[0]?.status).toBe("processing");
      expect(getDocument).not.toHaveBeenCalled();

      await tick(POLL_INTERVAL_MS);
      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(result.current.docs[0]?.status).toBe("processing");

      await tick(POLL_INTERVAL_MS);
      expect(getDocument).toHaveBeenCalledTimes(2);
      expect(result.current.docs[0]?.status).toBe(final);

      await tick(POLL_INTERVAL_MS * 5);
      expect(getDocument).toHaveBeenCalledTimes(2);
    },
  );

  it("clears the list and refetches when the active user changes", async () => {
    vi.mocked(listDocuments)
      .mockResolvedValueOnce([{ ...base, status: "ready" }])
      .mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(({ id }) => useDocuments(id), {
      initialProps: { id: "seed-u-5" as string | null },
    });
    await tick(0);
    expect(result.current.docs).toHaveLength(1);

    rerender({ id: "seed-u-6" });
    expect(result.current.docs).toHaveLength(0);
    await tick(0);
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(result.current.docs).toHaveLength(0);
  });

  it("does nothing when nobody is selected", async () => {
    renderHook(() => useDocuments(null));
    await tick(0);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("shows an uploaded document at once, before the list is refetched", async () => {
    const created = { ...base, doc_id: "new", filename: "new.pdf", status: "processing" as const };
    vi.mocked(listDocuments).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useDocuments("seed-u-5"));
    await tick(0);

    // The refetch after the upload never resolves in this test.
    vi.mocked(uploadDocument).mockResolvedValueOnce(created);
    vi.mocked(listDocuments).mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      void result.current.startUpload(
        new File(["x"], "new.pdf", { type: "application/pdf" }),
        "Indore",
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.docs.map((d) => d.doc_id)).toEqual(["new"]);
  });
});
