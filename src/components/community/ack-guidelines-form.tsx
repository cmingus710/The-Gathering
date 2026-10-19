"use client";

import { useActionState } from "react";
import { ackGuidelinesAction } from "@/app/(member)/community/actions";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function AckGuidelinesForm({ version, next }: { version: number; next: string }) {
  const [state, action] = useActionState(ackGuidelinesAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="next" value={next} />
      <CheckboxField name="agree" required label="I've read these guidelines and will follow them." />
      <SubmitButton pendingText="Saving…">Accept and continue</SubmitButton>
    </form>
  );
}
