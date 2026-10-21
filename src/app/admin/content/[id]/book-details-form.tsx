"use client";

import { useActionState } from "react";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveBookDetailsAction } from "../actions";

export type BookDetailsAdmin = {
  kindle_url: string | null;
  reading_starts_on: string | null;
  reading_ends_on: string | null;
  related_lesson_id: string | null;
  lessons: Array<{ id: string; title: string; delivered_on: string | null }>;
};

/** Kindle link, the book's reading dates, and an optional related lesson (Phase 13). */
export function BookDetailsForm({ id, details }: { id: string; details: BookDetailsAdmin }) {
  const [state, action] = useActionState(saveBookDetailsAction, initialFormState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <TextField
        label="Kindle link"
        name="kindle_url"
        type="url"
        inputMode="url"
        optional
        defaultValue={v?.kindle_url ?? details.kindle_url ?? ""}
        error={fe.kindle_url}
        hint="The book's Amazon page (…/dp/…) or a read.amazon.com link. Members open it with their own Amazon account; nothing is embedded or synced."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Reading starts" name="reading_starts_on" type="date" optional defaultValue={v?.reading_starts_on ?? details.reading_starts_on ?? ""} />
        <TextField
          label="Reading ends"
          name="reading_ends_on"
          type="date"
          optional
          defaultValue={v?.reading_ends_on ?? details.reading_ends_on ?? ""}
          error={fe.reading_ends_on}
        />
      </div>
      <SelectField label="Related Sunday lesson" name="related_lesson_id" optional defaultValue={v?.related_lesson_id ?? details.related_lesson_id ?? ""} hint="Shown only to members who can see that lesson.">
        <option value="">None</option>
        {details.lessons.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title}
            {l.delivered_on ? ` (${l.delivered_on})` : ""}
          </option>
        ))}
      </SelectField>
      <p className="text-meta text-text-secondary">
        For a chapter schedule, add reading assignments for this book (one per week or chapter range, each with its own dates).
      </p>
      <SubmitButton size="sm" pendingText="Saving…">
        Save reading details
      </SubmitButton>
    </form>
  );
}
