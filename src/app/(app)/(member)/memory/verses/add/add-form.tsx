"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addVerseAction } from "../../actions";

export function AddPassageForm({ translation, book, chapter, from, to }: { translation: string; book: string; chapter: number; from: number; to: number }) {
  const [state, action] = useActionState(addVerseAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={translation} />
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="chapter" value={chapter} />
      <input type="hidden" name="start_verse" value={from} />
      <input type="hidden" name="end_verse" value={to} />
      <input type="hidden" name="then" value="practice" />
      <SubmitButton pendingText="Adding…">Add to My Verses</SubmitButton>
    </form>
  );
}
