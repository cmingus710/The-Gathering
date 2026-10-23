"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveMediaSettingsAction } from "../actions";

type Field = [key: string, label: string, hint: string, min: number, max: number];

const LIBRARY: Field[] = [
  ["audio_max_mb", "Audio upload limit (MB)", "Supabase's Free plan accepts at most 50 MB per file.", 1, 5000],
  ["video_max_mb", "Video upload limit (MB)", "Raise above 50 only after moving to a paid plan and raising the bucket limit.", 1, 5000],
  ["document_max_mb", "Document upload limit (MB)", "", 1, 200],
  ["image_max_mb", "Image upload limit (MB)", "", 1, 50],
  ["storage_quota_mb", "Storage limit for the usage report (MB)", "Free plan: 1 GB for the whole project (900 MB leaves room for other files).", 100, 10_000_000],
  ["abandoned_upload_hours", "Offer unfinished uploads for cleanup after (hours)", "", 1, 720],
];
const GALLERY: Field[] = [
  ["gallery_file_mb", "Largest photo (MB)", "Phone photos are usually 2–8 MB.", 1, 50],
  ["gallery_batch_max", "Photos per upload batch", "", 1, 100],
  ["gallery_daily_max", "Photos per member per day", "", 1, 1000],
  ["gallery_pending_max", "Photos a member may have waiting for review", "", 1, 1000],
];
const FEEDS: Field[] = [["feed_refresh_minutes", "Refresh external podcast feeds every (minutes)", "At least 60. Managers can also refresh a show by hand.", 60, 10080]];

export function MediaSettingsForm({ values, sections }: { values: Record<string, number>; sections: { library: boolean; gallery: boolean; feeds: boolean } }) {
  const [state, action] = useActionState(saveMediaSettingsAction, initialFormState);
  const group = (title: string, fields: Field[]) => (
    <fieldset className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
      <legend className="float-left mb-2 w-full text-lg font-semibold">{title}</legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2">
        {fields.map(([key, label, hint, min, max]) => (
          <TextField
            key={key}
            label={label}
            name={key}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            defaultValue={state.values?.[key] ?? String(values[key] ?? "")}
            hint={hint || undefined}
            error={state.fieldErrors?.[key]}
          />
        ))}
      </div>
    </fieldset>
  );
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      {sections.library ? group("Media library", LIBRARY) : null}
      {sections.gallery ? group("Media gallery", GALLERY) : null}
      {sections.feeds ? group("External podcast feeds", FEEDS) : null}
      <SubmitButton pendingText="Saving…">Save limits</SubmitButton>
    </form>
  );
}
