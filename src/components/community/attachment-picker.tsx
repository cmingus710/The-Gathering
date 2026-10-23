"use client";

/* eslint-disable @next/next/no-img-element -- previews are local object URLs of the chosen files. */
import { CircleCheck, CircleX, Crop, ImagePlus, LoaderCircle, RotateCcw, Trash2, Video, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { beginAttachment, discardAttachment, processAttachment, type AttachmentBegin } from "@/app/(app)/(member)/community/attachment-actions";
import { OPTIONAL_SHAPES, OptionalCropDialog, type OptionalCrop } from "@/components/media/image-cropper";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, checkForumVideo, classifyAttachment } from "@/lib/community/attachments";
import { formatBytes } from "@/lib/media/files";
import type { Framing } from "@/lib/media/framing";
import { probeMedia, startUpload, type UploadHandle } from "@/lib/media/upload-client";

type Begun = Extract<AttachmentBegin, { ok: true }>;
type Item = {
  key: string;
  /** What is uploaded: the original, or a cropped copy of it. */
  file: File;
  /** The photo as chosen; cropping always starts again from it. */
  original: File;
  shapeId?: string;
  framing?: Framing;
  note?: string | null;
  kind: "image" | "video";
  preview: string | null;
  previewFailed?: boolean;
  state: "checking" | "uploading" | "processing" | "ready" | "failed";
  sent: number;
  message: string | null;
  retryable: boolean;
  begun?: Begun;
  alt: string;
};

const WINDOW = 1024 * 1024;

/** The same H.264 check the server runs, on the chosen file, before uploading. */
async function checkVideoFile(file: File) {
  const head = new Uint8Array(await file.slice(0, WINDOW).arrayBuffer());
  const tail = file.size > WINDOW ? new Uint8Array(await file.slice(Math.max(WINDOW, file.size - WINDOW)).arrayBuffer()) : undefined;
  return checkForumVideo(head, tail);
}

/**
 * "Add photos or video" for the discussion and reply composers. Each file
 * uploads straight from the device to restricted storage as soon as it's
 * chosen (one at a time), then the server removes location data from
 * photos and checks videos. Ready files are posted with the form as
 * hidden attachmentId/attachmentAlt fields, in the order shown. Files can
 * be cancelled, retried, or removed before posting; removed files are
 * deleted at once.
 */
export function AttachmentPicker({
  onBusyChange,
  onCountChange,
  disabled = false,
  compact = false,
}: {
  onBusyChange?: (busy: boolean) => void;
  /** Files chosen (any state), so a composer can warn before discarding them. */
  onCountChange?: (count: number) => void;
  disabled?: boolean;
  /** Small "Photo/video" button with the limits behind an "Upload guidelines" toggle (feed composers). */
  compact?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const [batchKey] = useState(() => crypto.randomUUID());
  const registered = useRef(new Map<string, string>());
  const handles = useRef(new Map<string, UploadHandle>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const removed = useRef(new Set<string>());
  const id = useId();

  const busy = items.some((i) => i.state === "checking" || i.state === "uploading" || i.state === "processing");
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => onCountChange?.(items.length), [items.length, onCountChange]);

  // Previews are local object URLs: free them when the composer goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function run(item: Item) {
    if (removed.current.has(item.key)) return;
    update(item.key, { state: "uploading", message: null, sent: 0 });
    let dims: { width: number | null; height: number | null; duration: number | null } = { width: null, height: null, duration: null };
    if (item.kind === "video") {
      const probe = await probeMedia(item.file);
      dims = { width: probe.width, height: probe.height, duration: probe.duration };
    }
    // Same key every time: a retry continues the same upload, never a duplicate.
    const begun = await beginAttachment({ batchKey, clientKey: item.key, name: item.file.name, type: item.file.type, size: item.file.size, ...dims });
    if (begun.ok) registered.current.set(item.key, begun.id);
    if (removed.current.has(item.key)) {
      // Cancelled while the server was registering it.
      if (begun.ok) void discardAttachment(begun.id);
      return;
    }
    if (!begun.ok) return update(item.key, { state: "failed", message: begun.message, retryable: false });
    update(item.key, { begun });
    if (begun.status === "ready") return update(item.key, { state: "ready", sent: item.file.size });
    if (begun.status === "uploading") {
      const handle = startUpload(
        { supabaseUrl: begun.supabaseUrl, publishableKey: begun.publishableKey, bucket: begun.bucket, path: begun.path, token: begun.token, contentType: begun.contentType },
        item.file,
        (sent) => update(item.key, { sent }),
      );
      handles.current.set(item.key, handle);
      try {
        await handle.promise;
      } catch (err) {
        if (removed.current.has(item.key)) return;
        const e = err as { message?: string; retryable?: boolean };
        return update(item.key, { state: "failed", message: e.message ?? "The upload failed.", retryable: e.retryable ?? true });
      } finally {
        handles.current.delete(item.key);
      }
    } else if (begun.status !== "processing" && begun.status !== "failed") {
      return update(item.key, { state: "failed", message: "This file couldn't be added. Remove it and try again.", retryable: false });
    }
    if (removed.current.has(item.key)) return;
    update(item.key, { state: "processing", sent: item.file.size });
    const done = await processAttachment(begun.id);
    if (removed.current.has(item.key)) return;
    if (!done.ok) return update(item.key, { state: "failed", message: done.message, retryable: done.retryable, begun: done.retryable ? begun : undefined });
    update(item.key, { state: "ready" });
  }

  const enqueue = (item: Item) => {
    queue.current = queue.current.then(() => run(item)).catch(() => update(item.key, { state: "failed", message: "The upload failed. Try again.", retryable: true }));
  };

  async function add(files: File[]) {
    setNotice(null);
    const active = items.filter((i) => i.state !== "failed");
    let room = ATTACHMENT_LIMITS.perPost - active.length;
    let videos = active.filter((i) => i.kind === "video").length;
    const next: Item[] = [];
    const queued: Item[] = [];
    for (const file of files) {
      if (room <= 0) {
        setNotice(`You can add up to ${ATTACHMENT_LIMITS.perPost} photos or videos to one post.`);
        break;
      }
      const key = crypto.randomUUID();
      const kind = classifyAttachment(file.name, file.type, file.size);
      const base = { key, file, original: file, sent: 0, alt: "", retryable: false, preview: null } as const;
      if (!kind.ok) {
        next.push({ ...base, kind: file.type.startsWith("video/") ? "video" : "image", state: "failed", message: kind.message });
        continue;
      }
      if (kind.kind === "video" && videos >= ATTACHMENT_LIMITS.videosPerPost) {
        next.push({ ...base, kind: "video", state: "failed", message: `You can add up to ${ATTACHMENT_LIMITS.videosPerPost} videos to one post.` });
        continue;
      }
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      const item: Item = { ...base, kind: kind.kind, preview, state: "checking", message: null };
      next.push(item);
      queued.push(item);
      room -= 1;
      if (kind.kind === "video") videos += 1;
    }
    setItems((list) => [...list, ...next]);
    for (const item of queued) {
      if (item.kind === "video") {
        const checked = await checkVideoFile(item.file).catch(() => ({ ok: true as const }));
        if (!checked.ok) {
          update(item.key, { state: "failed", message: checked.message, retryable: false });
          continue;
        }
      }
      enqueue(item);
    }
  }

  /** Stops an item's upload and deletes whatever it already stored. */
  function release(item: Item) {
    removed.current.add(item.key);
    handles.current.get(item.key)?.cancel();
    if (item.preview) {
      URL.revokeObjectURL(item.preview);
      previews.current.delete(item.preview);
    }
    // Deletes the draft and anything already stored (also when cancelling
    // mid-upload). Not registered yet: run() discards it when it is.
    const registeredId = registered.current.get(item.key);
    if (registeredId) void discardAttachment(registeredId);
  }

  function remove(item: Item) {
    release(item);
    setItems((list) => list.filter((i) => i.key !== item.key));
  }

  /**
   * Uses a cropped copy (or the whole original again) in the same place:
   * the new file uploads as a new attachment with the same description, and
   * the previous upload is deleted.
   */
  function recrop(item: Item, crop: OptionalCrop) {
    setCropping(null);
    if (crop.file === item.file) return update(item.key, { shapeId: crop.shapeId, framing: crop.framing });
    const kind = classifyAttachment(crop.file.name, crop.file.type, crop.file.size);
    if (!kind.ok || kind.kind !== "image") return update(item.key, { note: kind.ok ? "That crop couldn't be used." : kind.message });
    const preview = URL.createObjectURL(crop.file);
    previews.current.add(preview);
    const next: Item = {
      key: crypto.randomUUID(),
      file: crop.file,
      original: item.original,
      shapeId: crop.shapeId,
      framing: crop.framing,
      kind: "image",
      preview,
      state: "checking",
      sent: 0,
      message: null,
      retryable: false,
      alt: item.alt,
    };
    release(item);
    setItems((list) => list.map((i) => (i.key === item.key ? next : i)));
    enqueue(next);
  }

  function retry(item: Item) {
    removed.current.delete(item.key);
    enqueue(item);
  }

  const ready = items.filter((i) => i.state === "ready" && i.begun);
  const cropItem = items.find((i) => i.key === cropping && i.kind === "image") ?? null;

  return (
    <div className="space-y-3">
      <div>
        <input
          id={id}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="peer sr-only"
          aria-describedby={`${id}-help`}
          disabled={disabled}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void add(files);
          }}
        />
        {compact ? (
          <div className="flex flex-wrap items-center gap-x-1 peer-focus-visible:[&>label]:ring-2 peer-focus-visible:[&>label]:ring-primary peer-disabled:[&>label]:cursor-not-allowed peer-disabled:[&>label]:opacity-60">
            <label
              htmlFor={id}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-meta font-semibold text-text-secondary hover:bg-surface-muted hover:text-text"
            >
              <ImagePlus className="size-5 text-primary" aria-hidden="true" /> Photo/video
            </label>
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-full px-3 text-meta text-text-secondary underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                Upload guidelines
              </summary>
              <p id={`${id}-help`} className="max-w-prose px-3 pb-1 text-meta text-text-secondary">
                Up to {ATTACHMENT_LIMITS.perPost} per post. Photos: JPEG, PNG, WebP, or iPhone (HEIC) up to {ATTACHMENT_LIMITS.imageMb} MB; location and camera details
                are removed. Video: MP4 (H.264) up to {ATTACHMENT_LIMITS.videoMb} MB, {ATTACHMENT_LIMITS.videosPerPost} per post. Only people who can read this
                discussion can see them.
              </p>
            </details>
          </div>
        ) : (
          <>
            <label
              htmlFor={id}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-surface px-4 font-semibold text-text-primary hover:bg-surface-muted peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
            >
              <ImagePlus className="size-5" aria-hidden="true" /> Add photos or video
            </label>
            <p id={`${id}-help`} className="mt-1.5 text-meta text-text-secondary">
              Up to {ATTACHMENT_LIMITS.perPost} per post. Photos: JPEG, PNG, WebP, or iPhone (HEIC) up to {ATTACHMENT_LIMITS.imageMb} MB; location and camera details
              are removed. Video: MP4 (H.264) up to {ATTACHMENT_LIMITS.videoMb} MB, {ATTACHMENT_LIMITS.videosPerPost} per post. Only people who can read this
              discussion can see them.
            </p>
          </>
        )}
      </div>

      {items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Photos and videos for this post">
          {items.map((item) => {
            const pct = item.file.size ? Math.round((item.sent / item.file.size) * 100) : 0;
            const name = item.original.name;
            return (
              <li key={item.key} className="rounded-tile border border-border bg-surface p-3">
                <div className="flex items-start gap-3">
                  <div className="size-20 shrink-0 overflow-hidden rounded-control bg-surface-muted">
                    {item.preview && item.kind === "image" && !item.previewFailed ? (
                      <img src={item.preview} alt="" className="size-full object-cover" onError={() => update(item.key, { previewFailed: true })} />
                    ) : item.preview && item.kind === "video" && item.state !== "failed" ? (
                      <video src={item.preview} controls preload="metadata" playsInline muted className="size-full bg-black object-cover" aria-label={`Preview of ${name}`} />
                    ) : (
                      <span className="flex size-full items-center justify-center text-text-secondary" aria-hidden="true">
                        {item.kind === "video" ? <Video className="size-6" /> : <ImagePlus className="size-6" />}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="shrink-0" aria-hidden="true">
                        {item.state === "ready" ? (
                          <CircleCheck className="size-4 text-success" />
                        ) : item.state === "failed" ? (
                          <CircleX className="size-4 text-danger" />
                        ) : (
                          <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" />
                        )}
                      </span>
                      <span className="truncate font-semibold">{name}</span>
                    </p>
                    <p className="text-[0.8125rem] text-text-secondary">
                      {formatBytes(item.file.size)}
                      {item.kind === "image" && item.shapeId && item.shapeId !== "whole"
                        ? ` · Cropped to ${OPTIONAL_SHAPES.find((s) => s.id === item.shapeId)?.label.toLowerCase() ?? "a shape"}`
                        : ""}
                    </p>
                    {item.state === "uploading" || item.state === "processing" || item.state === "checking" ? (
                      <div className="mt-1" aria-live="polite">
                        <progress className="h-2 w-full accent-[var(--color-accent)]" max={100} value={item.state === "processing" ? 100 : pct} aria-label={`Upload progress for ${name}`} />
                        <p className="text-[0.8125rem] text-text-secondary">
                          {item.state === "checking"
                            ? "Getting ready…"
                            : item.state === "processing"
                              ? item.kind === "image"
                                ? "Removing location data and preparing the photo…"
                                : "Checking the video…"
                              : `${pct}% uploaded`}
                        </p>
                      </div>
                    ) : null}
                    {item.state === "ready" ? <p className="text-[0.8125rem] text-success">Ready to post</p> : null}
                    {item.message ? (
                      <p role="alert" className="mt-1 text-meta text-danger">
                        {item.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                {item.kind === "image" && item.state !== "failed" ? (
                  <label className="mt-3 block space-y-1">
                    <span className="text-meta font-semibold">Describe this photo (for people using screen readers)</span>
                    <input
                      value={item.alt}
                      maxLength={ATTACHMENT_LIMITS.altMax}
                      onChange={(e) => update(item.key, { alt: e.target.value })}
                      className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3"
                    />
                  </label>
                ) : null}
                {item.note ? <p className="mt-1 text-meta text-text-secondary">{item.note}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.kind === "image" && (item.state !== "failed" || item.retryable) ? (
                    <Button size="sm" variant="secondary" icon={<Crop className="size-4" aria-hidden="true" />} onClick={() => setCropping(item.key)} aria-haspopup="dialog" disabled={disabled}>
                      {item.shapeId && item.shapeId !== "whole" ? "Edit crop" : "Crop"}
                      <span className="sr-only"> {name}</span>
                    </Button>
                  ) : null}
                  {item.state === "failed" && item.retryable ? (
                    <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => retry(item)}>
                      Retry<span className="sr-only"> {name}</span>
                    </Button>
                  ) : null}
                  {item.state === "uploading" || item.state === "checking" || item.state === "processing" ? (
                    <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={() => remove(item)}>
                      Cancel<span className="sr-only"> {name}</span>
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => remove(item)}>
                      Remove<span className="sr-only"> {name}</span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {notice ? (
        <p role="status" className="text-meta text-text-secondary">
          {notice}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-meta text-text-secondary">
          You can post once your photos and videos finish uploading.
        </p>
      ) : null}
      {cropItem ? (
        <OptionalCropDialog
          key={cropItem.key}
          original={cropItem.original}
          shapeId={cropItem.shapeId}
          framing={cropItem.framing}
          onCancel={() => setCropping(null)}
          onUnsupported={(note) => {
            update(cropItem.key, { note });
            setCropping(null);
          }}
          onDone={(crop) => recrop(cropItem, crop)}
        />
      ) : null}
      {ready.map((item) => (
        <span key={item.key} hidden>
          <input type="hidden" name="attachmentId" value={item.begun!.id} />
          <input type="hidden" name="attachmentAlt" value={item.kind === "image" ? item.alt : ""} />
        </span>
      ))}
    </div>
  );
}
