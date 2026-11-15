import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, validatePdf } from "@/lib/documents-validation";

const pdf = { name: "a.pdf", type: "application/pdf", size: 1000 };

describe("validatePdf", () => {
  it("accepts a normal PDF, and a PDF with no reported type", () => {
    expect(validatePdf(pdf)).toBeNull();
    expect(validatePdf({ ...pdf, type: "" })).toBeNull();
    expect(validatePdf({ ...pdf, name: "UPPER.PDF" })).toBeNull();
  });

  it("rejects other file types", () => {
    expect(validatePdf({ name: "a.docx", type: "application/msword", size: 10 })?.kind).toBe(
      "not_pdf",
    );
    expect(validatePdf({ name: "a.pdf", type: "image/png", size: 10 })?.kind).toBe("not_pdf");
  });

  it("accepts exactly 20 MB and rejects anything larger", () => {
    expect(validatePdf({ ...pdf, size: MAX_PDF_BYTES })).toBeNull();
    const big = validatePdf({ ...pdf, size: MAX_PDF_BYTES + 1 });
    expect(big?.kind).toBe("too_large");
    expect(big?.message).toContain("20 MB");
  });

  it("rejects an empty file", () => {
    expect(validatePdf({ ...pdf, size: 0 })?.kind).toBe("empty");
  });
});
