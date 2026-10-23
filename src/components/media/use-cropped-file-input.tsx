"use client";

import { Crop, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CENTRED, type Framing } from "@/lib/media/framing";
import { derivedName, loadEditableImage, renderFramed, type EditableImage } from "@/lib/media/image-edit";
import { ImageCropper, WHOLE_PHOTO, type CropShape } from "./image-cropper";

/** `file` is what the input carries: the original or a cropped copy of it. */
type Chosen = { original: File; file: File; image: EditableImage | null; shapeId: string; framing: Framing; preview: string };

/**
 * Cropping for a plain `<input type="file">` that a form submits as usual
 * (event, announcement, campaign, plan, and collection images, each stored
 * per item). After choosing a photo it opens in the shared cropper at the
 * frame the image is shown in, with "Whole image" as the alternative; the
 * input then carries the cropped copy (or the original), so the server
 * action and its checks (type, size, dimensions, metadata removal) are
 * unchanged. "Edit crop" starts again from the original until the form is
 * saved. Cancelling the first crop clears the choice and keeps the current
 * image; a dismissed picker changes nothing (if the browser emptied the
 * field, the chosen file is put back).
 *
 * Spread `inputProps` on the input, and render `controls` and `dialog`.
 */
export function useCroppedFileInput({
  aspect,
  frameLabel,
  maxBytes,
  savedKey,
}: {
  aspect: number;
  frameLabel: string;
  maxBytes?: number;
  /** Changes when the form's saved image changes (e.g. its signed URL): the local choice is then dropped. */
  savedKey?: unknown;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [cropping, setCropping] = useState<"fresh" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const shapes: CropShape[] = [{ id: "frame", label: frameLabel, aspect }, { ...WHOLE_PHOTO, label: "Whole image" }];
  const chosenRef = useRef(chosen);
  useEffect(() => {
    chosenRef.current = chosen;
  });
  useEffect(
    () => () => {
      chosenRef.current?.image?.release();
      if (chosenRef.current) URL.revokeObjectURL(chosenRef.current.preview);
    },
    [],
  );

  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    if (chosen) {
      chosen.image?.release();
      URL.revokeObjectURL(chosen.preview);
      setChosen(null);
      setCropping(null);
    }
  }

  // A form action resets the form when it finishes; after a failed save the
  // chosen image must still be there (forms clear() it after a success).
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () =>
      setTimeout(() => {
        const c = chosenRef.current;
        if (c && !ref.current?.files?.length && !put(c.file)) clear();
      });
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  });

  /** Puts a file in the input; false if this browser doesn't allow it. */
  function put(file: File): boolean {
    const input = ref.current;
    if (!input) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      return input.files?.length === 1;
    } catch {
      return false;
    }
  }

  function clear() {
    const c = chosenRef.current;
    c?.image?.release();
    if (c) URL.revokeObjectURL(c.preview);
    if (ref.current) ref.current.value = "";
    setChosen(null);
    setCropping(null);
    setError(null);
    setNote(null);
  }

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) {
      // The picker was dismissed. Some browsers empty the field: keep what was chosen.
      if (chosenRef.current && !put(chosenRef.current.file)) clear();
      return;
    }
    setNote(null);
    const big = Boolean(maxBytes && file.size > maxBytes);
    setTooLarge(big);
    if (big) {
      clear();
      return;
    }
    chosenRef.current?.image?.release();
    if (chosenRef.current) URL.revokeObjectURL(chosenRef.current.preview);
    try {
      const image = await loadEditableImage(file);
      setChosen({ original: file, file, image, shapeId: "frame", framing: CENTRED, preview: URL.createObjectURL(file) });
      setCropping("fresh");
    } catch {
      // Can't show it here: it uploads as chosen, and the server checks it.
      setChosen({ original: file, file, image: null, shapeId: WHOLE_PHOTO.id, framing: CENTRED, preview: URL.createObjectURL(file) });
      setNote("This image can't be previewed in this browser, so it will be uploaded as it is.");
    }
  }

  async function apply(shape: CropShape, framing: Framing) {
    const c = chosenRef.current;
    if (!c?.image) return;
    setBusy(true);
    setError(null);
    try {
      let file = c.original;
      if (shape.aspect) {
        const type = c.original.type === "image/png" ? "image/png" : "image/jpeg";
        file = await renderFramed(c.image, { aspect: shape.aspect, framing, maxSide: 2400, type, name: derivedName(c.original.name, type) });
      }
      if (!put(file)) {
        put(c.original);
        setNote("This browser can't attach the cropped copy, so the whole image will be uploaded.");
        file = c.original;
      }
      URL.revokeObjectURL(c.preview);
      setChosen({ ...c, file, shapeId: file === c.original ? WHOLE_PHOTO.id : shape.id, framing, preview: URL.createObjectURL(file) });
      setCropping(null);
    } catch {
      setError("This image couldn't be cropped on this device. Try again, or choose Whole image.");
    } finally {
      setBusy(false);
    }
  }

  // Nothing to report until the first crop is applied (or skipped because the image can't be shown).
  const controls: ReactNode = chosen && cropping !== "fresh" ? (
    <div className="space-y-1">
      <p className="text-meta text-text-secondary">
        <span className="font-semibold text-text">New image, not saved yet.</span> {chosen.shapeId === "frame" ? `Cropped to ${frameLabel}.` : "Whole image."}
      </p>
      <div className="flex flex-wrap gap-1">
        {chosen.image ? (
          <Button variant="secondary" size="sm" icon={<Crop className="size-4" aria-hidden="true" />} onClick={() => setCropping("edit")} aria-haspopup="dialog">
            Edit crop
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={clear}>
          Don&apos;t use this image
        </Button>
      </div>
      {note ? <p className="text-meta text-text-secondary">{note}</p> : null}
    </div>
  ) : null;

  const dialog: ReactNode =
    chosen?.image && cropping ? (
      <ImageCropper
        image={chosen.image}
        title="Crop the image"
        description={`Shown at ${frameLabel}. Nothing is saved until you save the form.`}
        shapes={shapes}
        initialShape={chosen.shapeId}
        initialFraming={chosen.framing}
        applyLabel="Use image"
        busy={busy}
        error={error}
        onCancel={() => (cropping === "fresh" ? clear() : setCropping(null))}
        onApply={({ shape, framing }) => void apply(shape, framing)}
      />
    ) : null;

  return {
    inputProps: { ref, onChange: (e: ChangeEvent<HTMLInputElement>) => void onChange(e) },
    /** Object URL of what will be uploaded (cropped or whole), or null. */
    preview: chosen?.preview ?? null,
    tooLarge,
    clear,
    controls,
    dialog,
  };
}
