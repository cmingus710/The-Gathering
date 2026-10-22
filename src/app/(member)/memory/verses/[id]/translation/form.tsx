"use client";

import { useActionState } from "react";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { changeTranslationAction } from "../../../actions";

export function ChangeTranslationForm({ id, translation, code }: { id: string; translation: string; code: string }) {
  const [state, action] = useActionState(changeTranslationAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="translation_id" value={translation} />
      <CheckboxField name="confirm" label={`I understand: this verse will be practiced in ${code}, and my earlier results stay with the earlier text.`} required />
      <SubmitButton pendingText="Changing…">Change to {code}</SubmitButton>
    </form>
  );
}
