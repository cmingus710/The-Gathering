"use client";

import { useActionState, useMemo, useState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { savePlanAction } from "./actions";

export type PlanOptions = {
  translations: Array<{ id: string; code: string; name: string; status: string }>;
  default_translation_id: string | null;
  church_timezone: string;
  groups: Array<{ id: string; name: string }>;
};

export type PlanFormValues = {
  id?: string;
  title: string;
  description: string;
  translation_id: string;
  audience: "members" | "group";
  group_id: string | null;
  audience_note: string | null;
  mode: "calendar" | "personal";
  timezone: string;
  status: "draft" | "published" | "archived";
  days: number;
};

/** Plan details. Schedule, translation, time zone, and audience lock once published. */
export function PlanForm({ plan, options, timezones }: { plan: PlanFormValues | null; options: PlanOptions; timezones: string[] }) {
  const [state, action] = useActionState(savePlanAction, initialFormState);
  const clientKey = useMemo(() => crypto.randomUUID(), []);
  const [audience, setAudience] = useState(plan?.audience ?? "members");
  const locked = !!plan && plan.status !== "draft";
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      {plan?.id ? <input type="hidden" name="id" value={plan.id} /> : <input type="hidden" name="client_key" value={clientKey} />}
      <TextField label="Title" name="title" required maxLength={120} defaultValue={v("title", plan?.title ?? "")} error={state.fieldErrors?.title} />
      <TextAreaField label="Description" name="description" optional maxLength={4000} defaultValue={v("description", plan?.description ?? "")} />
      <TextField
        label="Who it's for"
        name="audience_note"
        optional
        maxLength={120}
        defaultValue={v("audience_note", plan?.audience_note ?? "")}
        hint="Shown to members, for example “Everyone” or “New to the Bible”."
      />
      {locked ? (
        <p className="rounded-tile border border-border bg-surface-muted/60 px-4 py-3 text-meta text-text-secondary">
          This plan is {plan!.status}. Its schedule ({plan!.mode === "calendar" ? "dated" : "numbered days"}), translation, time zone, and audience can&apos;t change, so members&apos; progress and notes stay correct. To change them, create a new version.
        </p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="font-semibold">Schedule</legend>
            {plan && plan.days > 0 ? (
              <>
                <input type="hidden" name="mode" value={plan.mode} />
                <p className="text-meta text-text-secondary">{plan.mode === "calendar" ? "Dated (church calendar)" : "Numbered days (personal start date)"}. Remove all days to change it.</p>
              </>
            ) : (
              <>
                <label className="flex min-h-11 items-start gap-3">
                  <input type="radio" name="mode" value="calendar" defaultChecked={(plan?.mode ?? "calendar") === "calendar"} className="mt-1 size-5 accent-(--color-primary)" />
                  <span>
                    Dated church plan <span className="block text-meta text-text-secondary">Everyone reads the same passage on the same date (for example a yearly plan).</span>
                  </span>
                </label>
                <label className="flex min-h-11 items-start gap-3">
                  <input type="radio" name="mode" value="personal" defaultChecked={plan?.mode === "personal"} className="mt-1 size-5 accent-(--color-primary)" />
                  <span>
                    Numbered days <span className="block text-meta text-text-secondary">Day 1, Day 2… Each member chooses a start date.</span>
                  </span>
                </label>
              </>
            )}
          </fieldset>
          <SelectField label="Translation" name="translation_id" defaultValue={v("translation_id", plan?.translation_id ?? options.default_translation_id ?? options.translations[0]?.id ?? "")} required hint="Passages are checked against this translation.">
            {options.translations.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} · {t.name}
                {t.status !== "active" ? " (not active yet)" : ""}
              </option>
            ))}
          </SelectField>
          <SelectField label="Time zone for dated plans" name="timezone" defaultValue={v("timezone", plan?.timezone ?? options.church_timezone)} hint="“Today” for a dated plan follows this time zone. Personal plans use each member's own.">
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Audience" name="audience" value={audience} onChange={(e) => setAudience(e.target.value as "members" | "group")}>
              <option value="members">All approved members</option>
              <option value="group">One group</option>
            </SelectField>
            {audience === "group" ? (
              <SelectField label="Group" name="group_id" defaultValue={plan?.group_id ?? options.groups[0]?.id ?? ""} required>
                {options.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
        </>
      )}
      <SubmitButton pendingText="Saving…">{plan?.id ? "Save details" : "Create draft"}</SubmitButton>
    </form>
  );
}
