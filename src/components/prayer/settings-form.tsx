"use client";

import { useActionState, useState } from "react";
import { prayerSettingsAction } from "@/app/admin/prayer/actions";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { PrayerSettings } from "@/lib/prayer/types";

export function PrayerSettingsForm({ initial }: { initial: PrayerSettings }) {
  const [state, action] = useActionState(prayerSettingsAction, initialFormState);
  const [enabled, setEnabled] = useState(initial.retention_enabled);
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  return (
    <form action={action} className="space-y-8">
      <FormMessage state={state} />
      <TextAreaField label="Member guidance" name="guidance" required maxLength={4000} rows={7} defaultValue={v?.guidance ?? initial.guidance} error={fe.guidance} hint="Shown under “Before you share”. Markdown subset; keep it short." />
      <fieldset className="space-y-4">
        <legend className="mb-1 text-lg font-semibold">Retention</legend>
        <p className="text-meta text-text-secondary">
          Nothing is archived or deleted automatically until the church adopts a written policy and turns this on. Members can always delete their own requests at once. See docs/prayer-retention.md.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Archive closed requests after (days)" name="closedArchiveDays" type="number" min={7} max={3650} defaultValue={v?.closedArchiveDays ?? initial.closed_archive_days} error={fe.closedArchiveDays} />
          <TextField label="Delete archived requests after (days)" name="archivedDeleteDays" type="number" min={30} max={3650} defaultValue={v?.archivedDeleteDays ?? initial.archived_delete_days} error={fe.archivedDeleteDays} />
          <TextField label="Delete closed care requests after (days)" name="careDeleteDays" type="number" min={30} max={3650} defaultValue={v?.careDeleteDays ?? initial.care_delete_days} error={fe.careDeleteDays} />
          <TextField label="Clear report evidence after closing (days)" name="reportEvidenceDays" type="number" min={7} max={1095} defaultValue={v?.reportEvidenceDays ?? initial.report_evidence_days} error={fe.reportEvidenceDays} />
        </div>
        <CheckboxField label="Run these retention rules automatically" name="retentionEnabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} hint="When on, the scheduler archives and permanently deletes records older than these limits, including existing ones." />
        {enabled && !initial.retention_enabled ? (
          <CheckboxField label="The church has reviewed and adopted this retention policy" name="policyConfirmed" hint="Required before turning automatic deletion on. Deleted records can't be recovered." />
        ) : enabled ? (
          <input type="hidden" name="policyConfirmed" value="on" />
        ) : null}
      </fieldset>
      <SubmitButton pendingText="Saving…">Save prayer settings</SubmitButton>
    </form>
  );
}
