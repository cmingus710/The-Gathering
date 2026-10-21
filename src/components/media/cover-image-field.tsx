"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { ImagePlus, Images, LoaderCircle, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { beginAssetUpload, cancelAssetUpload, finishAssetUpload, type BeginResult } from "@/app/admin/media/actions";
import { describeLibraryImage, listLibraryImages, type ImageChoice } from "@/app/admin/media/picker-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { TextField } from "@/components/ui/field";
import { ACCEPT, formatBytes } from "@/lib/media/files";
import { startUpload, type UploadHandle } from "@/lib/media/upload-client";

type UploadState =
  | { state: "idle" }
  | { state: "uploading" | "processing"; file: File; sent: number; begun?: Extract<BeginResult, { ok: true }> }
  | { state: "failed"; file: File; message: string; begun?: Extract<BeginResult, { ok: true }> };

const titleFrom = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 160) || "Untitled";

/**
 * A cover image picker for editor forms: upload from this device (through the
 * media library's own pipeline, so the file becomes a reusable library image)
 * or choose an existing library image, with a preview. Only the hidden
 * `name` input is submitted, so nothing changes until the form is saved:
 * a new cover replaces the old one only after it finished uploading, and
 * removing a cover only detaches it (the library image is kept).
 */
export function CoverImageField({
  name,
  defaultAssetId,
  altName,
  defaultAlt = "",
  canUpload,
  maxUploadMb,
  saveLabel,
  label = "Cover image",
  onChange,
}: {
  /** Form field that carries the chosen asset id ("" for none). */
  name: string;
  defaultAssetId: string | null | undefined;
  /** Form field for this content's own image description; omit when the form has none. */
  altName?: string;
  defaultAlt?: string;
  /** Uploading needs the media manager role (checked again on the server). */
  canUpload: boolean;
  maxUploadMb?: number;
  /** The form's save button text, for the "not saved yet" reminder. */
  saveLabel: string;
  label?: string;
  onChange?: (image: ImageChoice | null) => void;
}) {
  const id = useId();
  const [savedId] = useState(defaultAssetId ?? "");
  const [assetId, setAssetId] = useState(defaultAssetId ?? "");
  const currentId = useRef(assetId);
  const [image, setImage] = useState<ImageChoice | null>(null);
  const [loadingImage, setLoadingImage] = useState(!!defaultAssetId);
  const [alt, setAlt] = useState(defaultAlt);
  const [altBefore] = useState(defaultAlt);
  const [upload, setUpload] = useState<UploadState>({ state: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const handle = useRef<UploadHandle | null>(null);
  /** Bumped by Cancel, so an upload still starting doesn't carry on afterwards. */
  const attempt = useRef(0);
  const refreshed = useRef(false);
  const limitMb = maxUploadMb ?? 25;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Preview of the saved cover (signed links are fetched, never stored).
  useEffect(() => {
    if (!savedId) return;
    let live = true;
    describeLibraryImage(savedId)
      .then((img) => {
        // Skip if another image was chosen meanwhile.
        if (!live || currentId.current !== savedId) return;
        setImage(img);
        onChangeRef.current?.(img);
      })
      .catch(() => undefined)
      .finally(() => live && setLoadingImage(false));
    return () => {
      live = false;
    };
  }, [savedId]);

  const choose = useCallback((img: ImageChoice | null) => {
    currentId.current = img?.id ?? "";
    setAssetId(img?.id ?? "");
    setImage(img);
    refreshed.current = false;
    onChangeRef.current?.(img);
  }, []);

  async function run(file: File, previous?: Extract<BeginResult, { ok: true }>) {
    if (file.size > limitMb * 1024 * 1024) {
      setUpload({ state: "failed", file, message: `That image is ${formatBytes(file.size)}. The limit is ${limitMb} MB.` });
      return;
    }
    const n = ++attempt.current;
    setUpload({ state: "uploading", file, sent: 0, begun: previous });
    let begun = previous;
    try {
      if (!begun) {
        const r = await beginAssetUpload({
          kind: "image",
          title: titleFrom(file.name),
          name: file.name,
          type: file.type,
          size: file.size,
          clientKey: crypto.randomUUID(),
        });
        if (n !== attempt.current) {
          if (r.ok) void cancelAssetUpload(r.id, r.path);
          return;
        }
        if (!r.ok) {
          setUpload({ state: "failed", file, message: r.message });
          return;
        }
        begun = r;
        setUpload((u) => (u.state === "uploading" ? { ...u, begun: r } : u));
      }
      const b = begun;
      handle.current = startUpload(
        { supabaseUrl: b.supabaseUrl, publishableKey: b.publishableKey, bucket: "media", path: b.path, token: b.token, contentType: b.contentType },
        file,
        (sent) => setUpload((u) => (u.state === "uploading" ? { ...u, sent } : u)),
      );
      try {
        await handle.current.promise;
      } catch (err) {
        const e = err as { message?: string; retryable?: boolean };
        if (e.message === "Upload cancelled.") return;
        // A retryable transfer resumes with the same upload; anything else starts over.
        setUpload({ state: "failed", file, message: e.message ?? "The upload failed.", begun: e.retryable ? b : undefined });
        return;
      } finally {
        handle.current = null;
      }
      if (n !== attempt.current) return;
      setUpload({ state: "processing", file, sent: file.size, begun: b });
      const done = await finishAssetUpload(b.id, { duration: null, width: null, height: null });
      if (n !== attempt.current) return;
      if (!done.ok) {
        setUpload({ state: "failed", file, message: done.message });
        return;
      }
      const img = await describeLibraryImage(done.id);
      if (n !== attempt.current) return;
      choose(img ?? { id: done.id, title: titleFrom(file.name), alt_text: "", width: null, height: null, public_ok: false, status: "ready", url: null });
      setUpload({ state: "idle" });
    } catch {
      if (n === attempt.current) setUpload({ state: "failed", file, message: "The connection to the server was lost. Try again." });
    }
  }

  function pick(files: FileList | null | undefined) {
    const file = files?.[0];
    if (!file || upload.state === "uploading" || upload.state === "processing") return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)) {
      setUpload({ state: "failed", file, message: "Choose a JPEG, PNG, WebP, or HEIC image." });
      return;
    }
    void run(file);
  }

  function cancel() {
    if (upload.state !== "uploading") return;
    attempt.current++;
    handle.current?.cancel();
    if (upload.begun) void cancelAssetUpload(upload.begun.id, upload.begun.path);
    setUpload({ state: "idle" });
  }

  const busy = upload.state === "uploading" || upload.state === "processing";
  const changed = assetId !== savedId;
  const pct = busy && upload.file.size ? Math.round((upload.sent / upload.file.size) * 100) : 0;
  const altChanged = alt.trim() !== altBefore.trim();

  const uploadButton = canUpload ? (
    <Button variant="secondary" size="sm" icon={<Upload className="size-4" aria-hidden="true" />} onClick={() => fileInput.current?.click()} disabled={busy}>
      {assetId ? "Upload a new image" : "Upload image"}
    </Button>
  ) : null;
  const libraryButton = (
    <Button variant="secondary" size="sm" icon={<Images className="size-4" aria-hidden="true" />} onClick={() => setPickerOpen(true)} disabled={busy} aria-haspopup="dialog">
      {assetId ? "Choose another from library" : "Choose from media library"}
    </Button>
  );

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={assetId} />
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        onDragOver={(e) => {
          if (!canUpload || busy) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        className={cn("rounded-tile border border-border p-3 sm:p-4", dragging && "border-primary bg-primary-soft", !assetId && "border-dashed")}
      >
        <p id={`${id}-label`} className="sr-only">
          {label}
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-control bg-surface-muted sm:w-64">
            {assetId && image?.url ? (
              <img
                src={image.url}
                alt={alt.trim() || image.alt_text || ""}
                className="size-full object-cover"
                onError={() => {
                  // The signed link expired (5 minutes): fetch a fresh one once.
                  if (refreshed.current) return;
                  refreshed.current = true;
                  void describeLibraryImage(assetId).then((img) => img && setImage(img));
                }}
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-meta text-text-secondary">
                {loadingImage && assetId ? (
                  <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ImagePlus className="size-6" aria-hidden="true" />
                )}
                <span>{assetId ? (loadingImage ? "Loading preview…" : "Preview unavailable") : "No cover image"}</span>
              </div>
            )}
            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                <LoaderCircle className="size-8 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            {assetId ? (
              <div>
                <p className="truncate font-semibold">{image?.title ?? (loadingImage ? "Loading…" : "Library image")}</p>
                <p className="text-meta text-text-secondary">
                  {image?.status && image.status !== "ready" ? "This library image isn't available any more. Choose another." : "From the media library."}
                  {image && !image.public_ok && image.status === "ready" ? " Not yet approved for public use." : ""}
                </p>
              </div>
            ) : (
              <p className="font-semibold">No cover image</p>
            )}

            <div className="flex flex-wrap gap-2">
              {uploadButton}
              {libraryButton}
              {assetId ? (
                <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => choose(null)} disabled={busy}>
                  Remove
                </Button>
              ) : null}
            </div>
            {canUpload ? (
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT.image}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            ) : null}
            <p id={`${id}-help`} className="text-meta text-text-secondary">
              {canUpload
                ? `JPEG, PNG, WebP, or HEIC, up to ${limitMb} MB. Uploads are added to the media library; location and camera data are removed.`
                : "Choose a ready image from the media library. Uploading needs the media manager role."}
            </p>
          </div>
        </div>

        <div aria-live="polite" className="empty:hidden">
          {busy ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-meta font-semibold">{upload.file.name}</span>
                {upload.state === "uploading" ? (
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={cancel}>
                    Cancel upload
                  </Button>
                ) : null}
              </div>
              <progress
                className="h-2 w-full accent-[var(--color-accent)]"
                max={100}
                value={upload.state === "processing" ? 100 : pct}
                aria-label={`Upload progress for ${upload.file.name}`}
              />
              <p className="text-[0.8125rem] text-text-secondary">
                {upload.state === "processing" ? "Processing the image…" : `${pct}% uploaded.`}
                {assetId ? " The current cover stays until the new image is ready." : ""}
              </p>
            </div>
          ) : null}
          {upload.state === "failed" ? (
            <Alert tone="error" title="The image wasn't uploaded." className="mt-3">
              <p>{upload.message}</p>
              <p className="mt-1">{assetId ? "The current cover is unchanged. " : ""}Nothing else on this page was lost.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => void run(upload.file, upload.begun)}>
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                  Choose a different file
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setUpload({ state: "idle" })}>
                  Dismiss
                </Button>
              </div>
            </Alert>
          ) : null}
          {changed && !busy ? (
            <p className="mt-3 rounded-control bg-primary-soft px-3 py-2 text-meta">
              <span className="font-semibold">Not saved yet.</span> Select <span className="font-semibold">{saveLabel}</span> to{" "}
              {assetId ? "use this cover" : "remove the cover"}.{assetId ? "" : " The image stays in the media library."} Choosing an image never publishes anything.
            </p>
          ) : null}
        </div>
      </div>

      {altName ? (
        <TextField
          id={`${id}-alt`}
          label="Image description (alt text)"
          name={altName}
          maxLength={500}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          optional
          hint={
            image?.alt_text
              ? `Describe the image for people using screen readers. Leave empty to use the library's description: “${image.alt_text}”.`
              : "Describe the image for people using screen readers. Leave empty to use the description saved with the image."
          }
        />
      ) : null}
      {altName && changed && assetId && alt.trim() && !altChanged ? (
        <p className="-mt-2 text-meta text-text-secondary">You picked a different image: check that the description still matches it.</p>
      ) : null}

      {pickerOpen ? (
        <LibraryPicker
          current={assetId}
          canUpload={canUpload}
          onClose={() => setPickerOpen(false)}
          onUpload={() => {
            setPickerOpen(false);
            fileInput.current?.click();
          }}
          onChoose={(img) => {
            setPickerOpen(false);
            setUpload({ state: "idle" });
            choose(img);
          }}
        />
      ) : null}
    </div>
  );
}

type ListState = { status: "loading" | "ready" | "error"; items: ImageChoice[]; total: number; message?: string };

/**
 * Library images in a modal (native <dialog>: focus moves in, stays there,
 * Escape closes, focus returns). Rendered outside the editor form so the
 * search box never submits it.
 */
function LibraryPicker({
  current,
  canUpload,
  onClose,
  onChoose,
  onUpload,
}: {
  current: string;
  canUpload: boolean;
  onClose: () => void;
  onChoose: (img: ImageChoice) => void;
  onUpload: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const [q, setQ] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading", items: [], total: 0 });
  const [selected, setSelected] = useState(current);
  const [more, setMore] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const load = useCallback(async (query: string, offset: number) => {
    const n = ++request.current;
    if (offset === 0) setList((l) => ({ ...l, status: "loading" }));
    else setMore(true);
    try {
      const r = await listLibraryImages({ q: query, offset });
      if (n !== request.current) return;
      if (!r.ok) setList((l) => ({ ...l, status: "error", message: r.message }));
      else setList((l) => ({ status: "ready", items: offset ? [...l.items, ...r.items] : r.items, total: r.total }));
    } catch {
      if (n === request.current) setList((l) => ({ ...l, status: "error", message: "The media library couldn't be reached." }));
    } finally {
      if (n === request.current) setMore(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(q, 0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const chosen = list.items.find((i) => i.id === selected);
  // Closing the native dialog returns focus to the button that opened it.
  const close = () => ref.current?.close();
  const finish = (img: ImageChoice) => {
    close();
    onChoose(img);
  };

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-surface p-0 text-text backdrop:bg-black/50 backdrop:backdrop-blur-[2px] sm:m-auto sm:h-[min(44rem,calc(100dvh-2rem))] sm:w-[min(52rem,calc(100%-2rem))] sm:rounded-card sm:border sm:border-border sm:shadow-(--elev-lift)"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <h2 id={titleId} className="min-w-0 flex-1 font-display text-xl font-semibold">
            Choose a cover image
          </h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close" icon={<X className="size-5" aria-hidden="true" />} />
        </div>
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <label htmlFor={searchId} className="mb-1.5 block text-meta font-semibold">
            Search images
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value.slice(0, 80))}
              placeholder="Title or file name"
              className="min-h-11 w-full rounded-control border border-border-strong bg-surface py-2 pr-3 pl-10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" aria-busy={list.status === "loading"}>
          {list.status === "error" ? (
            <Alert tone="error" title="Images couldn't be loaded.">
              <p>{list.message}</p>
              <Button className="mt-2" size="sm" variant="secondary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => void load(q, 0)}>
                Try again
              </Button>
            </Alert>
          ) : list.status === "loading" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="Loading images">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="aspect-[4/3] animate-pulse rounded-tile bg-surface-muted motion-reduce:animate-none" />
              ))}
            </ul>
          ) : list.items.length ? (
            <>
              <p className="sr-only" aria-live="polite">
                {list.total} image{list.total === 1 ? "" : "s"}
              </p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {list.items.map((img) => {
                  const on = img.id === selected;
                  return (
                    <li key={img.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelected(img.id)}
                        onDoubleClick={() => finish(img)}
                        className={cn(
                          "group block w-full overflow-hidden rounded-tile border-2 bg-surface text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                          on ? "border-primary" : "border-transparent hover:border-border-strong",
                        )}
                      >
                        <span className="block aspect-[4/3] bg-surface-muted">
                          {img.url ? <img src={img.url} alt="" loading="lazy" className="size-full object-cover" /> : null}
                        </span>
                        <span className="block truncate px-2 py-1.5 text-meta font-semibold">{img.title}</span>
                        {img.id === current ? <span className="block px-2 pb-1.5 text-[0.8125rem] text-text-secondary">Current cover</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {list.items.length < list.total ? (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" size="sm" loading={more} loadingText="Loading…" onClick={() => void load(q, list.items.length)}>
                    Show more
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-4 py-10 text-center">
              <Images className="size-10 text-text-secondary" aria-hidden="true" />
              <p className="font-semibold">{q ? `No images match “${q}”` : "No images in the media library yet"}</p>
              {canUpload ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Upload className="size-4" aria-hidden="true" />}
                  onClick={() => {
                    close();
                    onUpload();
                  }}
                >
                  Upload image
                </Button>
              ) : (
                <p className="text-meta text-text-secondary">A media manager can add images to the library.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <p className="mr-auto min-w-0 truncate text-meta text-text-secondary">{chosen ? `Selected: ${chosen.title}` : "Select an image"}</p>
          <Button variant="secondary" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={!chosen} onClick={() => chosen && finish(chosen)}>
            Use this image
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
