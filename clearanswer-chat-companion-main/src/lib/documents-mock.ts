/**
 * DEMO ONLY (VITE_USE_MOCK_API=true). Fakes the Documents endpoints in memory so the UI can be
 * built and shown without the backend. Mirrors the real backend:
 * - the same eight people (mock-users.ts) and canonical region names,
 * - the same item shape (owner_id, size, status_detail ...),
 * - delete is allowed for the uploader and a system admin only,
 * - a document nobody may see looks like a missing one (404).
 * Tip for demos: a file whose name contains "fail" ends up as Failed.
 */
import { getActiveUser } from "@/lib/active-user";
import type { DemoUser } from "@/lib/demo-users";
import { MAX_PDF_BYTES, validatePdf } from "@/lib/documents-validation";
import {
  DocumentsApiError,
  type DocumentItem,
  type DocumentStatus,
  type MeResponse,
  type UploadResult,
} from "@/lib/documents-types";
import { findMockUser, ORG_REGIONS } from "@/lib/mock-users";

/** How long a fake document stays in "processing". */
const PROCESSING_MS = 8_000;
const FAILED_DETAIL = "Couldn't read any text from this PDF.";

interface MockRecord {
  doc_id: string;
  filename: string;
  region: string;
  owner_id: string;
  size: number;
  uploaded_at: string;
  createdAt: number;
  willFail: boolean;
}

function seed(id: string, filename: string, region: string, owner: string, at: string): MockRecord {
  return {
    doc_id: id,
    filename,
    region,
    owner_id: owner,
    size: 120_000,
    uploaded_at: at,
    createdAt: 0,
    willFail: false,
  };
}

const records: MockRecord[] = [
  seed("m1", "Discount-rules.pdf", "Indore", "seed-u-5", "2026-11-03T10:00:00Z"),
  seed("m2", "Indore-playbook.pdf", "Indore", "seed-u-30", "2026-11-01T09:30:00Z"),
  seed("m3", "East-pricing.pdf", "East", "seed-u-6", "2026-10-30T14:15:00Z"),
  seed("m4", "Japan-handbook.pdf", "Japan", "seed-u-15", "2026-10-28T08:00:00Z"),
  seed("m5", "Australia-terms.pdf", "Australia", "seed-u-30", "2026-10-26T12:45:00Z"),
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function currentUser(): DemoUser {
  const user = getActiveUser();
  if (!user) throw new DocumentsApiError("unauthorized", 401);
  return user;
}

/** Region names come back canonical; any capitalisation is accepted on upload. */
function canonicalRegion(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return ORG_REGIONS.find((region) => region.toLowerCase() === wanted) ?? null;
}

function canSee(user: DemoUser, rec: MockRecord): boolean {
  return user.all_regions || user.profile_regions.includes(rec.region);
}

/** Uploader or system admin. A sales admin does NOT get delete. */
function canDelete(user: DemoUser, rec: MockRecord): boolean {
  return user.role === "System_Admin" || rec.owner_id === user.user_id;
}

function statusOf(rec: MockRecord): DocumentStatus {
  if (rec.createdAt === 0 || Date.now() - rec.createdAt >= PROCESSING_MS) {
    return rec.willFail ? "failed" : "ready";
  }
  return "processing";
}

function toItem(user: DemoUser, rec: MockRecord): DocumentItem {
  const status = statusOf(rec);
  return {
    doc_id: rec.doc_id,
    filename: rec.filename,
    region: rec.region,
    owner_id: rec.owner_id,
    owner_name: findMockUser(rec.owner_id)?.name ?? "Unknown",
    size: rec.size,
    uploaded_at: rec.uploaded_at,
    status,
    status_detail: status === "failed" ? FAILED_DETAIL : null,
    can_delete: canDelete(user, rec),
  };
}

function findVisible(user: DemoUser, docId: string): MockRecord {
  const rec = records.find((r) => r.doc_id === docId);
  // Hidden documents look the same as missing ones.
  if (!rec || !canSee(user, rec)) throw new DocumentsApiError("not_found", 404);
  return rec;
}

export async function mockMe(): Promise<MeResponse> {
  await sleep(150);
  const user = currentUser();
  return findMockUser(user.user_id) ?? user;
}

export async function mockList(): Promise<DocumentItem[]> {
  await sleep(200);
  const user = currentUser();
  return records
    .filter((r) => canSee(user, r))
    .map((r) => toItem(user, r))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

export async function mockGet(docId: string): Promise<DocumentItem> {
  await sleep(100);
  const user = currentUser();
  return toItem(user, findVisible(user, docId));
}

export async function mockDelete(docId: string): Promise<void> {
  await sleep(200);
  const user = currentUser();
  const rec = findVisible(user, docId);
  if (!canDelete(user, rec)) throw new DocumentsApiError("forbidden", 403);
  records.splice(records.indexOf(rec), 1);
}

export async function mockUpload(
  file: File,
  region: string,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  const user = currentUser();
  const problem = validatePdf(file);
  if (problem?.kind === "too_large" || file.size > MAX_PDF_BYTES) {
    throw new DocumentsApiError("too_large", 413);
  }
  if (problem) throw new DocumentsApiError("not_pdf", 415);

  const canonical = canonicalRegion(region);
  const allowed = canonical !== null && user.regions.includes(canonical);
  if (!canonical || !allowed) throw new DocumentsApiError("forbidden", 403);

  for (let percent = 0; percent <= 100; percent += 20) {
    onProgress(percent);
    await sleep(180);
  }

  const rec: MockRecord = {
    doc_id: `m-${Date.now()}`,
    filename: file.name,
    region: canonical,
    owner_id: user.user_id,
    size: file.size,
    uploaded_at: new Date().toISOString(),
    createdAt: Date.now(),
    willFail: file.name.toLowerCase().includes("fail"),
  };
  records.push(rec);
  // Like the real backend, the response is the full item (status "processing").
  return toItem(user, rec);
}
