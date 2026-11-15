/** Client-side checks before upload. The backend must enforce the same limits. */

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export interface ValidationProblem {
  kind: "not_pdf" | "too_large" | "empty";
  message: string;
}

export function validatePdf(file: Pick<File, "name" | "type" | "size">): ValidationProblem | null {
  const looksLikePdf =
    file.name.toLowerCase().endsWith(".pdf") &&
    (file.type === "" || file.type === "application/pdf");
  if (!looksLikePdf) return { kind: "not_pdf", message: "Only PDF files are supported." };
  if (file.size === 0) return { kind: "empty", message: "That file is empty." };
  if (file.size > MAX_PDF_BYTES) {
    return { kind: "too_large", message: "That file is too large. The limit is 20 MB." };
  }
  return null;
}
