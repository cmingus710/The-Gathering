"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addVerseAction } from "../../actions";

/** A passage (book/chapter/verses) or an assigned verse (itemId), in one chosen version. */
export function AddPassageForm(
  props: { translation: string } & ({ itemId: string } | { itemId?: undefined; book: string; chapter: number; from: number; to: number }),
) {
  const [state, action] = useActionState(addVerseAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={props.translation} />
      {!("book" in props) ? (
        <input type="hidden" name="item_id" value={props.itemId} />
      ) : (
        <>
          <input type="hidden" name="book" value={props.book} />
          <input type="hidden" name="chapter" value={props.chapter} />
          <input type="hidden" name="start_verse" value={props.from} />
          <input type="hidden" name="end_verse" value={props.to} />
        </>
      )}
      <input type="hidden" name="then" value="practice" />
      <SubmitButton pendingText="Adding…">Add to My Verses</SubmitButton>
    </form>
  );
}
