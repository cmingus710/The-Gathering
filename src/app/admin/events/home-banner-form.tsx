"use client";

/* eslint-disable @next/next/no-img-element -- object-URL and signed-URL previews */
import { Crop, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { ImageCropper } from "@/components/media/image-cropper";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { MAX_COVER_BYTES } from "@/lib/events/limits";
import { initialFormState, type FormState } from "@/lib/forms";
import { framingStyle } from "@/lib/media/framing";
import { saveHomeBannerAction } from "./banner-actions";

export type BannerValue = { url: string | null; alt: string; focusX: number; focusY: number };

/** The banner's two frames on the home page (see components/home/sections). */
const FRAMES = [
  { id: "phone", label: "Phone", aspect: 3 },
  { id: "desktop", label: "Desktop", aspect: 4.5 },
];

type Chosen = { file: File; url: string; width: number; height: number };

/**
 * Upload, describe, position, replace, or remove a homepage "Coming up"
 * banner. A new image opens in the shared cropper first (Cancel keeps the
 * current banner and form); "Reposition" reopens it. The banner's frame is
 * wider on a desktop than on a phone, so the position is a focal point
 * (no zoom) that both frames keep in view; the previews show both. Nothing
 * changes until "Save banner".
 */
export function HomeBannerForm({ scope, id, current, idPrefix = "banner" }: { scope: "event" | "default"; id?: string; current: BannerValue | null; idPrefix?: string }) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [cropping, setCropping] = useState<{ fresh: boolean } | null>(null);
  const [currentSize, setCurrentSize] = useState<{ width: number; height: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // React clears the file input after the action runs, so the local preview goes with it.
  const [state, action] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await saveHomeBannerAction(prev, formData);
    setChosen(null);
    return result;
  }, initialFormState);
  const [tooLarge, setTooLarge] = useState(false);
  const [focus, setFocus] = useState({ x: current?.focusX ?? 50, y: current?.focusY ?? 50 });
  const [focusBefore, setFocusBefore] = useState(focus);
  useEffect(() => () => (chosen ? URL.revokeObjectURL(chosen.url) : undefined), [chosen]);
  const src = chosen?.url ?? current?.url ?? null;
  const fe = state.fieldErrors ?? {};
  const style = framingStyle({ x: focus.x, y: focus.y, zoom: 1 });

  /** Puts the chosen file back if the browser emptied the field (some do when the picker is cancelled). */
  function keepChosenFile() {
    const input = fileRef.current;
    if (!input || !chosen || input.files?.length) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(chosen.file);
      input.files = dt.files;
    } catch {
      setChosen(null);
    }
  }

  function clearChoice() {
    if (fileRef.current) fileRef.current.value = "";
    setChosen(null);
    setFocus(focusBefore);
  }

  async function onFile(input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return keepChosenFile();
    const big = f.size > MAX_COVER_BYTES;
    setTooLarge(big);
    if (big) {
      input.value = "";
      return setChosen(null);
    }
    const url = URL.createObjectURL(f);
    const probe = new Image();
    probe.src = url;
    try {
      await probe.decode();
    } catch {
      // Can't preview it here: the server still checks it (and explains) when saving.
      setChosen(null);
      URL.revokeObjectURL(url);
      return;
    }
    setFocusBefore(focus);
    setFocus({ x: 50, y: 50 });
    setChosen({ file: f, url, width: probe.naturalWidth, height: probe.naturalHeight });
    setCropping({ fresh: true });
  }

  async function reposition() {
    if (chosen) return setCropping({ fresh: false });
    if (!current?.url) return;
    if (!currentSize) {
      const probe = new Image();
      probe.src = current.url;
      try {
        await probe.decode();
      } catch {
        return;
      }
      setCurrentSize({ width: probe.naturalWidth, height: probe.naturalHeight });
    }
    setCropping({ fresh: false });
  }

  const cropImage = chosen ?? (current?.url && currentSize ? { url: current.url, ...currentSize } : null);

  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <FormMessage state={state} />
      <input type="hidden" name="scope" value={scope} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="focusX" value={Math.round(focus.x)} />
      <input type="hidden" name="focusY" value={Math.round(focus.y)} />

      {src ? (
        <div className="space-y-3">
          <div className="grid grid-cols-[2fr_3fr] gap-3" aria-hidden="true">
            <figure>
              <div className="aspect-[3/1] w-full overflow-hidden rounded-tile bg-surface-muted">
                <img src={src} alt="" className="size-full" style={style} />
              </div>
              <figcaption className="mt-1 text-sm text-text-secondary">Phone</figcaption>
            </figure>
            <figure>
              <div className="aspect-[4.5/1] w-full overflow-hidden rounded-tile bg-surface-muted">
                <img src={src} alt="" className="size-full" style={style} />
              </div>
              <figcaption className="mt-1 text-sm text-text-secondary">Desktop</figcaption>
            </figure>
          </div>
          <p className="text-meta text-text-secondary">
            {chosen ? "New image, not saved yet. " : ""}Focal point: {Math.round(focus.x)}% across, {Math.round(focus.y)}% down.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Crop className="size-4" aria-hidden="true" />} onClick={() => void reposition()} aria-haspopup="dialog">
              Reposition
            </Button>
            {chosen ? (
              <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={clearChoice}>
                {current?.url ? "Keep the current image" : "Remove this image"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <TextField
        ref={fileRef}
        id={`${idPrefix}-file`}
        label={current?.url ? "Replace image" : "Banner image"}
        name="banner"
        type="file"
        optional={Boolean(current?.url)}
        accept="image/png,image/jpeg,image/webp"
        error={tooLarge ? "That image is larger than 4 MB. Choose a smaller one." : fe.banner}
        hint="A wide photo, at least 960 pixels across. PNG, JPEG, or WebP up to 4 MB. You can position it before saving. It's resized, and its metadata (such as location) removed. Text, dates, and times are added by the app; don't put them in the image."
        onChange={(e) => void onFile(e.currentTarget)}
      />
      <TextField
        id={`${idPrefix}-alt`}
        label="Image description"
        name="alt"
        maxLength={300}
        defaultValue={state.values?.alt ?? current?.alt ?? ""}
        error={fe.alt}
        hint="Describe the photo for people using screen readers."
      />
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingText="Saving…" name="intent" value="save">
          Save banner
        </SubmitButton>
        {current?.url ? (
          <SubmitButton size="sm" variant="danger-outline" pendingText="Removing…" name="intent" value="remove" formNoValidate>
            Remove banner
          </SubmitButton>
        ) : null}
      </div>

      {cropping && cropImage ? (
        <ImageCropper
          image={cropImage}
          title="Position the banner"
          description="Drag to the part that must stay visible on phones and desktops."
          shapes={FRAMES}
          initialFraming={{ x: focus.x, y: focus.y, zoom: 1 }}
          allowZoom={false}
          previews={FRAMES.map((f) => ({ label: f.label, aspect: f.aspect }))}
          applyLabel={cropping.fresh ? "Use image" : "Apply"}
          onCancel={() => {
            // Cancelling a new image keeps the current banner; cancelling a reposition keeps the last position.
            if (cropping.fresh) clearChoice();
            setCropping(null);
          }}
          onApply={({ framing }) => {
            setFocus({ x: framing.x, y: framing.y });
            setCropping(null);
          }}
        />
      ) : null}
    </form>
  );
}
