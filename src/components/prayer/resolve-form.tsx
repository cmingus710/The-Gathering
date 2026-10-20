"use client";

import { useActionState } from "react";
import { prayerResolveAction } from "@/app/admin/prayer/actions";
import { TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function PrayerResolveForm({ reportId, closed }: { reportId: string; closed: boolean }) {
  const [state, action] = useActionState(prayerResolveAction, initialFormState);
  if (closed) {
    return (
      <form action={action} className="space-y-2">
        <FormMessage state={state} />
        <input type="hidden" name="reportId" value={reportId} />
        <input type="hidden" name="status" value="open" />
        <input type="hidden" name="resolution" value="" />
        <SubmitButton size="sm" variant="secondary">
          Reopen report
        </SubmitButton>
      </form>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="reportId" value={reportId} />
      <TextAreaField label="Resolution" name="resolution" required minLength={3} maxLength={1000} rows={3} hint="What you decided and why. Don't copy the reported text here." />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="status" value="actioned" size="sm" pendingText="Saving…">
          Close: action taken
        </SubmitButton>
        <SubmitButton name="status" value="dismissed" size="sm" variant="secondary" pendingText="Saving…">
          Close: no action needed
        </SubmitButton>
      </div>
    </form>
  );
}
