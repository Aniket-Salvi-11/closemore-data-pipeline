import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { useDocuments } from "@/hooks/use-documents";
import { useActiveUser } from "@/lib/active-user";

/**
 * Header button that opens the Documents side panel. State lives here (not inside the sheet),
 * so a document keeps processing and polling after the panel is closed.
 */
export function DocumentsButton() {
  const user = useActiveUser();
  const docs = useDocuments(user?.user_id ?? null);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="size-4" aria-hidden="true" />
          Documents
          {docs.processingCount > 0 ? (
            <span className="rounded-md bg-(--brand-orange)/20 px-1.5 text-xs">
              {docs.processingCount} processing
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Documents</SheetTitle>
          <SheetDescription>
            Upload PDFs and see the documents you're allowed to see. You can keep chatting while a
            document is processing.
          </SheetDescription>
        </SheetHeader>
        <DocumentsPanel
          docs={docs.docs}
          me={docs.me}
          loading={docs.loading}
          upload={docs.upload}
          error={docs.error}
          onUpload={(file, region) => void docs.startUpload(file, region)}
          onDelete={(id) => void docs.remove(id)}
          onRetry={docs.retry}
        />
      </SheetContent>
    </Sheet>
  );
}
