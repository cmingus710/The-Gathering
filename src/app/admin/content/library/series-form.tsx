"use client";

import { useActionState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveSeriesAction } from "../actions";
import type { AssetChoice, Taxonomy } from "../editor-data";

export function SeriesForm({ series, covers }: { series: Taxonomy["series"][number] | null; covers: AssetChoice[] }) {
  const [state, action] = useActionState(saveSeriesAction, initialFormState);
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
      <SelectField id={`series-cover-${key}`} label="Cover image" name="cover_asset_id" defaultValue={series?.cover_asset_id ?? ""} optional>
        <option value="">None</option>
        {covers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </SelectField>
      {series ? <CheckboxField id={`series-archived-${key}`} name="archived" label="Archived (hidden from members)" defaultChecked={series.archived} /> : null}
      <SubmitButton size="sm" pendingText="Saving…">
        {series ? "Save series" : "Add series"}
      </SubmitButton>
    </form>
  );
}
