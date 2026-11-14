import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UploadState } from "@/hooks/use-documents";
import { validatePdf } from "@/lib/documents-validation";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/documents/StatusBadge";

interface UploadSectionProps {
  /** Regions the user may upload into (from GET /me). */
  regions: string[];
  /** False until the user's profile has loaded. */
  ready: boolean;
  upload: UploadState;
  onUpload: (file: File, region: string) => void;
}

export function UploadSection({ regions, ready, upload, onUpload }: UploadSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [region, setRegion] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploading = upload.phase === "uploading";
  const noRegions = ready && regions.length === 0;
  const blocked = noRegions || uploading || !ready;
  // Exactly one region: preselected.
  const activeRegion = region || (regions.length === 1 ? (regions[0] ?? "") : "");

  function choose(picked: File | null | undefined) {
    if (!picked) return;
    const found = validatePdf(picked);
    if (found) {
      setFile(null);
      setProblem(found.message);
      return;
    }
    setProblem(null);
    setFile(picked);
  }

  function submit() {
    if (!file || !activeRegion) return;
    onUpload(file, activeRegion);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section aria-label="Upload a document" className="space-y-3">
      <div
        role="button"
        tabIndex={blocked ? -1 : 0}
        aria-disabled={blocked}
        onClick={() => !blocked && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!blocked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!blocked) choose(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring",
          dragging && "border-primary bg-primary/5",
          blocked && "cursor-not-allowed opacity-60",
        )}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{file ? file.name : "Drag a PDF here or choose a file"}</span>
        <span className="text-xs text-muted-foreground">PDF only, up to 20 MB</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      {noRegions ? (
        <p className="text-sm text-muted-foreground">
          Your user has no region to upload into, so uploads are turned off.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Select value={activeRegion} onValueChange={setRegion} disabled={blocked}>
            <SelectTrigger className="flex-1" aria-label="Region">
              <SelectValue placeholder="Choose a region" />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={submit} disabled={blocked || !file || !activeRegion}>
            Upload
          </Button>
        </div>
      )}

      {upload.phase === "uploading" ? (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{upload.filename}</span>
            <StatusBadge status="uploading" />
          </div>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.progress}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-(--brand-orange) transition-[width]"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
