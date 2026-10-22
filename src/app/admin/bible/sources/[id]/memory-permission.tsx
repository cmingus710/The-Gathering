"use client";

import { useActionState } from "react";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { memoryPermissionAction } from "../actions";

export type MemoryPermission = { unchanged_text: boolean; terms_note: string | null; confirmed_at: string | null; confirmed_by: string | null; cards: number };

/**
 * Memory verses for a licensed version: enabled only after someone records
 * that this version's own terms permit it. Only unchanged-text practice
 * (verse page, flashcards, self-check) can be enabled; activities that hide
 * or rearrange words need written permission and a code change.
 */
export function MemoryPermissionForm({ translationId, code, permission }: { translationId: string; code: string; permission: MemoryPermission | null }) {
  const [state, action] = useActionState(memoryPermissionAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={translationId} />
      <CheckboxField
        name="unchanged_text"
        label={`Offer ${code} for memory verses, shown unchanged`}
        defaultChecked={permission?.unchanged_text ?? false}
        hint="Members see the verse exactly as API.Bible returns it, with its copyright and usage reporting, in flashcards and self-check. The text is fetched when shown and never stored. Turning this off pauses practice; members' verses and results are kept."
      />
      <TextAreaField
        label="What you checked"
        name="terms_note"
        rows={4}
        maxLength={2000}
        required
        defaultValue={state.values?.terms_note ?? permission?.terms_note ?? ""}
        error={state.fieldErrors?.terms_note}
        hint={`For example: the API.Bible dashboard entry for ${code}, its license or publisher terms, the date, and what they say about memory verses, caching, and FUMS.`}
      />
      <p className="text-meta text-text-secondary">
        Activities that hide or rearrange words (read &amp; repeat, missing words, word order) and typed recall aren&apos;t available for licensed versions, whatever is
        recorded here.
      </p>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
