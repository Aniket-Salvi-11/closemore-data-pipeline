/**
 * HTTP client for the Documents endpoints. The browser only talks to the backend over HTTP;
 * all S3 and vector-store work happens there. No AWS code and no keys belong here.
 * Every request carries the identity header from authHeaders() (see api-service.ts).
 * On HTTP 401 the active user is cleared, so the start screen shows again.
 */
import { reportUnauthorized } from "@/lib/active-user";
import { API_CONFIG, USE_MOCK, authHeaders } from "@/lib/api-service";
import { parseDemoUser } from "@/lib/demo-users";
import { mockDelete, mockGet, mockList, mockMe, mockUpload } from "@/lib/documents-mock";
import {
  DocumentsApiError,
  kindFromStatus,
  type DocumentItem,
  type DocumentStatus,
  type MeResponse,
  type UploadResult,
} from "@/lib/documents-types";

const STATUSES: readonly string[] = ["processing", "ready", "failed"];
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

/** Reads one untrusted document object. Returns null if a required field is missing or wrong. */
export function parseDocument(raw: unknown): DocumentItem | null {
  if (!isRecord(raw)) return null;
  const {
    doc_id,
    filename,
    region,
    owner_id,
    owner_name,
    size,
    uploaded_at,
    status,
    status_detail,
    can_delete,
  } = raw;
  if (typeof doc_id !== "string" || !doc_id) return null;
  if (typeof filename !== "string" || typeof region !== "string") return null;
  if (typeof owner_name !== "string" || typeof uploaded_at !== "string") return null;
  if (!isStatus(status)) return null;
  return {
    doc_id,
    filename,
    region,
    owner_id: typeof owner_id === "string" ? owner_id : "",
    owner_name,
    size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0,
    uploaded_at,
    status,
    // Only a failed document has a reason, and only a short readable string is kept.
    status_detail:
      status === "failed" && typeof status_detail === "string" && status_detail.trim()
        ? status_detail.trim()
        : null,
    can_delete: can_delete === true,
  };
}

async function request(path: string, method: "GET" | "DELETE" = "GET"): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_CONFIG.baseUrl}${path}`, {
      method,
      headers: { Accept: "application/json", ...authHeaders() },
    });
  } catch {
    throw new DocumentsApiError("network");
  }
  if (!response.ok) {
    if (response.status === 401) reportUnauthorized();
    throw new DocumentsApiError(kindFromStatus(response.status), response.status);
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DocumentsApiError("server");
  }
}

/** GET /me */
export async function getMe(): Promise<MeResponse> {
  if (USE_MOCK) return mockMe();
  const me = parseDemoUser(await readJson(await request("/me")));
  if (!me) throw new DocumentsApiError("server");
  return me;
}

/** GET /documents. Entries that do not match the contract are skipped. */
export async function listDocuments(): Promise<DocumentItem[]> {
  if (USE_MOCK) return mockList();
  const data = await readJson(await request("/documents"));
  if (!Array.isArray(data)) throw new DocumentsApiError("server");
  return data.map(parseDocument).filter((d): d is DocumentItem => d !== null);
}

/** GET /documents/{doc_id}, used to poll status. 404 means unknown or no longer visible. */
export async function getDocument(docId: string): Promise<DocumentItem> {
  if (USE_MOCK) return mockGet(docId);
  const doc = parseDocument(
    await readJson(await request(`/documents/${encodeURIComponent(docId)}`)),
  );
  if (!doc) throw new DocumentsApiError("server");
  return doc;
}

/** DELETE /documents/{doc_id} -> 204. Allowed while the document is still processing. */
export async function deleteDocument(docId: string): Promise<void> {
  if (USE_MOCK) return mockDelete(docId);
  await request(`/documents/${encodeURIComponent(docId)}`, "DELETE");
}

/**
 * POST /documents (multipart: file, region) -> 201 with the full document item.
 * Uses XMLHttpRequest because fetch cannot report upload progress. Role, region rules and owner
 * are decided by the backend from the user header.
 */
export function uploadDocument(
  file: File,
  region: string,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  if (USE_MOCK) return mockUpload(file, region, onProgress);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_CONFIG.baseUrl}/documents`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Accept", "application/json");
    for (const [name, value] of Object.entries(authHeaders())) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new DocumentsApiError("network"));
    xhr.ontimeout = () => reject(new DocumentsApiError("network"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        if (xhr.status === 401) reportUnauthorized();
        reject(new DocumentsApiError(kindFromStatus(xhr.status), xhr.status));
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new DocumentsApiError("server"));
        return;
      }
      const result = parseDocument(data);
      if (result) resolve(result);
      else reject(new DocumentsApiError("server"));
    };

    const form = new FormData();
    form.append("file", file);
    form.append("region", region);
    xhr.send(form);
  });
}
