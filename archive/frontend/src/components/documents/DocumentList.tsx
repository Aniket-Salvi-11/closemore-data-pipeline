import { FileText, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/documents/StatusBadge";
import type { DocumentItem } from "@/lib/documents-types";
import { formatBytes } from "@/lib/format-bytes";

interface DocumentListProps {
  docs: DocumentItem[];
  loading: boolean;
  onDelete: (docId: string) => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Documents the backend says this user may see. Delete shows only when can_delete is true.
 * A failed document shows the backend's short status_detail under its name.
 */
export function DocumentList({ docs, loading, onDelete }: DocumentListProps) {
  if (docs.length === 0) {
    return (
      <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {loading ? "Loading documents…" : "No documents visible to you yet."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Documents">
      {docs.map((doc) => {
        const meta = [doc.owner_name, formatDate(doc.uploaded_at), formatBytes(doc.size)]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={doc.doc_id} className="flex items-center gap-3 px-3 py-2.5">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{doc.filename}</p>
              <p className="truncate text-xs text-muted-foreground">{meta}</p>
              {doc.status === "failed" && doc.status_detail ? (
                <p className="break-words text-xs text-destructive">{doc.status_detail}</p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {doc.region}
            </span>
            <StatusBadge status={doc.status} />
            {doc.can_delete ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${doc.filename}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {doc.filename} will be removed for everyone who can see it. This can't be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(doc.doc_id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span className="size-9 shrink-0" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
