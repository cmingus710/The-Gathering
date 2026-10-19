"use client";

import { Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { removePhotoAction, uploadPhotoAction } from "../actions";

const OUTPUT = 768;
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 15 * 1024 * 1024;

type Crop = { zoom: number; x: number; y: number };
const CENTRE: Crop = { zoom: 1, x: 0, y: 0 };

/** Source rectangle for a square crop of the image at the given zoom and offset (-100..100). */
function sourceRect(w: number, h: number, c: Crop) {
  const side = Math.min(w, h) / c.zoom;
  const maxX = (w - side) / 2;
  const maxY = (h - side) / 2;
  return { sx: maxX + (c.x / 100) * maxX, sy: maxY + (c.y / 100) * maxY, side };
}

function Range({ id, label, value, min, max, step, onChange, valueText }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; valueText: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex justify-between font-semibold">
        {label} <span className="font-normal text-text-secondary">{valueText}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="h-11 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

/**
 * Choose, position, and upload a photo. The crop happens in the browser so
 * the original never leaves the device; the server validates and re-encodes
 * whatever it receives. Without JavaScript the form still works and the
 * server centre-crops the uploaded image.
 */
export function PhotoForm({ name, photoUrl, hasPhoto, shared }: { name: string; photoUrl: string | null; hasPhoto: boolean; shared: boolean }) {
  const [state, action] = useActionState(uploadPhotoAction, initialFormState);
  const [removeState, removeAction] = useActionState(removePhotoAction, initialFormState);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>(CENTRE);
  const [localError, setLocalError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Draw the live preview.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { sx, sy, side } = sourceRect(image.naturalWidth, image.naturalHeight, crop);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  }, [image, crop]);

  // Once the server accepts the photo, clear the local selection.
  useEffect(() => {
    if (state.status !== "success") return;
    startTransition(() => {
      setImage(null);
      setCrop(CENTRE);
    });
    formRef.current?.reset();
  }, [state]);

  function choose(file: File | undefined) {
    setLocalError(null);
    setImage(null);
    setCrop(CENTRE);
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) return setLocalError("Choose a PNG, JPEG, or WebP image.");
    if (file.size > MAX_BYTES) return setLocalError("That image is too large. Choose one under 15 MB.");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth < 128 || img.naturalHeight < 128) return setLocalError("Choose an image at least 128 × 128 pixels.");
      setImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setLocalError("We couldn't read that image. Try a different one.");
    };
    img.src = url;
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    if (!image) return; // no JS-side image: let the browser submit the original
    e.preventDefault();
    const out = document.createElement("canvas");
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const { sx, sy, side } = sourceRect(image.naturalWidth, image.naturalHeight, crop);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT);
    out.toBlob(
      (blob) => {
        if (!blob) return setLocalError("We couldn't prepare that photo. Try a different one.");
        const fd = new FormData();
        fd.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        startTransition(() => action(fd));
      },
      "image/jpeg",
      0.9,
    );
  }

  const zoomText = `${Math.round(crop.zoom * 100)}%`;
  const xText = crop.x === 0 ? "Centred" : crop.x < 0 ? `${-crop.x}% left` : `${crop.x}% right`;
  const yText = crop.y === 0 ? "Centred" : crop.y < 0 ? `${-crop.y}% up` : `${crop.y}% down`;

  return (
    <div className="space-y-6">
      <FormMessage state={state.status !== "idle" ? state : removeState} />
      {localError ? (
        <p role="alert" className="font-medium text-danger">
          {localError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-5">
        <MemberAvatar name={name} photoUrl={photoUrl} size="lg" />
        <div className="space-y-1">
          <p className="font-semibold">{hasPhoto ? "Current photo" : "No photo yet"}</p>
          <p className="text-[0.95rem] text-text-secondary">
            {hasPhoto ? (shared ? "Shown to approved members." : "Hidden from other members.") : "Members see your initials."}{" "}
            <Link href="/profile/privacy" className="font-semibold text-primary underline underline-offset-2">
              Privacy
            </Link>
          </p>
        </div>
      </div>

      <form ref={formRef} action={action} onSubmit={submit} encType="multipart/form-data" className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="photo" className="block font-semibold">
            {hasPhoto ? "Choose a new photo" : "Choose a photo"}
          </label>
          <p id="photo-hint" className="text-[0.95rem] text-text-secondary">
            PNG, JPEG, or WebP, at least 128 × 128 pixels. You can position it before saving.
          </p>
          <input
            ref={inputRef}
            id="photo"
            name="photo"
            type="file"
            accept={ACCEPT}
            aria-describedby="photo-hint"
            aria-invalid={state.fieldErrors?.photo ? true : undefined}
            onChange={(e) => choose(e.currentTarget.files?.[0])}
            className="block w-full text-[0.95rem] file:mr-4 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold file:text-text"
          />
        </div>

        {image ? (
          <fieldset className="grid gap-5 sm:grid-cols-[12rem_1fr] sm:items-start">
            <legend className="mb-3 font-semibold">Position your photo</legend>
            <canvas
              ref={canvasRef}
              width={384}
              height={384}
              role="img"
              aria-label={`Preview of your photo at ${zoomText} zoom, horizontally ${xText.toLowerCase()}, vertically ${yText.toLowerCase()}`}
              className="size-48 rounded-full bg-surface-muted"
            />
            <div className="space-y-3">
              <Range id="crop-zoom" label="Zoom" min={1} max={3} step={0.05} value={crop.zoom} valueText={zoomText} onChange={(zoom) => setCrop((c) => ({ ...c, zoom }))} />
              <Range id="crop-x" label="Left / right" min={-100} max={100} step={5} value={crop.x} valueText={xText} onChange={(x) => setCrop((c) => ({ ...c, x }))} />
              <Range id="crop-y" label="Up / down" min={-100} max={100} step={5} value={crop.y} valueText={yText} onChange={(y) => setCrop((c) => ({ ...c, y }))} />
              <Button variant="ghost" size="sm" onClick={() => setCrop(CENTRE)}>
                Reset position
              </Button>
            </div>
          </fieldset>
        ) : null}

        <SubmitButton pendingText="Uploading…" icon={<Upload className="size-4" aria-hidden="true" />}>
          {hasPhoto ? "Save new photo" : "Save photo"}
        </SubmitButton>
      </form>

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
