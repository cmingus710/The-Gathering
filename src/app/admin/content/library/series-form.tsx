"use client";

import { useActionState } from "react";
import { CoverImageField } from "@/components/media/cover-image-field";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { saveSeriesAction } from "../actions";
import type { Taxonomy } from "../editor-data";

export function SeriesForm({ series, canUpload, imageMaxMb }: { series: Taxonomy["series"][number] | null; canUpload: boolean; imageMaxMb?: number }) {
  // Counts successful saves, so the cover control starts over from what was saved.
  const [state, action] = useActionState<FormState & { saves?: number }, FormData>(async (prev, formData) => {
    const result = await saveSeriesAction(prev, formData);
    return { ...result, saves: (prev.saves ?? 0) + (result.status === "success" ? 1 : 0) };
  }, initialFormState);
  const key = series?.id ?? "new";
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      {series ? <input type="hidden" name="id" value={series.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`series-title-${key}`} label="Title" name="title" maxLength={160} defaultValue={state.values?.title ?? series?.title ?? ""} error={state.fieldErrors?.title} />
        <SelectField id={`series-scope-${key}`} label="Used for" name="scope" defaultValue={series?.scope ?? "lesson"}>
          <option value="lesson">Sunday lessons</option>
          <option value="devotional">Devotionals</option>
          <option value="episode">Podcast episodes</option>
          <option value="any">Any kind</option>
        </SelectField>
      </div>
      <TextAreaField id={`series-desc-${key}`} label="Description" name="description" rows={3} maxLength={2000} defaultValue={series?.description ?? ""} optional />
      <fieldset className="space-y-2">
        <legend className="font-semibold">
          Cover image <span className="font-normal text-text-secondary">(optional)</span>
        </legend>
        <CoverImageField
          key={`${series?.cover_asset_id ?? ""}-${state.saves ?? 0}`}
          name="cover_asset_id"
          defaultAssetId={series?.cover_asset_id}
          canUpload={canUpload}
          maxUploadMb={imageMaxMb}
          saveLabel={series ? "Save series" : "Add series"}
        />
      </fieldset>
      {series ? <CheckboxField id={`series-archived-${key}`} name="archived" label="Archived (hidden from members)" defaultChecked={series.archived} /> : null}
      <SubmitButton size="sm" pendingText="Saving…">
        {series ? "Save series" : "Add series"}
      </SubmitButton>
    </form>
  );
}
