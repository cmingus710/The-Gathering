"use client";

/* eslint-disable @next/next/no-img-element -- object-URL and signed-URL previews */
import { useActionState, useEffect, useState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { MAX_COVER_BYTES } from "@/lib/events/limits";
import { initialFormState, type FormState } from "@/lib/forms";
import { saveHomeBannerAction } from "./banner-actions";

export type BannerValue = { url: string | null; alt: string; focusX: number; focusY: number };

/**
 * Upload, describe, position, replace, or remove a homepage "Coming up"
 * banner. The focal point is chosen by clicking the image or with the two
 * sliders (keyboard), and the crops show how the banner fills a phone and a
 * desktop screen. Nothing changes until "Save banner".
 */
export function HomeBannerForm({ scope, id, current, idPrefix = "banner" }: { scope: "event" | "default"; id?: string; current: BannerValue | null; idPrefix?: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  // React clears the file input after the action runs, so the local preview goes with it.
  const [state, action] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await saveHomeBannerAction(prev, formData);
    setPreview(null);
    return result;
  }, initialFormState);
  const [tooLarge, setTooLarge] = useState(false);
  const [focus, setFocus] = useState({ x: current?.focusX ?? 50, y: current?.focusY ?? 50 });
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const src = preview ?? current?.url ?? null;
  const fe = state.fieldErrors ?? {};
  const position = `${focus.x}% ${focus.y}%`;

  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <FormMessage state={state} />
      <input type="hidden" name="scope" value={scope} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="focusX" value={focus.x} />
      <input type="hidden" name="focusY" value={focus.y} />

      {src ? (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-meta font-semibold">Focal point</p>
            <button
              type="button"
              className="relative block w-full overflow-hidden rounded-card border border-border bg-surface-muted"
              aria-label="Set the focal point: click the part of the image that must stay visible"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setFocus({ x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100) });
              }}
            >
              <img src={src} alt="" className="block h-auto w-full" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgb(0_0_0/0.55)]"
                style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
              />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-meta font-semibold">
              Horizontal: {focus.x}%
              <input type="range" min={0} max={100} value={focus.x} onChange={(e) => setFocus((f) => ({ ...f, x: Number(e.currentTarget.value) }))} className="mt-1 block w-full accent-primary" />
            </label>
            <label className="block text-meta font-semibold">
              Vertical: {focus.y}%
              <input type="range" min={0} max={100} value={focus.y} onChange={(e) => setFocus((f) => ({ ...f, y: Number(e.currentTarget.value) }))} className="mt-1 block w-full accent-primary" />
            </label>
          </div>
          <div className="grid grid-cols-[2fr_3fr] gap-3" aria-hidden="true">
            <figure>
              <img src={src} alt="" className="aspect-[3/1] w-full rounded-tile object-cover" style={{ objectPosition: position }} />
              <figcaption className="mt-1 text-sm text-text-secondary">Phone</figcaption>
            </figure>
            <figure>
              <img src={src} alt="" className="aspect-[4.5/1] w-full rounded-tile object-cover" style={{ objectPosition: position }} />
              <figcaption className="mt-1 text-sm text-text-secondary">Desktop</figcaption>
            </figure>
          </div>
        </div>
      ) : null}

      <TextField
        id={`${idPrefix}-file`}
        label={current?.url ? "Replace image" : "Banner image"}
        name="banner"
        type="file"
        optional={Boolean(current?.url)}
        accept="image/png,image/jpeg,image/webp"
        error={tooLarge ? "That image is larger than 4 MB. Choose a smaller one." : fe.banner}
        hint="A wide photo, at least 960 pixels across. PNG, JPEG, or WebP up to 4 MB. It's resized, and its metadata (such as location) removed. Text, dates, and times are added by the app; don't put them in the image."
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          const big = Boolean(f && f.size > MAX_COVER_BYTES);
          setTooLarge(big);
          if (big) e.currentTarget.value = "";
          setPreview(f && !big ? URL.createObjectURL(f) : null);
          if (f && !big) setFocus({ x: 50, y: 50 });
        }}
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
    </form>
  );
}
