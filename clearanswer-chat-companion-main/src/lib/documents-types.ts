/** Types and the friendly error class shared by the documents API client and its mock. */
import type { DemoUser } from "@/lib/demo-users";

export type DocumentStatus = "processing" | "ready" | "failed";

/** One document, exactly as the list, single-get and upload endpoints return it. */
export interface DocumentItem {
  doc_id: string;
  filename: string;
  /** Canonical region name, for example "East", "Japan", "LATAM". */
  region: string;
  owner_id: string;
  owner_name: string;
  /** Size in bytes. */
  size: number;
  uploaded_at: string;
  status: DocumentStatus;
  /** Short, safe-to-show reason. Only set when status is "failed". */
  status_detail: string | null;
  /** True for the uploader and for a system admin. */
  can_delete: boolean;
}

/** GET /me returns the same object as one GET /demo/users item. */
export type MeResponse = DemoUser;

/** POST /documents returns 201 with the full item, so the new row can be shown immediately. */
export type UploadResult = DocumentItem;

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "too_large"
  | "not_pdf"
  | "invalid"
  | "not_found"
  | "network"
  | "server";

/** Fixed, friendly text. Raw server messages are never shown. */
const MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: "Pick a user to continue.",
  forbidden: "You are not allowed to do that",
  too_large: "That file is too large. The limit is 20 MB.",
  not_pdf: "Only PDF files are supported.",
  invalid: "That request wasn't valid. Check the file and try again.",
  not_found: "That document isn't available anymore.",
  network: "Couldn't reach the server. Check your connection and retry.",
  server: "Something went wrong. Try again.",
};

export class DocumentsApiError extends Error {
  kind: ApiErrorKind;
  status: number | undefined;

  constructor(kind: ApiErrorKind, status?: number | undefined) {
    super(MESSAGES[kind]);
    this.name = "DocumentsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return "invalid";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 413:
      return "too_large";
    case 415:
      return "not_pdf";
    default:
      return "server";
  }
}
