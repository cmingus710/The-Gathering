"use client";

/* eslint-disable @next/next/no-img-element -- local object-URL preview of the cropped photo */
import { Crop, LoaderCircle, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { ImageCropper } from "@/components/media/image-cropper";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { CENTRED, type Framing } from "@/lib/media/framing";
import { ImageDecodeError, loadEditableImage, renderFramed, type EditableImage } from "@/lib/media/image-edit";
import { removePhotoAction, uploadPhotoAction } from "../actions";

const OUTPUT = 768;
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 15 * 1024 * 1024;
const SQUARE = [{ id: "square", label: "Square", aspect: 1 }];

/** The chosen photo and how it's framed; the original stays on this device. */
type Chosen = { image: EditableImage; framing: Framing; cropped: { file: File; url: string } | null };

/**
 * Choose, frame, and upload a photo. The photo opens in the shared cropper
 * (square, shown in a circle as everywhere else); the cropped copy is
 * previewed here and only replaces the current photo after "Save". Cancel
 * at any step keeps the current photo. The crop happens in the browser so
 * the original never leaves the device; the server validates and
 * re-encodes whatever it receives. Without JavaScript the form still works
 * and the server centre-crops the uploaded image.
 */
export function PhotoForm({ name, photoUrl, hasPhoto, shared }: { name: string; photoUrl: string | null; hasPhoto: boolean; shared: boolean }) {
  const [state, action] = useActionState(uploadPhotoAction, initialFormState);
  const [removeState, removeAction] = useActionState(removePhotoAction, initialFormState);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [cropping, setCropping] = useState(false);
  const [opening, setOpening] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const chosenRef = useRef(chosen);
  useEffect(() => {
    chosenRef.current = chosen;
  });

  // Free the decoded photo and preview when leaving the page.
  useEffect(
    () => () => {
      const c = chosenRef.current;
      c?.image.release();
      if (c?.cropped) URL.revokeObjectURL(c.cropped.url);
    },
    [],
  );

  function discard() {
    const c = chosenRef.current;
    c?.image.release();
    if (c?.cropped) URL.revokeObjectURL(c.cropped.url);
    setChosen(null);
    setCropping(false);
  }

  // Once the server accepts the photo, clear the local selection.
  useEffect(() => {
    if (state.status !== "success") return;
    startTransition(discard);
    formRef.current?.reset();
  }, [state]);

  async function choose(file: File | undefined) {
    // No file means the picker was dismissed: keep everything as it was.
    if (!file) return;
    setLocalError(null);
    if (!ACCEPT.split(",").includes(file.type)) return setLocalError("Choose a PNG, JPEG, or WebP image.");
    if (file.size > MAX_BYTES) return setLocalError("That image is too large. Choose one under 15 MB.");
    setOpening(true);
    try {
      const image = await loadEditableImage(file);
      if (image.width < 128 || image.height < 128) {
        image.release();
        return setLocalError("Choose an image at least 128 × 128 pixels.");
      }
      discard();
      setChosen({ image, framing: CENTRED, cropped: null });
      setCropping(true);
    } catch (e) {
      setLocalError(e instanceof ImageDecodeError ? "We couldn't read that image. Try a different one." : "Something went wrong opening that photo. Try again.");
    } finally {
      setOpening(false);
    }
  }

  async function apply(framing: Framing) {
    if (!chosen) return;
    setPreparing(true);
    setLocalError(null);
    try {
      const file = await renderFramed(chosen.image, { aspect: 1, framing, maxSide: OUTPUT, type: "image/jpeg", name: "photo.jpg" });
      if (chosen.cropped) URL.revokeObjectURL(chosen.cropped.url);
      setChosen({ ...chosen, framing, cropped: { file, url: URL.createObjectURL(file) } });
      setCropping(false);
    } catch {
      setLocalError("We couldn't prepare that photo. Try again, or choose a different one.");
    } finally {
      setPreparing(false);
    }
  }

  function cancelCrop() {
    // Cancelling the first crop drops the new photo; cancelling an edit keeps the last crop.
    if (chosen?.cropped) setCropping(false);
    else discard();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    if (!chosen?.cropped) return; // nothing chosen here: let the browser submit (or the server explain)
    e.preventDefault();
    const fd = new FormData();
    fd.set("photo", chosen.cropped.file);
    startTransition(() => action(fd));
  }

  const pendingPreview = chosen?.cropped?.url ?? null;

  return (
    <div className="space-y-6">
      <FormMessage state={state.status !== "idle" ? state : removeState} />
      {localError ? (
        <p role="alert" className="font-medium text-danger">
          {localError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-5">
        {pendingPreview ? (
          <img src={pendingPreview} alt="" className="size-28 shrink-0 rounded-full bg-surface-muted object-cover ring-2 ring-primary ring-offset-2 ring-offset-surface" />
        ) : (
          <MemberAvatar name={name} photoUrl={photoUrl} size="lg" />
        )}
        <div className="space-y-1">
          <p className="font-semibold">{pendingPreview ? "New photo (not saved yet)" : hasPhoto ? "Current photo" : "No photo yet"}</p>
          <p className="text-meta text-text-secondary">
            {pendingPreview
              ? hasPhoto
                ? "Your current photo stays until you save."
                : "Save to start using it."
              : hasPhoto
                ? shared
                  ? "Shown to approved members."
                  : "Hidden from other members."
                : "Members see your initials."}{" "}
            <Link href="/profile/privacy" className="font-semibold text-primary underline underline-offset-2">
              Privacy
            </Link>
          </p>
          {pendingPreview ? (
            <div className="flex flex-wrap gap-1 pt-1">
              <Button variant="secondary" size="sm" icon={<Crop className="size-4" aria-hidden="true" />} onClick={() => setCropping(true)} aria-haspopup="dialog">
                Edit crop
              </Button>
              <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={discard}>
                Cancel new photo
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <form ref={formRef} action={action} onSubmit={submit} encType="multipart/form-data" className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="photo" className="block font-semibold">
            {hasPhoto || pendingPreview ? "Choose a different photo" : "Choose a photo"}
          </label>
          <p id="photo-hint" className="text-meta text-text-secondary">
            PNG, JPEG, or WebP, at least 128 × 128 pixels. You can position and zoom it before saving.
          </p>
          <input
            ref={inputRef}
            id="photo"
            name="photo"
            type="file"
            accept={ACCEPT}
            aria-describedby="photo-hint"
            aria-invalid={state.fieldErrors?.photo ? true : undefined}
            aria-busy={opening || undefined}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              // The photo is held here; clearing the field lets the same file be chosen again.
              if (file) e.currentTarget.value = "";
              void choose(file);
            }}
            className="block w-full text-meta file:mr-4 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold file:text-text"
          />
          {opening ? (
            <p role="status" className="flex items-center gap-2 text-meta text-text-secondary">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Opening the photo…
            </p>
          ) : null}
        </div>

        <SubmitButton pendingText="Uploading…" icon={<Upload className="size-4" aria-hidden="true" />}>
          {hasPhoto ? "Save new photo" : "Save photo"}
        </SubmitButton>
      </form>

      {chosen && cropping ? (
        <ImageCropper
          image={chosen.image}
          title="Position your photo"
          description="Members see it in a circle."
          shapes={SQUARE}
          mask="circle"
          initialFraming={chosen.framing}
          previews={[{ label: "In lists", aspect: 1, round: true }]}
          applyLabel="Use photo"
          busy={preparing}
          busyLabel="Preparing…"
          error={localError}
          onCancel={cancelCrop}
          onApply={({ framing }) => void apply(framing)}
        />
      ) : null}

      {hasPhoto ? (
        <div className="border-t border-border pt-5">
          <ConfirmDialog
            trigger={
              <>
                <Trash2 className="size-4" aria-hidden="true" /> Remove photo
              </>
            }
            title="Remove your photo?"
            confirmLabel="Remove photo"
            formAction={removeAction}
          >
            Your photo will be deleted and members will see your initials instead.
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  );
}
