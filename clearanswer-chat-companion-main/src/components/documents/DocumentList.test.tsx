import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentList } from "@/components/documents/DocumentList";
import type { DocumentItem } from "@/lib/documents-types";

const doc = (over: Partial<DocumentItem>): DocumentItem => ({
  doc_id: "d1",
  filename: "a.pdf",
  region: "Indore",
  owner_id: "seed-u-5",
  size: 120000,
  status_detail: null,
  owner_name: "Priya Nair",
  uploaded_at: "2026-11-05T10:00:00Z",
  status: "ready",
  can_delete: false,
  ...over,
});

describe("DocumentList", () => {
  it("shows the empty state", () => {
    render(<DocumentList docs={[]} loading={false} onDelete={vi.fn()} />);
    expect(screen.getByText("No documents visible to you yet.")).toBeInTheDocument();
  });

  it("hides the delete button when can_delete is false", () => {
    render(
      <DocumentList
        docs={[
          doc({ doc_id: "mine", filename: "mine.pdf", can_delete: true }),
          doc({ doc_id: "theirs", filename: "theirs.pdf", can_delete: false }),
        ]}
        loading={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete mine.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete theirs.pdf" })).not.toBeInTheDocument();
  });

  it("shows owner, region and status for each document", () => {
    render(
      <DocumentList docs={[doc({ status: "processing" })]} loading={false} onDelete={vi.fn()} />,
    );
    expect(screen.getByText("Indore")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText(/Priya Nair/)).toBeInTheDocument();
  });

  it("shows the backend's reason under a failed document, and only then", () => {
    render(
      <DocumentList
        docs={[
          doc({
            doc_id: "f",
            filename: "bad.pdf",
            status: "failed",
            status_detail: "Couldn't read any text from this PDF.",
          }),
          doc({ doc_id: "ok", filename: "ok.pdf", status: "ready" }),
        ]}
        loading={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Couldn't read any text from this PDF.")).toHaveLength(1);
  });
});
