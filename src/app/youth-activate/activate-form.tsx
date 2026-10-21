"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { activateAction } from "./actions";

export function ActivateForm() {
  const [state, action] = useActionState(activateAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Invitation code" name="code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required hint="Four groups of four letters and numbers, like ABCD-1234-EF56-7890." />
      <SubmitButton pendingText="Checking…">Activate</SubmitButton>
    </form>
  );
}
