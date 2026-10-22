"use client";

import { useActionState } from "react";
import { CheckboxField, SelectField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { PROBLEM_CATEGORIES, PROBLEM_LIMITS } from "@/lib/feedback/report";
import { initialFormState } from "@/lib/forms";
import { reportProblemAction } from "./actions";

export function ReportProblemForm({ pagePath }: { pagePath: string | null }) {
  const [state, action] = useActionState(reportProblemAction, initialFormState);
  if (state.status === "success") return <FormMessage state={state} successTitle="Report sent" />;
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <SelectField name="category" label="What is it about?" required defaultValue={v.category ?? ""} error={state.fieldErrors?.category}>
        <option value="" disabled>
          Choose one
        </option>
        {PROBLEM_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        name="description"
        label="What happened?"
        hint="What you tried, what you expected, and what happened instead. Please don't include passwords, prayer requests, or other private details."
        required
        minLength={10}
        maxLength={PROBLEM_LIMITS.description}
        defaultValue={v.description ?? ""}
        error={state.fieldErrors?.description}
      />
      {pagePath ? (
        <div className="rounded-tile border border-border bg-surface-muted px-4 py-3">
          <CheckboxField
            name="pagePath"
            value={pagePath}
            defaultChecked={state.status === "idle" || Boolean(v.pagePath)}
            label="Include the page I was on"
            hint={<span className="break-all font-mono text-[0.8125rem]">{pagePath}</span>}
          />
        </div>
      ) : null}
      <CheckboxField
        name="contactOk"
        defaultChecked={v.contactOk === "on"}
        label="An administrator may email me about this"
        hint="Leave this unticked if you'd rather not be contacted. Your name is shared with administrators either way."
      />
      <SubmitButton pendingText="Sending…">Send report</SubmitButton>
    </form>
  );
}
