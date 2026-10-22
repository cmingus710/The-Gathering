"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { Passage } from "@/lib/memory/types";
import { refreshLicensedAction } from "../../actions";

/** Starts a licensed version's new wording (the earlier wording keeps its history). */
export function RefreshLicensedForm({ cardId, passage }: { cardId: string; passage: Passage }) {
  const [state, action] = useActionState(refreshLicensedAction, initialFormState);
  return (
    <form action={action} className="mt-2 space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={cardId} />
      <input type="hidden" name="translation_id" value={passage.translation.id} />
      <input type="hidden" name="book" value={passage.book} />
      <input type="hidden" name="chapter" value={passage.start_chapter} />
      <input type="hidden" name="start_verse" value={passage.start_verse} />
      <input type="hidden" name="end_chapter" value={passage.end_chapter} />
      <input type="hidden" name="end_verse" value={passage.end_verse} />
      <SubmitButton size="sm" pendingText="Starting…">
        Practice the new wording
      </SubmitButton>
    </form>
  );
}
