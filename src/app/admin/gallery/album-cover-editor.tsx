"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs and short-lived signed URLs, never through the image optimizer */
import { Check, Crop, ImagePlus, Images, LoaderCircle, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ImageCropper } from "@/components/media/image-cropper";
import { TileIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { ALBUM_COVER_ASPECT, albumVideoStill, isChosenCover } from "@/lib/media/album-cover";
import { ACCEPT, formatBytes } from "@/lib/media/files";
import { framingStyle, type Framing } from "@/lib/media/framing";
import { isHeic, loadEditableImage } from "@/lib/media/image-edit";
import type { AlbumCover } from "@/lib/media/types";
import { startUpload, type UploadHandle } from "@/lib/media/upload-client";
import { beginAlbumCoverUpload, cancelAlbumCoverUpload, chooseAlbumCoverPhoto, finishAlbumCoverUpload, frameAlbumCover, removeAlbumCover } from "./cover-actions";

/** A published photo of the album that may become its cover (moderators). */
export type CoverPhotoChoice = { id: string; thumbUrl: string | null; displayUrl: string | null; alt: string; width: number | null; height: number | null };

/** A new image chosen and cropped but not uploaded yet. */
export type StagedCover = { file: File; framing: Framing | null; alt: string; noMinors: boolean };

type Draft =
  | { kind: "upload"; file: File; url: string | null; width: number; height: number; framing: Framing | null }
  | { kind: "photo"; photo: CoverPhotoChoice; framing: Framing | null }
  | { kind: "reframe"; framing: Framing | null };

type Crop = { url: string; width: number; height: number; framing: Framing | null; title: string; apply: (f: Framing) => void; release?: () => void };

type Phase = { state: "idle" } | { state: "uploading"; sent: number; total: number } | { state: "processing" } | { state: "saving" };

const SHAPES = [{ id: "cover", label: "4:3", aspect: ALBUM_COVER_ASPECT }];
const SOURCE_LABEL: Record<AlbumCover["source"], string> = {
  upload: "Uploaded cover image",
  photo: "A photo from this album",
  first_photo: "Automatic: the album's first photo",
  video: "Automatic: a still from the album's first video",
};

/**
 * Uploads, processes, and saves one cover image (also used by the new-album
 * form right after the album is created). The saved cover changes only once
 * the new image is fully processed; cancelling leaves it as it was.
 */
export async function uploadAlbumCover(
  albumId: string,
  staged: StagedCover,
  onPhase: (p: Phase) => void,
  onHandle: (cancel: (() => void) | null) => void,
): Promise<{ ok: true } | { ok: false; message: string; cancelled?: boolean }> {
  const begun = await beginAlbumCoverUpload({ albumId, name: staged.file.name, type: staged.file.type, size: staged.file.size });
  if (!begun.ok) return begun;
  let cancelled = false;
  const handle: UploadHandle = startUpload(
    { supabaseUrl: begun.supabaseUrl, publishableKey: begun.publishableKey, bucket: "media-uploads", path: begun.path, token: begun.token, contentType: begun.contentType },
    staged.file,
    (sent, total) => onPhase({ state: "uploading", sent, total }),
  );
  onHandle(() => {
    cancelled = true;
    handle.cancel();
  });
  onPhase({ state: "uploading", sent: 0, total: staged.file.size });
  try {
    await handle.promise;
  } catch (e) {
    onHandle(null);
    await cancelAlbumCoverUpload(begun.id, cancelled ? "Cancelled" : "Upload failed");
    return { ok: false, cancelled, message: cancelled ? "Upload cancelled. The cover wasn't changed." : e instanceof Error ? e.message : "The upload failed." };
  }
  onHandle(null);
  onPhase({ state: "processing" });
  return finishAlbumCoverUpload({ uploadId: begun.id, framing: staged.framing, alt: staged.alt, noMinors: staged.noMinors });
}

/**
 * "Collection cover image" in the album editor: upload an image (or, for
 * gallery moderators, choose a published photo from the album), crop it to
 * the 4:3 frame members see, and save, replace, or remove it. Nothing
 * changes until Save cover; Discard and Cancel leave the saved cover as it
 * is. With albumId null (a new album) the chosen image is handed to the form
 * through onStagedChange and saved right after the album is created.
 */
export function AlbumCoverEditor({
  albumId,
  albumTitle,
  cover,
  coverUrl,
  canEdit,
  canChoosePhoto,
  photos,
  fileMb,
  photoCount = 0,
  videoCount = 0,
  onStagedChange,
}: {
  albumId: string | null;
  albumTitle: string;
  cover: AlbumCover | null;
  /** Signed URL of the cover's large copy (null when there is none or it can't be shown here). */
  coverUrl: string | null;
  canEdit: boolean;
  canChoosePhoto: boolean;
  photos: CoverPhotoChoice[];
  fileMb: number;
  photoCount?: number;
  videoCount?: number;
  onStagedChange?: (staged: StagedCover | null) => void;
}) {
  const id = useId();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const cancelUpload = useRef<(() => void) | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [alt, setAlt] = useState(cover?.source === "upload" ? cover.alt : "");
  const [noMinors, setNoMinors] = useState(false);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [stillFailed, setStillFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const refreshed = useRef(false);
  const staged = albumId === null;
  const busy = phase.state !== "idle";

  // Local previews are object URLs: free them when replaced or on unmount.
  const draftUrl = draft?.kind === "upload" ? draft.url : null;
  useEffect(() => () => (draftUrl ? URL.revokeObjectURL(draftUrl) : undefined), [draftUrl]);
  const cropRef = useRef(crop);
  useEffect(() => {
    cropRef.current = crop;
  });
  useEffect(() => () => cropRef.current?.release?.(), []);

  // The saved cover's alt text follows the page after a save.
  const savedAlt = cover?.source === "upload" ? cover.alt : "";
  const [altFor, setAltFor] = useState(cover?.display_path ?? null);
  if ((cover?.display_path ?? null) !== altFor) {
    setAltFor(cover?.display_path ?? null);
    setAlt(savedAlt);
  }

  const onStagedRef = useRef(onStagedChange);
  useEffect(() => {
    onStagedRef.current = onStagedChange;
  });
  useEffect(() => {
    if (!staged) return;
    onStagedRef.current?.(draft?.kind === "upload" ? { file: draft.file, framing: draft.framing, alt, noMinors } : null);
  }, [staged, draft, alt, noMinors]);

  function closeCrop() {
    crop?.release?.();
    setCrop(null);
  }

  async function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setSaved(null);
    if (!ACCEPT.image.split(",").some((t) => (t.startsWith(".") ? file.name.toLowerCase().endsWith(t) : file.type === t)) && !isHeic(file)) {
      setError("Choose a JPEG, PNG, WebP, or HEIC image.");
      return;
    }
    if (file.size > fileMb * 1024 * 1024) {
      setError(`That image is ${formatBytes(file.size)}. Cover images can be up to ${fileMb} MB.`);
      return;
    }
    setOpening(true);
    try {
      const img = await loadEditableImage(file);
      setCrop({
        url: img.url,
        width: img.width,
        height: img.height,
        framing: null,
        title: "Crop the cover image",
        release: img.release,
        apply: (f) => {
          // The draft keeps its own object URL; the cropper's copy is released with it.
          setDraft({ kind: "upload", file, url: URL.createObjectURL(file), width: img.width, height: img.height, framing: f });
          setNoMinors(false);
        },
      });
    } catch {
      // HEIC outside Safari: upload as is (centred), adjust after saving.
      setDraft({ kind: "upload", file, url: null, width: 0, height: 0, framing: null });
      setNoMinors(false);
    } finally {
      setOpening(false);
    }
  }

  function choosePhoto(photo: CoverPhotoChoice) {
    pickerRef.current?.close();
    const url = photo.displayUrl ?? photo.thumbUrl;
    if (!url || !photo.width || !photo.height) {
      setDraft({ kind: "photo", photo, framing: null });
      return;
    }
    setCrop({
      url,
      width: photo.width,
      height: photo.height,
      framing: null,
      title: "Crop the chosen photo",
      apply: (f) => setDraft({ kind: "photo", photo, framing: f }),
    });
  }

  function reframe() {
    if (!cover || !coverUrl || !cover.width || !cover.height) return;
    setError(null);
    setSaved(null);
    setCrop({
      url: coverUrl,
      width: cover.width,
      height: cover.height,
      framing: draft?.kind === "reframe" ? draft.framing : cover.framing,
      title: "Adjust the cover crop",
      apply: (f) => setDraft({ kind: "reframe", framing: f }),
    });
  }

  function discard() {
    setDraft(null);
    setError(null);
    setAlt(savedAlt);
    setNoMinors(false);
  }

  async function save() {
    if (!draft || !albumId) return;
    setError(null);
    setSaved(null);
    let r: { ok: true } | { ok: false; message: string; cancelled?: boolean };
    if (draft.kind === "upload") {
      if (!noMinors) {
        setError("Confirm that no one under 18 can be identified in the image.");
        return;
      }
      r = await uploadAlbumCover(albumId, { file: draft.file, framing: draft.framing, alt, noMinors }, setPhase, (c) => (cancelUpload.current = c));
    } else if (draft.kind === "photo") {
      setPhase({ state: "saving" });
      r = await chooseAlbumCoverPhoto({ albumId, photoId: draft.photo.id, framing: draft.framing });
    } else {
      setPhase({ state: "saving" });
      const key = cover?.source === "upload" ? cover.display_path : cover?.photo_id;
      r = key ? await frameAlbumCover({ albumId, cover: key, framing: draft.framing, alt: cover?.source === "upload" ? alt : null }) : { ok: false, message: "There's no cover to adjust." };
    }
    setPhase({ state: "idle" });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setDraft(null);
    setNoMinors(false);
    setSaved(draft.kind === "upload" ? (isChosenCover(cover) ? "Cover replaced." : "Cover saved.") : draft.kind === "photo" ? "Cover photo set." : "Cover crop saved.");
    refreshed.current = false;
    router.refresh();
  }

  async function saveAlt() {
    if (!albumId || cover?.source !== "upload" || !cover.display_path) return;
    setError(null);
    setSaved(null);
    setPhase({ state: "saving" });
    const r = await frameAlbumCover({ albumId, cover: cover.display_path, framing: cover.framing, alt });
    setPhase({ state: "idle" });
    if (!r.ok) return setError(r.message);
    setSaved("Cover description saved.");
    router.refresh();
  }

  async function remove() {
    if (!albumId) return;
    setError(null);
    setSaved(null);
    setPhase({ state: "saving" });
    const r = await removeAlbumCover(albumId);
    setPhase({ state: "idle" });
    if (!r.ok) return setError(r.message);
    setDraft(null);
    setSaved("Cover removed. Members see the automatic cover again; no photo or video was deleted.");
    router.refresh();
  }

  // What the preview frame shows: the draft, else the saved cover.
  const preview: { url: string | null; framing: Framing | null; alt: string; note?: string } = (() => {
    if (draft?.kind === "upload") return { url: draft.url, framing: draft.framing, alt: alt || "New cover image", note: draft.url ? undefined : "This browser can't preview this image." };
    if (draft?.kind === "photo") return { url: draft.photo.displayUrl ?? draft.photo.thumbUrl, framing: draft.framing, alt: draft.photo.alt || "Chosen photo" };
    if (draft?.kind === "reframe") return { url: coverUrl, framing: draft.framing, alt: cover?.alt || "Cover image" };
    if (cover?.source === "video") return { url: stillFailed ? null : albumVideoStill(cover), framing: null, alt: "" };
    return { url: coverUrl, framing: cover?.framing ?? null, alt: cover?.alt ?? "" };
  })();

  const chosen = isChosenCover(cover);
  const canReframe = !!(chosen && coverUrl && cover?.width && cover?.height && (cover.source === "upload" || canChoosePhoto));
  const pct = phase.state === "uploading" && phase.total ? Math.round((phase.sent / phase.total) * 100) : 0;
  const counts = [`${photoCount} ${photoCount === 1 ? "photo" : "photos"}`, videoCount ? `${videoCount} ${videoCount === 1 ? "video" : "videos"}` : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* Live preview: the member card as it will look. */}
        <figure className="space-y-2">
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="relative aspect-[4/3] overflow-hidden bg-surface-muted">
              {preview.url ? (
                <img
                  src={preview.url}
                  alt={preview.alt}
                  className="block size-full"
                  style={framingStyle(preview.framing)}
                  onError={() => {
                    if (cover?.source === "video" && !draft) return setStillFailed(true);
                    // The signed link expired (5 minutes): fetch fresh ones once.
                    if (refreshed.current || draft?.kind === "upload") return;
                    refreshed.current = true;
                    router.refresh();
                  }}
                />
              ) : (
                <span className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-meta text-text-secondary">
                  <TileIcon name="gallery" className="size-14" />
                  {preview.note ?? (draft ? null : "Branded placeholder")}
                </span>
              )}
              {busy ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                  <LoaderCircle className="size-8 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />
                </span>
              ) : null}
            </div>
            <div className="p-3">
              <p className="font-semibold">{albumTitle || "Album title"}</p>
              <p className="text-meta text-text-secondary">{counts}</p>
            </div>
          </div>
          <figcaption className="text-meta text-text-secondary">
            {draft ? (
              <span className="font-semibold text-text">Preview: not saved yet</span>
            ) : cover ? (
              SOURCE_LABEL[cover.source]
            ) : (
              "No cover yet: members see the placeholder."
            )}
          </figcaption>
        </figure>

        <div className="min-w-0 space-y-3">
          {!canEdit ? (
            <p className="text-text-secondary">Only gallery moderators and the event coordinator who created this album can change its cover.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Upload className="size-4" aria-hidden="true" />}
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || opening}
                  loading={opening}
                  loadingText="Opening…"
                >
                  {chosen || draft ? "Replace" : "Upload image"}
                </Button>
                {canChoosePhoto && photos.length && !staged ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Images className="size-4" aria-hidden="true" />}
                    onClick={() => {
                      setPicked(draft?.kind === "photo" ? draft.photo.id : cover?.source === "photo" ? cover.photo_id : null);
                      pickerRef.current?.showModal();
                    }}
                    disabled={busy}
                    aria-haspopup="dialog"
                  >
                    Choose from this album
                  </Button>
                ) : null}
                {canReframe && !draft ? (
                  <Button variant="secondary" size="sm" icon={<Crop className="size-4" aria-hidden="true" />} onClick={reframe} disabled={busy} aria-haspopup="dialog">
                    Adjust crop
                  </Button>
                ) : null}
                {chosen && !draft && !staged ? (
                  <ConfirmDialog trigger="Remove" title="Remove the cover?" confirmLabel="Remove cover" formAction={() => void remove()}>
                    Members see the automatic cover again (the first photo, a video still, or the placeholder).{" "}
                    {cover?.source === "photo" ? "The photo stays in the album." : "The uploaded cover image is deleted; no photo or video is affected."}
                  </ConfirmDialog>
                ) : null}
              </div>
              <input
                ref={fileInput}
                id={`${id}-file`}
                type="file"
                accept={ACCEPT.image}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className="text-meta text-text-secondary">
                JPEG, PNG, WebP, or HEIC, up to {fileMb} MB. Shown at 4:3 on album cards and the album page. Location and camera data are removed. The cover isn&apos;t
                added to the album and doesn&apos;t change its photo or video counts.
                {canChoosePhoto ? "" : " Gallery moderators can also choose a published photo from the album."}
              </p>
            </>
          )}

          {draft ? (
            <div className="space-y-3 rounded-tile border border-primary/50 bg-primary-soft/40 p-3">
              {draft.kind === "upload" ? (
                <>
                  <p className="text-meta">
                    <span className="font-semibold">{draft.file.name}</span> · {formatBytes(draft.file.size)}
                    {draft.url ? null : " · It will be centred; adjust the crop after saving."}
                  </p>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={noMinors} onChange={(e) => setNoMinors(e.target.checked)} className="mt-1 size-5 accent-primary" disabled={busy} />
                    <span>
                      No one under 18 can be identified in this image.{" "}
                      <span className="text-text-secondary">To use a photo of children or youth, add it to the album for review and photo consent, then choose it as the cover.</span>
                    </span>
                  </label>
                </>
              ) : draft.kind === "photo" ? (
                <p className="text-meta">A published photo from this album. It stays in the album; only the cover changes.</p>
              ) : (
                <p className="text-meta">New crop for the current cover.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {draft.kind !== "reframe" && (draft.kind === "upload" ? draft.url : draft.photo.displayUrl ?? draft.photo.thumbUrl) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Crop className="size-4" aria-hidden="true" />}
                    disabled={busy}
                    aria-haspopup="dialog"
                    onClick={() =>
                      draft.kind === "upload"
                        ? setCrop({ url: draft.url!, width: draft.width, height: draft.height, framing: draft.framing, title: "Crop the cover image", apply: (f) => setDraft({ ...draft, framing: f }) })
                        : setCrop({
                            url: (draft.photo.displayUrl ?? draft.photo.thumbUrl)!,
                            width: draft.photo.width ?? 1,
                            height: draft.photo.height ?? 1,
                            framing: draft.framing,
                            title: "Crop the chosen photo",
                            apply: (f) => setDraft({ ...draft, framing: f }),
                          })
                    }
                  >
                    Crop again
                  </Button>
                ) : null}
                {staged ? null : (
                  <Button size="sm" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => void save()} loading={busy} loadingText="Saving…">
                    Save cover
                  </Button>
                )}
                {phase.state === "uploading" ? (
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={() => cancelUpload.current?.()}>
                    Cancel upload
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={discard} disabled={busy}>
                    Discard
                  </Button>
                )}
              </div>
              {staged ? (
                <p className="text-meta text-text-secondary">
                  {noMinors ? "The cover is uploaded and saved right after the album is created." : "Confirm the box above to save this cover with the album."}
                </p>
              ) : (
                <p className="text-meta text-text-secondary">{chosen ? "The current cover stays until the new one is saved." : "Nothing changes until you save."}</p>
              )}
            </div>
          ) : null}

          {canEdit && (draft?.kind === "upload" || cover?.source === "upload") ? (
            <div className="space-y-2">
              <TextField
                id={`${id}-alt`}
                label="Cover description (alt text)"
                name="cover_alt"
                maxLength={500}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                optional
                hint="Describe the image for people using screen readers on the album page. Cards show the title next to it."
                disabled={busy}
              />
              {!draft && cover?.source === "upload" && alt.trim() !== savedAlt.trim() ? (
                <Button size="sm" variant="secondary" onClick={() => void saveAlt()} loading={busy} loadingText="Saving…">
                  Save description
                </Button>
              ) : null}
            </div>
          ) : null}

          <div aria-live="polite" className="space-y-2 empty:hidden">
            {phase.state === "uploading" || phase.state === "processing" ? (
              <div>
                <progress className="h-2 w-full accent-[var(--color-accent)]" max={100} value={phase.state === "processing" ? 100 : pct} aria-label="Cover upload progress" />
                <p className="text-[0.8125rem] text-text-secondary">{phase.state === "processing" ? "Processing the image…" : `${pct}% uploaded.`}</p>
              </div>
            ) : null}
            {saved ? <Alert tone="success" title={saved} /> : null}
          </div>
          {error ? (
            <Alert tone="error" title="The cover wasn't changed.">
              <p>{error}</p>
            </Alert>
          ) : null}
        </div>
      </div>

      {crop ? (
        <ImageCropper
          image={crop}
          title={crop.title}
          description="Drag to reposition, pinch or scroll to zoom. The frame matches the album card and page exactly. Nothing is saved until you choose Save cover."
          shapes={SHAPES}
          initialFraming={crop.framing}
          applyLabel="Use this crop"
          onCancel={closeCrop}
          onApply={({ framing }) => {
            crop.apply(framing);
            closeCrop();
          }}
        />
      ) : null}

      {canChoosePhoto && photos.length && !staged ? (
        <dialog
          ref={pickerRef}
          aria-labelledby={`${id}-pick-title`}
          className="m-auto max-h-[min(40rem,calc(100dvh-2rem))] w-[min(44rem,calc(100%-2rem))] overflow-auto rounded-card border border-border bg-surface p-5 text-text shadow-(--elev-lift) backdrop:bg-black/50"
        >
          <h2 id={`${id}-pick-title`} className="font-display text-xl font-semibold">
            Choose a photo from this album
          </h2>
          <p className="mt-1 text-meta text-text-secondary">Published photos only. The photo stays in the album; it&apos;s also shown as the cover.</p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id}>
                <label
                  className={cn(
                    "block cursor-pointer overflow-hidden rounded-tile border-2 bg-surface-muted focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-primary",
                    picked === p.id ? "border-primary" : "border-transparent",
                  )}
                >
                  <input type="radio" name={`${id}-photo`} value={p.id} checked={picked === p.id} onChange={() => setPicked(p.id)} className="sr-only" />
                  {p.thumbUrl ? (
                    <img src={p.thumbUrl} alt={p.alt || "Photo without a description"} className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <span className="flex aspect-[4/3] items-center justify-center text-meta text-text-secondary">
                      <ImagePlus className="size-6" aria-hidden="true" />
                      <span className="sr-only">{p.alt || "Photo"} (preview unavailable)</span>
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => pickerRef.current?.close()}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!picked}
              onClick={() => {
                const p = photos.find((x) => x.id === picked);
                if (p) choosePhoto(p);
              }}
            >
              Crop and use
            </Button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
