"use client";

import { useActionState } from "react";
import { liftRestrictionAction, resolveReportAction, restrictAction } from "@/app/admin/moderation/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function ResolveReportForm({ reportId, closed }: { reportId: string; closed: boolean }) {
  const [state, action] = useActionState(resolveReportAction, initialFormState);
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
      <TextAreaField
        label="Resolution"
        name="resolution"
        required
        minLength={3}
        maxLength={1000}
        rows={3}
        defaultValue={state.values?.resolution}
        hint="What you decided and why. Recorded in the moderation log (no message text)."
      />
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

export function RestrictForm({ profileId, name, reportId }: { profileId: string; name: string; reportId?: string }) {
  const [state, action] = useActionState(restrictAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="reportId" value={reportId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Restrict" name="scope" defaultValue="posting">
          <option value="posting">Posting (discussions, replies, reactions)</option>
          <option value="messaging">Direct messaging</option>
          <option value="all">Both</option>
        </SelectField>
        <SelectField label="For" name="days" defaultValue="7">
          <option value="1">1 day</option>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="none">Until lifted</option>
        </SelectField>
      </div>
      <TextAreaField label="Reason (shown to the member)" name="reason" required minLength={3} maxLength={500} rows={2} />
      <p className="text-meta text-text-secondary">
        This affects only community participation for {name}. It doesn&apos;t change church membership, the directory, giving, or events. Only membership
        administrators can suspend membership.
      </p>
      <SubmitButton size="sm" variant="danger" pendingText="Applying…">
        Apply restriction
      </SubmitButton>
    </form>
  );
}

export function LiftRestriction({ restrictionId, name }: { restrictionId: string; name: string }) {
  const [state, action] = useActionState(liftRestrictionAction, initialFormState);
  return (
    <>
      <FormMessage state={state} />
      <ConfirmDialog
        triggerVariant="secondary"
        trigger={<>Lift<span className="sr-only"> restriction for {name}</span></>}
        title={`Lift the restriction for ${name}?`}
        confirmLabel="Lift restriction"
        formAction={action}
        hidden={{ restrictionId }}
        fields={<TextAreaField label="Note (recorded)" name="reason" maxLength={500} rows={2} className="mb-4" />}
      />
    </>
  );
}
