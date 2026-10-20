"use client";

import { CircleCheck, CircleX, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { beginAssetUpload, cancelAssetUpload, finishAssetUpload, type BeginResult } from "@/app/admin/media/actions";
import { Button } from "@/components/ui/button";
import { ACCEPT, formatBytes, type AssetKind } from "@/lib/media/files";
import { probeMedia, startUpload, type UploadHandle } from "@/lib/media/upload-client";

type Row = {
  key: string;
  kind: AssetKind;
  language: string;
  file: File;
  title: string;
  state: "waiting" | "uploading" | "processing" | "done" | "failed" | "cancelled";
  sent: number;
  message: string | null;
  note?: string;
  assetId?: string;
  begun?: Extract<BeginResult, { ok: true }>;
  retryable?: boolean;
};

const KIND_HELP: Record<AssetKind, string> = {
  audio: "MP3 or M4A (AAC). Mono 64–96 kbps is plenty for speech.",
  video: "MP4 with H.264 video and AAC audio (plays in every browser). Large videos are better on YouTube or Vimeo while the church is on the free storage plan.",
  image: "JPEG, PNG, WebP, or HEIC. Re-encoded without location or camera data.",
  document: "PDF handouts or PowerPoint (.pptx) slides without macros.",
  captions: "WebVTT (.vtt) caption file.",
};

/**
 * Uploads straight from this device to private storage (resumable for large
 * files), then the server checks the stored bytes and finishes processing.
 * Each file can be cancelled or retried; nothing is published by uploading.
 */
export function UploadPanel({
  kinds,
  limitsMb,
  parentId,
  defaultKind,
}: {
  kinds: AssetKind[];
  limitsMb: Partial<Record<AssetKind, number>>;
  parentId?: string;
  defaultKind?: AssetKind;
}) {
  const [kind, setKind] = useState<AssetKind>(defaultKind ?? kinds[0]);
  const [rows, setRows] = useState<Row[]>([]);
  const [language, setLanguage] = useState("en");
  const handles = useRef(new Map<string, UploadHandle>());
  const inputId = useId();
  const router = useRouter();

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function run(row: Row) {
    const kind = row.kind;
    if (row.file.size > (limitsMb[kind] ?? 50) * 1024 * 1024) {
      update(row.key, { state: "failed", message: `Larger than the ${limitsMb[kind] ?? 50} MB limit for this kind of file.`, retryable: false });
      return;
    }
    update(row.key, { state: "uploading", message: null, sent: 0 });
    const probe = kind === "audio" || kind === "video" ? await probeMedia(row.file) : { duration: null, width: null, height: null, playable: true };
    let begun = row.begun;
    if (!begun) {
      const r = await beginAssetUpload({
        kind,
        title: row.title,
        name: row.file.name,
        type: row.file.type,
        size: row.file.size,
        clientKey: row.key,
        parentId: parentId ?? null,
        language: kind === "captions" ? row.language : null,
      });
      if (!r.ok) {
        update(row.key, { state: "failed", message: r.message, retryable: false });
        return;
      }
      begun = r;
      update(row.key, { begun: r, assetId: r.id });
    }
    const handle = startUpload(
      { supabaseUrl: begun.supabaseUrl, publishableKey: begun.publishableKey, bucket: "media", path: begun.path, token: begun.token, contentType: begun.contentType },
      row.file,
      (sent) => update(row.key, { sent }),
    );
    handles.current.set(row.key, handle);
    try {
      await handle.promise;
    } catch (err) {
      const e = err as { message?: string; retryable?: boolean };
      update(row.key, { state: "failed", message: e.message ?? "The upload failed.", retryable: e.retryable ?? true });
      return;
    } finally {
      handles.current.delete(row.key);
    }
    update(row.key, { state: "processing", sent: row.file.size });
    const done = await finishAssetUpload(begun.id, probe);
    if (!done.ok) {
      update(row.key, { state: "failed", message: done.message, retryable: false });
      return;
    }
    update(row.key, { state: "done", note: done.note });
    router.refresh();
  }

  function add(files: FileList | null) {
    if (!files?.length) return;
    const next: Row[] = Array.from(files).map((file) => ({
      key: crypto.randomUUID(),
      kind,
      language,
      file,
      title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 160) || "Untitled",
      state: "waiting",
      sent: 0,
      message: null,
    }));
    setRows((rs) => [...next, ...rs]);
    // Uploads run one after another so a slow connection isn't overwhelmed.
    void next.reduce((p, r) => p.then(() => run(r)), Promise.resolve());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {kinds.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor={`${inputId}-kind`} className="block font-semibold">
              Kind of file
            </label>
            <select
              id={`${inputId}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as AssetKind)}
              className="min-h-12 rounded-control border border-border-strong bg-surface px-3"
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k === "audio" ? "Audio" : k === "video" ? "Video" : k === "image" ? "Image" : k === "document" ? "Document" : "Captions"}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {kind === "captions" ? (
          <div className="space-y-1.5">
            <label htmlFor={`${inputId}-lang`} className="block font-semibold">
              Language code
            </label>
            <input
              id={`${inputId}-lang`}
              value={language}
              onChange={(e) => setLanguage(e.target.value.trim().slice(0, 12))}
              className="min-h-12 w-28 rounded-control border border-border-strong bg-surface px-3"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
            <Upload className="size-5" aria-hidden="true" />
            Choose files
          </label>
          <input
            id={inputId}
            type="file"
            multiple={kind !== "captions"}
            accept={ACCEPT[kind]}
            className="sr-only"
            aria-describedby={`${inputId}-help`}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p id={`${inputId}-help`} className="text-meta text-text-secondary">
        {KIND_HELP[kind]} Up to {limitsMb[kind] ?? 50} MB each.
      </p>
      {rows.length ? (
        <ul className="space-y-2" aria-live="polite">
          {rows.map((r) => {
            const pct = r.file.size ? Math.round((r.sent / r.file.size) * 100) : 0;
            return (
              <li key={r.key} className="rounded-tile border border-border bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0" aria-hidden="true">
                    {r.state === "done" ? (
                      <CircleCheck className="size-5 text-success" />
                    ) : r.state === "failed" || r.state === "cancelled" ? (
                      <CircleX className="size-5 text-danger" />
                    ) : (
                      <LoaderCircle className="size-5 animate-spin text-primary motion-reduce:animate-none" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.file.name}</span>
                  <span className="text-meta text-text-secondary">{formatBytes(r.file.size)}</span>
                  {r.state === "uploading" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X className="size-4" aria-hidden="true" />}
                      onClick={() => {
                        handles.current.get(r.key)?.cancel();
                        update(r.key, { state: "cancelled", message: "Cancelled." });
                        if (r.begun) void cancelAssetUpload(r.begun.id, r.begun.path);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {r.state === "failed" && r.retryable ? (
                    <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => void run(r)}>
                      Retry
                    </Button>
                  ) : null}
                  {r.state === "done" && r.assetId ? (
                    <Link href={`/admin/media/${r.assetId}`} className="inline-flex min-h-11 items-center px-2 font-semibold text-primary hover:underline">
                      Details and rights
                    </Link>
                  ) : null}
                </div>
                {r.state === "uploading" || r.state === "processing" ? (
                  <div className="mt-2">
                    <progress className="h-2 w-full accent-[var(--color-accent)]" max={100} value={r.state === "processing" ? 100 : pct} aria-label={`Upload progress for ${r.file.name}`} />
                    <p className="text-[0.8125rem] text-text-secondary">{r.state === "processing" ? "Checking the file…" : `${pct}% uploaded`}</p>
                  </div>
                ) : null}
                {r.message ? <p className={r.state === "failed" ? "mt-1 text-meta text-danger" : "mt-1 text-meta text-text-secondary"}>{r.message}</p> : null}
                {r.note ? <p className="mt-1 text-meta text-text-secondary">{r.note}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
