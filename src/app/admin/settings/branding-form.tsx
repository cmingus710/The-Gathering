"use client";

/* eslint-disable @next/next/no-img-element -- local object-URL previews and storage URLs */
import { RotateCcw, Upload } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { restoreBrandAssetAction, uploadBrandAssetAction } from "./actions";

const ACCEPT = "image/png,image/jpeg,image/webp";

export function BrandAssetForm({
  asset,
  currentUrl,
  isDefault,
}: {
  asset: "logo" | "icon";
  currentUrl: string;
  isDefault: boolean;
}) {
  const [uploadState, upload] = useActionState(uploadBrandAssetAction, initialFormState);
  const [restoreState, restore] = useActionState(restoreBrandAssetAction, initialFormState);
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = asset === "logo" ? "Full logo" : "App icon";
  const inputId = `brand-${asset}-file`;

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  useEffect(() => {
    if (uploadState.status === "success") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the local preview once the server accepted the file
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [uploadState]);

  const error = clientError ?? uploadState.fieldErrors?.file?.[0];

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">{label}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["#F7F4ED", "#FFFFFF"] as const).map((bg) => (
          <figure key={bg} className="flex flex-col items-center justify-center rounded-control border border-border p-4" style={{ background: bg }}>
            <img src={preview ?? currentUrl} alt="" className={asset === "logo" ? "max-h-36 w-auto max-w-full object-contain" : "h-20 w-auto object-contain"} />
            <figcaption className="mt-2 text-sm text-text-secondary">{bg === "#FFFFFF" ? "On white" : "On ivory"}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-meta text-text-secondary">
        {preview ? "Previewing your selected file — not saved yet." : isDefault ? "Using the approved artwork." : "Using an uploaded replacement."}
      </p>

      <form action={upload} className="space-y-3">
        <FormMessage state={uploadState} />
        <input type="hidden" name="asset" value={asset} />
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="block font-semibold">
            Replace {asset}
          </label>
          <p id={`${inputId}-hint`} className="text-meta text-text-secondary">
            PNG, JPEG, or WebP, up to 2 MB{asset === "icon" ? ", at least 192 × 192 pixels" : ""}. Use the approved artwork without stretching or cropping.
          </p>
          <input
            ref={inputRef}
            id={inputId}
            name="file"
            type="file"
            accept={ACCEPT}
            aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
            aria-invalid={error ? true : undefined}
            className="block w-full text-meta file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-control file:border file:border-border-strong file:bg-surface file:px-4 file:font-semibold hover:file:bg-primary-soft"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setClientError(null);
              if (!file) return setPreview(null);
              if (!ACCEPT.split(",").includes(file.type)) {
                setClientError("Choose a PNG, JPEG, or WebP image.");
                return setPreview(null);
              }
              if (file.size > 2 * 1024 * 1024) {
                setClientError("The file must be 2 MB or smaller.");
                return setPreview(null);
              }
              setPreview(URL.createObjectURL(file));
            }}
          />
          {error ? (
            <p id={`${inputId}-error`} className="font-medium text-danger">
              <span className="sr-only">Error: </span>
              {error}
            </p>
          ) : null}
        </div>
        <SubmitButton size="sm" pendingText="Uploading…" icon={<Upload className="size-4" aria-hidden="true" />}>
          Save new {asset}
        </SubmitButton>
      </form>

      {!isDefault ? (
        <form action={restore} className="space-y-2">
          <FormMessage state={restoreState} />
          <input type="hidden" name="asset" value={asset} />
          <SubmitButton size="sm" variant="secondary" pendingText="Restoring…" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
            Restore approved {asset}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
