"use client";

import { useActionState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveMyCollectionAction } from "../actions";

export function MyCollectionForm({
  id,
  title = "",
  description = "",
  translations,
  defaultTranslation,
}: {
  id?: string;
  title?: string;
  description?: string;
  translations?: Array<{ id: string; label: string }>;
  defaultTranslation?: string;
}) {
  const [state, action] = useActionState(saveMyCollectionAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <TextField label="Title" name="title" defaultValue={state.values?.title ?? title} maxLength={120} required error={state.fieldErrors?.title} />
      <TextAreaField label="Description" name="description" defaultValue={state.values?.description ?? description} maxLength={2000} rows={3} optional />
      {translations ? (
        <SelectField label="Bible version" name="translation_id" defaultValue={defaultTranslation}>
          {translations.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <SubmitButton pendingText="Saving…">{id ? "Save" : "Create collection"}</SubmitButton>
    </form>
  );
}
