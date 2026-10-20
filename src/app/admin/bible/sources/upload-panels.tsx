"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { startUpload, UploadError, type UploadHandle } from "@/lib/media/upload-client";
import { beginReferenceUpload, beginTextImport, processReference, processTextImport, type UploadBegin } from "./actions";

type Phase = { kind: "idle" } | { kind: "uploading"; sent: number; total: number } | { kind: "processing" } | { kind: "error"; message: string } | { kind: "done"; message: string };

/** Upload with progress and cancel, straight to private storage; then the server checks the file. */
function useUpload() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const handle = useRef<UploadHandle | null>(null);
  const run = async (file: File, begin: () => Promise<UploadBegin>, process: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setPhase({ kind: "uploading", sent: 0, total: file.size });
    const b = await begin();
    if (!b.ok) {
      setPhase({ kind: "error", message: b.message });
      return null;
    }
    handle.current = startUpload({ supabaseUrl: b.supabaseUrl, publishableKey: b.publishableKey, bucket: "bible", path: b.path, token: b.token, contentType: b.contentType }, file, (sent, total) =>
      setPhase({ kind: "uploading", sent, total }),
    );
    try {
      await handle.current.promise;
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof UploadError ? e.message : "The upload failed. Try again." });
      return null;
    }
    setPhase({ kind: "processing" });
    const r = await process(b.id);
    if (!r.ok) {
      setPhase({ kind: "error", message: r.message });
      return null;
    }
    return b.id;
  };
  return { phase, setPhase, run, cancel: () => handle.current?.cancel() };
}

function Status({ phase, cancel }: { phase: Phase; cancel: () => void }) {
  if (phase.kind === "idle") return null;
  return (
    <div role="status" className="space-y-2 text-meta">
      {phase.kind === "uploading" ? (
        <>
          <progress max={phase.total} value={phase.sent} className="w-full" aria-label="Upload progress" />
          <p>
            Uploading… {Math.round((phase.sent / Math.max(phase.total, 1)) * 100)}%{" "}
            <button type="button" onClick={cancel} className="ml-2 font-semibold text-primary underline">
              Cancel
            </button>
          </p>
        </>
      ) : phase.kind === "processing" ? (
        <p>Checking the file…</p>
      ) : phase.kind === "error" ? (
        <p className="font-semibold text-danger">{phase.message}</p>
      ) : (
        <p className="font-semibold text-success">{phase.message}</p>
      )}
    </div>
  );
}

export function TextImportPanel({ translationId }: { translationId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const { phase, run, cancel } = useUpload();
  const busy = phase.kind === "uploading" || phase.kind === "processing";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        const clientKey = crypto.randomUUID();
        const id = await run(file, () => beginTextImport({ translationId, name: file.name, size: file.size, clientKey }), processTextImport);
        if (id) router.push(`/admin/bible/sources/imports/${id}`);
      }}
    >
      <TextField
        label="Structured text file"
        name="file"
        type="file"
        accept=".csv,.tsv,.txt"
        required
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        hint="CSV or TSV with columns book, chapter, verse, text (optional heading, paragraph, poetry), or verse-per-line text (GEN 1:1 …). UTF-8, up to 50 MB."
      />
      <Status phase={phase} cancel={cancel} />
      <Button type="submit" variant="secondary" size="sm" disabled={!file || busy} loading={busy} loadingText="Working…">
        Upload and stage for review
      </Button>
    </form>
  );
}

export function ReferencePdfPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const { phase, setPhase, run, cancel } = useUpload();
  const busy = phase.kind === "uploading" || phase.kind === "processing";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        const fd = new FormData(e.currentTarget);
        const input = {
          name: file.name,
          size: file.size,
          type: file.type,
          clientKey: crypto.randomUUID(),
          translationLabel: String(fd.get("translation_label") ?? ""),
          source: String(fd.get("source") ?? ""),
          attribution: String(fd.get("attribution") ?? ""),
          rightsStatement: String(fd.get("rights_statement") ?? ""),
          confirmRights: fd.get("confirm_rights") === "on",
        };
        const id = await run(file, () => beginReferenceUpload(input), processReference);
        if (id) {
          setPhase({ kind: "done", message: "Saved as a reference file." });
          router.refresh();
        }
      }}
    >
      <TextField label="Translation" name="translation_label" required maxLength={120} />
      <TextField label="Where the file came from" name="source" required maxLength={300} hint="Publisher, website, or person who supplied it." />
      <TextField label="Attribution" name="attribution" optional maxLength={1000} />
      <TextAreaField label="Permission" name="rights_statement" required rows={2} maxLength={2000} hint="What allows the church to keep this file (for example a license or written permission). Uploading a PDF doesn't by itself grant the right to show its text." />
      <CheckboxField name="confirm_rights" label="I confirm the church may keep this file for administrators' reference." required />
      <TextField label="PDF" name="file" type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} hint="Up to 50 MB. Kept private to Bible source managers; never shown to members or downloadable publicly." />
      <Status phase={phase} cancel={cancel} />
      <Button type="submit" variant="secondary" size="sm" disabled={!file || busy} loading={busy} loadingText="Working…">
        Upload reference PDF
      </Button>
    </form>
  );
}
