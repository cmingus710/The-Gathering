"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { deleteAllAction } from "./actions";

export function DeleteAllForm() {
  const [state, action] = useActionState(deleteAllAction, initialFormState);
  return (
    <details className="rounded-tile border border-border px-4 py-2">
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-danger">Delete my whole journal</summary>
      <form action={action} className="space-y-3 pb-3">
        <FormMessage state={state} />
        <p className="text-meta text-text-secondary">This permanently deletes every entry, including archived ones. Download a copy first if you want to keep it.</p>
        <TextField label="Type DELETE to confirm" name="confirm" autoComplete="off" required />
        <SubmitButton variant="danger" pendingText="Deleting…">
          Delete every entry
        </SubmitButton>
      </form>
    </details>
  );
}
