"use client";

import { useActionState } from "react";
import { importApplyAction } from "@/app/admin/bible/actions";
import { CheckboxField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

/** The explicit choice between adding and replacing, then one transaction. */
export function ApplyForm({ planId, importId, existingDays, count }: { planId: string; importId: string; existingDays: number; count: number }) {
  const [state, action] = useActionState(importApplyAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="import_id" value={importId} />
      <fieldset className="space-y-2">
        <legend className="font-semibold">How should these {count} days be applied?</legend>
        <label className="flex min-h-11 items-start gap-3">
          <input type="radio" name="mode" value="add" defaultChecked={existingDays === 0} className="mt-1 size-5 accent-(--color-primary)" required />
          <span>
            Add to the draft{" "}
            <span className="block text-meta text-text-secondary">
              {existingDays ? `Keeps its ${existingDays} days. Stops without changing anything if any date or day number is already used.` : "The draft has no days yet."}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <input type="radio" name="mode" value="replace" className="mt-1 size-5 accent-(--color-primary)" />
          <span>
            Replace the draft&apos;s days <span className="block text-meta text-text-secondary">{existingDays ? `Removes the draft's ${existingDays} days first.` : "Same as adding when the draft is empty."}</span>
          </span>
        </label>
      </fieldset>
      <CheckboxField name="confirm" label="I've reviewed the preview." required />
      <SubmitButton pendingText="Importing…">Apply import</SubmitButton>
      <p className="text-meta text-text-secondary">All days are applied together, or none are if anything fails.</p>
    </form>
  );
}
