import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDocument,
  getDocument,
  getMe,
  listDocuments,
  uploadDocument,
} from "@/lib/documents-api";
import { DocumentsApiError, type DocumentItem, type MeResponse } from "@/lib/documents-types";
import { validatePdf } from "@/lib/documents-validation";

/** How often documents that are still processing are checked. */
export const POLL_INTERVAL_MS = 3000;

export type UploadState =
  { phase: "idle" } | { phase: "uploading"; filename: string; progress: number };

export interface DocsError {
  message: string;
  /** Network and server errors can be retried. */
  canRetry: boolean;
}

function toDocsError(caught: unknown): DocsError {
  if (caught instanceof DocumentsApiError) {
    return {
      message: caught.message,
      canRetry: caught.kind === "network" || caught.kind === "server",
    };
  }
  return { message: "Something went wrong. Try again.", canRetry: true };
}

/**
 * State for the Documents feature: the visible list, upload progress and status polling.
 * Call it somewhere that stays mounted (not inside the side panel) so polling continues while
 * the panel is closed. Touches nothing in the chat: no messages, no history, no session id.
 * When userId changes, everything is cleared and refetched for the new user.
 */
export function useDocuments(userId: string | null) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [error, setError] = useState<DocsError | null>(null);

  // Bumped on every user change so late responses for the previous user are ignored.
  const generation = useRef(0);
  const lastUpload = useRef<{ file: File; region: string } | null>(null);
  const processingIds = useRef<string[]>([]);
  const polling = useRef(false);

  const loadList = useCallback(async () => {
    const gen = generation.current;
    try {
      const items = await listDocuments();
      if (gen === generation.current) setDocs(items);
    } catch (caught) {
      if (gen === generation.current) setError(toDocsError(caught));
    }
  }, []);

  const loadAll = useCallback(async (gen: number) => {
    setLoading(true);
    try {
      const [profile, items] = await Promise.all([getMe(), listDocuments()]);
      if (gen !== generation.current) return;
      setMe(profile);
      setDocs(items);
    } catch (caught) {
      if (gen === generation.current) setError(toDocsError(caught));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  // New user (or no user): clear everything, then fetch for the new user.
  useEffect(() => {
    generation.current += 1;
    setDocs([]);
    setMe(null);
    setUpload({ phase: "idle" });
    setError(null);
    lastUpload.current = null;
    if (!userId) {
      setLoading(false);
      return;
    }
    void loadAll(generation.current);
  }, [userId, loadAll]);

  const processingKey = useMemo(
    () =>
      docs
        .filter((d) => d.status === "processing")
        .map((d) => d.doc_id)
        .join("|"),
    [docs],
  );
  const hasProcessing = processingKey !== "";
  useEffect(() => {
    processingIds.current = processingKey === "" ? [] : processingKey.split("|");
  }, [processingKey]);

  // Poll every 3 seconds while at least one document is processing. The interval is removed
  // as soon as none is left, so polling stops by itself on ready or failed.
  useEffect(() => {
    if (!hasProcessing) return;
    const gen = generation.current;
    const timer = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void (async () => {
        try {
          const results = await Promise.all(
            processingIds.current.map(async (id) => {
              try {
                return { id, doc: await getDocument(id), gone: false };
              } catch (caught) {
                const gone = caught instanceof DocumentsApiError && caught.kind === "not_found";
                return { id, doc: null, gone };
              }
            }),
          );
          if (gen !== generation.current) return;
          const updated = new Map<string, DocumentItem>();
          const gone = new Set<string>();
          for (const r of results) {
            if (r.doc) updated.set(r.id, r.doc);
            else if (r.gone) gone.add(r.id);
          }
          if (updated.size === 0 && gone.size === 0) return;
          setDocs((prev) =>
            prev.filter((d) => !gone.has(d.doc_id)).map((d) => updated.get(d.doc_id) ?? d),
          );
        } finally {
          polling.current = false;
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasProcessing, userId]);

  const startUpload = useCallback(
    async (file: File, region: string) => {
      const problem = validatePdf(file);
      if (problem) {
        setError({ message: problem.message, canRetry: false });
        return;
      }
      const gen = generation.current;
      lastUpload.current = { file, region };
      setError(null);
      setUpload({ phase: "uploading", filename: file.name, progress: 0 });
      try {
        const created = await uploadDocument(file, region, (progress) => {
          if (gen === generation.current) {
            setUpload({ phase: "uploading", filename: file.name, progress });
          }
        });
        if (gen !== generation.current) return;
        lastUpload.current = null;
        setUpload({ phase: "idle" });
        // The backend returns the full item, so show the new row (and start polling) at once,
        // then refresh the list to pick up anything else that changed.
        setDocs((prev) => [created, ...prev.filter((d) => d.doc_id !== created.doc_id)]);
        await loadList();
      } catch (caught) {
        if (gen !== generation.current) return;
        setUpload({ phase: "idle" });
        setError(toDocsError(caught));
      }
    },
    [loadList],
  );

  const remove = useCallback(
    async (docId: string) => {
      const gen = generation.current;
      setError(null);
      try {
        await deleteDocument(docId);
      } catch (caught) {
        if (gen === generation.current) setError(toDocsError(caught));
      }
      await loadList();
    },
    [loadList],
  );

  /** Retries the last failed upload, or reloads the list. */
  const retry = useCallback(() => {
    const last = lastUpload.current;
    setError(null);
    if (last) void startUpload(last.file, last.region);
    else void loadAll(generation.current);
  }, [startUpload, loadAll]);

  return {
    docs,
    me,
    loading,
    upload,
    error,
    processingCount: docs.filter((d) => d.status === "processing").length,
    startUpload,
    remove,
    retry,
  };
}
