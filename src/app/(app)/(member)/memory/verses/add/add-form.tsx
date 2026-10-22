"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addVerseAction } from "../../actions";

/**
 * A passage (book/chapter/verses) or an assigned verse (itemId), in one
 * chosen version. The reference also goes along for an assigned verse so
 * the server can fetch a licensed version's text (the database checks it
 * against the assignment).
 */
export function AddPassageForm({
  itemId,
  translation,
  book,
  chapter,
  from,
  endChapter,
  to,
}: {
  itemId?: string;
  translation: string;
  book: string;
  chapter: number;
  from: number;
  endChapter?: number;
  to: number;
}) {
  const [state, action] = useActionState(addVerseAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={translation} />
      {itemId ? <input type="hidden" name="item_id" value={itemId} /> : null}
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="chapter" value={chapter} />
      <input type="hidden" name="start_verse" value={from} />
      <input type="hidden" name="end_chapter" value={endChapter ?? chapter} />
      <input type="hidden" name="end_verse" value={to} />
      <input type="hidden" name="then" value="practice" />
      <SubmitButton pendingText="Adding…">Add to My Verses</SubmitButton>
    </form>
  );
}
