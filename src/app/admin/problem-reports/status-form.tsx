"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { setProblemReportStatusAction } from "./actions";

export function ProblemReportStatusForm({ id, resolved }: { id: string; resolved: boolean }) {
  const [state, action] = useActionState(setProblemReportStatusAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={resolved ? "new" : "resolved"} />
      <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
        {resolved ? "Reopen" : "Mark resolved"}
      </SubmitButton>
    </form>
  );
}
