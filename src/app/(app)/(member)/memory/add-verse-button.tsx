"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addVerseAction } from "./actions";

/** Adds a collection verse to My Verses (idempotent), optionally opening it. */
export function AddVerseButton({ itemId, label = "Add to My Verses", then, variant = "secondary" }: { itemId: string; label?: string; then?: "practice"; variant?: "primary" | "secondary" }) {
  const [state, action] = useActionState(addVerseAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="item_id" value={itemId} />
      {then ? <input type="hidden" name="then" value={then} /> : null}
      <SubmitButton size="sm" variant={variant} pendingText="Adding…">
        {label}
      </SubmitButton>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      {state.status === "success" ? (
        <p role="status" className="text-meta font-semibold text-success">
          ✓ {state.message}
        </p>
      ) : null}
    </form>
  );
}
