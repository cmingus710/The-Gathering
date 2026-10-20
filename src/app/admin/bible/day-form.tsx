"use client";

import { useActionState, useState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addPublishedDayAction, reviseDayAction, saveDayAction } from "./actions";

export type AdminDay = {
  id: string;
  day_number: number | null;
  day_date: string | null;
  kind: "reading" | "rest" | "catch_up";
  heading: string | null;
  notes: string;
  questions: string[];
  discussion_thread_id: string | null;
  revision: number;
  retired_at: string | null;
  passages: Array<{ label: string; book: string; sc: number; sv: number | null; ec: number; ev: number | null }>;
  links: Array<{ id: string; kind: string; title: string }>;
};

export type DayOptions = {
  threads: Array<{ id: string; title: string; group_id: string | null }>;
  content: Array<{ id: string; kind: "devotional" | "lesson"; title: string }>;
};

type Variant = "draft" | "revise" | "add-published";

/**
 * One day of a plan. Passages are typed the way people write them
 * ("Genesis 1–2; Psalm 23"); they're checked against the plan's
 * translation before saving. Published plans need a reason, and past days
 * an explicit correction.
 */
export function DayForm({
  plan,
  day,
  options,
  variant,
  isPast,
}: {
  plan: { id: string; mode: "calendar" | "personal"; audience: "members" | "group"; group_id: string | null };
  day: AdminDay | null;
  options: DayOptions;
  variant: Variant;
  isPast?: boolean;
}) {
  const handler = variant === "draft" ? saveDayAction : variant === "revise" ? reviseDayAction : addPublishedDayAction;
  const [state, action] = useActionState(handler, initialFormState);
  const [kind, setKind] = useState(day?.kind ?? "reading");
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  const threads = options.threads.filter((t) => (plan.audience === "members" ? t.group_id === null : t.group_id === plan.group_id));
  const linked = new Set(day?.links.map((l) => l.id) ?? []);
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={plan.id} />
      <input type="hidden" name="mode" value={plan.mode} />
      {day ? <input type="hidden" name="day_id" value={day.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {plan.mode === "calendar" ? (
          <TextField label="Date" name="day_date" type="date" required defaultValue={v("day_date", day?.day_date ?? "")} error={state.fieldErrors?.day_date} />
        ) : (
          <TextField label="Day number" name="day_number" type="number" min={1} max={2000} required defaultValue={v("day_number", day?.day_number ? String(day.day_number) : "")} error={state.fieldErrors?.day_number} />
        )}
        <SelectField label="Kind of day" name="kind" value={kind} onChange={(e) => setKind(e.target.value as AdminDay["kind"])}>
          <option value="reading">Reading</option>
          <option value="catch_up">Catch-up day (passages optional)</option>
          <option value="rest">Rest day (no passages; never counted as missed)</option>
        </SelectField>
      </div>
      {kind !== "rest" ? (
        <TextField
          label="Passages"
          name="passages"
          required={kind === "reading"}
          defaultValue={v("passages", day?.passages.map((p) => p.label).join("; ") ?? "")}
          hint="Separate passages with semicolons: “Genesis 1–2; Psalm 23” or “John 3:16–21”."
          error={state.fieldErrors?.passages}
        />
      ) : null}
      <TextField label="Heading" name="heading" optional maxLength={160} defaultValue={v("heading", day?.heading ?? "")} />
      <TextAreaField
        label="Reflection questions"
        name="questions"
        optional
        rows={3}
        defaultValue={v("questions", day?.questions.join("\n") ?? "")}
        hint="One per line, up to 5. Members answer privately in their journal; nothing is posted for them."
        error={state.fieldErrors?.questions}
      />
      <TextAreaField label="Supporting notes" name="notes" optional rows={3} maxLength={4000} defaultValue={v("notes", day?.notes ?? "")} hint="Shown above the passages. Bold, italic, lists, and links are supported." />
      <SelectField
        label="Linked discussion"
        name="discussion_thread_id"
        optional
        defaultValue={v("discussion_thread_id", day?.discussion_thread_id ?? "")}
        hint={plan.audience === "group" ? "Only discussions in this plan's group, so the discussion never reaches beyond the plan's readers." : "Only church-wide discussions (all members)."}
      >
        <option value="">None</option>
        {threads.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </SelectField>
      {options.content.length ? (
        <fieldset className="space-y-2">
          <legend className="font-semibold">
            Related devotionals or lessons <span className="font-normal text-text-secondary">(optional)</span>
          </legend>
          <div className="max-h-56 space-y-1 overflow-auto rounded-tile border border-border p-3">
            {options.content.map((c) => (
              <CheckboxField key={c.id} name="links" value={c.id} label={`${c.kind === "lesson" ? "Lesson" : "Devotional"}: ${c.title}`} defaultChecked={linked.has(c.id)} />
            ))}
          </div>
        </fieldset>
      ) : null}
      {variant !== "draft" ? (
        <div className="space-y-3 rounded-tile border border-primary bg-primary-soft p-4">
          <TextAreaField label="Reason for the change" name="reason" required rows={2} maxLength={500} hint="Kept in the plan's change log. Members' history keeps the earlier version." />
          {variant === "revise" && isPast ? (
            <CheckboxField name="correct_past" label="This day has passed. I'm correcting a past assignment." hint="Members who already read it keep their completion and notes on the version they read." />
          ) : (
            <CheckboxField name="confirm" label="I've reviewed the impact of this change." />
          )}
        </div>
      ) : null}
      <SubmitButton pendingText="Saving…">{variant === "revise" ? "Save new revision" : day ? "Save day" : "Add day"}</SubmitButton>
    </form>
  );
}
