"use client";

import { CircleCheck, CircleX, ImagePlus, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { beginPhotoUpload, cancelPhotoUpload, processPhoto, type PhotoBegin } from "@/app/(member)/gallery/actions";
import { Button } from "@/components/ui/button";
import { ACCEPT, formatBytes } from "@/lib/media/files";
import { startUpload, type UploadHandle } from "@/lib/media/upload-client";

type Row = {
  key: string;
  file: File;
  caption: string;
  alt: string;
  state: "ready" | "uploading" | "processing" | "done" | "failed" | "cancelled";
  sent: number;
  message: string | null;
  begun?: Extract<PhotoBegin, { ok: true }>;
  /** The upload itself was interrupted and can resume with the same link. */
  resumable?: boolean;
};

/**
 * Members add photos to an album: choose, describe (caption and a short
 * description for people using screen readers), confirm permission, then
 * upload. Each photo goes straight from the device to restricted storage,
 * is cleaned of location and camera data on the server, and waits for a
 * moderator. Uploads can be cancelled and retried without duplicates.
 */
export function PhotoUploader({ albumId, fileMb, batchMax }: { albumId: string; fileMb: number; batchMax: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const handles = useRef(new Map<string, UploadHandle>());
  const batch = useRef<string>("");
  const id = useId();
  const router = useRouter();

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function run(row: Row): Promise<boolean> {
    if (row.file.size > fileMb * 1024 * 1024) {
      update(row.key, { state: "failed", message: `Larger than the ${fileMb} MB limit.`, resumable: false });
      return false;
    }
    update(row.key, { state: "uploading", message: null, sent: 0 });
    let begun = row.resumable ? row.begun : undefined;
    if (!begun) {
      const r = await beginPhotoUpload({ albumId, clientKey: row.key, batchKey: batch.current, name: row.file.name, type: row.file.type, size: row.file.size, permission });
      if (!r.ok) {
        update(row.key, { state: "failed", message: r.message, resumable: false });
        return false;
      }
      if (r.status === "pending") {
        update(row.key, { state: "done", begun: r, sent: row.file.size });
        return true;
      }
      if (r.status !== "uploading") {
        update(row.key, { state: "failed", message: "This photo couldn't be added. Try again.", resumable: false });
        return false;
      }
      begun = r;
      update(row.key, { begun: r });
    }
    const handle = startUpload(
      { supabaseUrl: begun.supabaseUrl, publishableKey: begun.publishableKey, bucket: "media-uploads", path: begun.path, token: begun.token, contentType: begun.contentType },
      row.file,
      (sent) => update(row.key, { sent }),
    );
    handles.current.set(row.key, handle);
    try {
      await handle.promise;
    } catch (err) {
      const e = err as { message?: string; retryable?: boolean };
      // A cancelled row was already marked by the Cancel button.
      setRows((rs) => rs.map((r) => (r.key === row.key && r.state !== "cancelled" ? { ...r, state: "failed", message: e.message ?? "The upload failed.", resumable: e.retryable ?? true } : r)));
      return false;
    } finally {
      handles.current.delete(row.key);
    }
    update(row.key, { state: "processing", sent: row.file.size });
    const done = await processPhoto(begun.id, row.caption, row.alt);
    if (!done.ok) {
      update(row.key, { state: "failed", message: done.message, resumable: false });
      return false;
    }
    update(row.key, { state: "done" });
    return true;
  }

  async function uploadAll(list: Row[]) {
    setBusy(true);
    setNotice(null);
    batch.current = crypto.randomUUID();
    let ok = 0;
    // One after another, so a slow connection isn't overwhelmed.
    for (const r of list) if (await run(r)) ok += 1;
    setBusy(false);
    if (ok) {
      setNotice(`${ok} ${ok === 1 ? "photo is" : "photos are"} waiting for a moderator. You'll get a notification when they're reviewed.`);
      router.refresh();
    }
  }

  function retry(row: Row) {
    // An interrupted upload resumes; anything else starts over as a new photo.
    const next = row.resumable ? row : { ...row, key: crypto.randomUUID(), begun: undefined };
    setRows((rs) => rs.map((r) => (r.key === row.key ? next : r)));
    void uploadAll([next]);
  }

  const ready = rows.filter((r) => r.state === "ready");

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id} className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
          <ImagePlus className="size-5" aria-hidden="true" /> Choose photos
        </label>
        <input
          id={id}
          type="file"
          multiple
          accept={ACCEPT.image}
          className="sr-only"
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).slice(0, batchMax);
            e.target.value = "";
            if (!files.length) return;
            setRows((rs) => [...rs, ...files.map((file) => ({ key: crypto.randomUUID(), file, caption: "", alt: "", state: "ready" as const, sent: 0, message: null }))]);
          }}
        />
        <p id={`${id}-help`} className="mt-1.5 text-meta text-text-secondary">
          JPEG, PNG, WebP, or iPhone (HEIC) photos up to {fileMb} MB, {batchMax} at a time. Location and camera details are removed. A moderator reviews every
          photo before others can see it.
        </p>
      </div>

      {rows.length ? (
        <ul className="space-y-3" aria-live="polite">
          {rows.map((r) => {
            const pct = r.file.size ? Math.round((r.sent / r.file.size) * 100) : 0;
            return (
              <li key={r.key} className="rounded-tile border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0" aria-hidden="true">
                    {r.state === "done" ? (
                      <CircleCheck className="size-5 text-success" />
                    ) : r.state === "failed" || r.state === "cancelled" ? (
                      <CircleX className="size-5 text-danger" />
                    ) : r.state === "ready" ? (
                      <ImagePlus className="size-5 text-text-secondary" />
                    ) : (
                      <LoaderCircle className="size-5 animate-spin text-primary motion-reduce:animate-none" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.file.name}</span>
                  <span className="text-meta text-text-secondary">{formatBytes(r.file.size)}</span>
                  {r.state === "ready" ? (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      Remove<span className="sr-only"> {r.file.name}</span>
                    </Button>
                  ) : null}
                  {r.state === "uploading" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X className="size-4" aria-hidden="true" />}
                      onClick={() => {
                        update(r.key, { state: "cancelled", message: "Cancelled.", resumable: false });
                        handles.current.get(r.key)?.cancel();
                        if (r.begun) void cancelPhotoUpload(r.begun.id, r.begun.path);
                      }}
                    >
                      Cancel<span className="sr-only"> {r.file.name}</span>
                    </Button>
                  ) : null}
                  {(r.state === "failed" || r.state === "cancelled") && !busy ? (
                    <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => retry(r)} disabled={!permission}>
                      Retry<span className="sr-only"> {r.file.name}</span>
                    </Button>
                  ) : null}
                </div>
                {r.state === "ready" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-meta font-semibold">Caption (optional)</span>
                      <input value={r.caption} maxLength={500} onChange={(e) => update(r.key, { caption: e.target.value })} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-meta font-semibold">Describe the photo for screen readers (optional)</span>
                      <input value={r.alt} maxLength={500} onChange={(e) => update(r.key, { alt: e.target.value })} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                    </label>
                  </div>
                ) : null}
                {r.state === "uploading" || r.state === "processing" ? (
                  <div className="mt-2">
                    <progress className="h-2 w-full accent-[var(--color-accent)]" max={100} value={r.state === "processing" ? 100 : pct} aria-label={`Upload progress for ${r.file.name}`} />
                    <p className="text-[0.8125rem] text-text-secondary">{r.state === "processing" ? "Removing location data and preparing the photo…" : `${pct}% uploaded`}</p>
                  </div>
                ) : null}
                {r.state === "done" ? <p className="mt-1 text-meta text-text-secondary">Waiting for a moderator.</p> : null}
                {r.message ? <p className={r.state === "failed" ? "mt-1 text-meta text-danger" : "mt-1 text-meta text-text-secondary"}>{r.message}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows.length ? (
        <div className="space-y-3 rounded-tile bg-surface-muted p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} className="mt-1 size-5 shrink-0 accent-primary" />
            <span>
              I took these photos or have permission to share them, and the people in them (and a parent, for any children) are okay with them being shared
              with this album&apos;s members.
            </span>
          </label>
          <Button onClick={() => void uploadAll(ready)} disabled={!permission || busy || !ready.length}>
            {busy ? "Uploading…" : `Upload ${ready.length || ""} ${ready.length === 1 ? "photo" : "photos"}`.replace("  ", " ")}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="font-semibold text-success">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
