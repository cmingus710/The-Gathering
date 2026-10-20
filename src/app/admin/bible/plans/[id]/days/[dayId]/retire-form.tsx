"use client";

import { useActionState } from "react";
import { retireDayAction } from "@/app/admin/bible/actions";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function RetireForm({ planId, dayId, isPast }: { planId: string; dayId: string; isPast: boolean }) {
  const [state, action] = useActionState(retireDayAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="day_id" value={dayId} />
      <TextAreaField label="Reason" name="reason" required rows={2} maxLength={500} />
      {isPast ? <CheckboxField name="correct_past" label="This day has passed. I'm correcting a past assignment." /> : <CheckboxField name="confirm" label="I've reviewed the impact." />}
      <SubmitButton variant="danger-outline" pendingText="Retiring…">
        Retire day
      </SubmitButton>
    </form>
  );
}
