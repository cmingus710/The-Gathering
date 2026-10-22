"use client";

import { useActionState } from "react";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { Passage } from "@/lib/memory/types";
import { changeTranslationAction } from "../../../actions";

/** The reference goes along so the server can fetch a licensed version's text. */
export function ChangeTranslationForm({ id, translation, code, passage }: { id: string; translation: string; code: string; passage: Passage }) {
  const [state, action] = useActionState(changeTranslationAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="translation_id" value={translation} />
      <input type="hidden" name="book" value={passage.book} />
      <input type="hidden" name="chapter" value={passage.start_chapter} />
      <input type="hidden" name="start_verse" value={passage.start_verse} />
      <input type="hidden" name="end_chapter" value={passage.end_chapter} />
      <input type="hidden" name="end_verse" value={passage.end_verse} />
      <CheckboxField name="confirm" label={`I understand: this verse will be practiced in ${code}, and my earlier results stay with the earlier text.`} required />
      <SubmitButton pendingText="Changing…">Change to {code}</SubmitButton>
    </form>
  );
}
