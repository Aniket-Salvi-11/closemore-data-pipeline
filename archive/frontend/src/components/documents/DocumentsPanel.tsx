import { Button } from "@/components/ui/button";
import { DocumentList } from "@/components/documents/DocumentList";
import { UploadSection } from "@/components/documents/UploadSection";
import type { DocsError, UploadState } from "@/hooks/use-documents";
import type { DocumentItem, MeResponse } from "@/lib/documents-types";

interface DocumentsPanelProps {
  docs: DocumentItem[];
  me: MeResponse | null;
  loading: boolean;
  upload: UploadState;
  error: DocsError | null;
  onUpload: (file: File, region: string) => void;
  onDelete: (docId: string) => void;
  onRetry: () => void;
}

/** Body of the Documents side panel. Pure display: all state lives in useDocuments(). */
export function DocumentsPanel(props: DocumentsPanelProps) {
  const { docs, me, loading, upload, error, onUpload, onDelete, onRetry } = props;

  return (
    <div className="space-y-5 px-4 pb-6">
      <UploadSection
        regions={me?.regions ?? []}
        ready={me !== null}
        upload={upload}
        onUpload={onUpload}
      />

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{error.message}</span>
          {error.canRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Documents you can see</h3>
        <DocumentList docs={docs} loading={loading} onDelete={onDelete} />
      </div>
    </div>
  );
}
