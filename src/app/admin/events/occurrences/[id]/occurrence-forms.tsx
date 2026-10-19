"use client";

import { UserPlus } from "lucide-react";
import { useActionState } from "react";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { adminCancelRegistrationAction, adminRegisterAction, occurrenceStatusAction, saveOccurrenceAction } from "../../actions";

export type OccurrenceOverrides = {
  overrideDate: string;
  overrideStartTime: string;
  overrideDuration: string;
  locationName: string;
  locationAddress: string;
  onlineUrl: string;
  note: string;
};

export function OccurrenceEditForm({ id, allDay, initial }: { id: string; allDay: boolean; initial: OccurrenceOverrides }) {
  const [state, action] = useActionState(saveOccurrenceAction, initialFormState);
  const v = (k: keyof OccurrenceOverrides) => state.values?.[k] ?? initial[k];
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="occurrenceId" value={id} />
      <p className="text-sm text-text-secondary">
        Changes here apply to this date only and survive later edits to the series. Leave a field blank to use the series value. Changing the date, time, or place emails people registered for this date.
      </p>
      <div className="grid gap-4">
        <TextField label="Move to date" name="overrideDate" type="date" optional defaultValue={v("overrideDate")} />
        {!allDay ? (
          <>
            <TextField label="Start time" name="overrideStartTime" type="time" optional defaultValue={v("overrideStartTime")} />
            <TextField label="Length (minutes)" name="overrideDuration" inputMode="numeric" optional defaultValue={v("overrideDuration")} error={fe.overrideDuration} />
          </>
        ) : null}
      </div>
      <TextField label="Location name" name="locationName" optional maxLength={200} defaultValue={v("locationName")} />
      <TextField label="Address" name="locationAddress" optional maxLength={300} defaultValue={v("locationAddress")} />
      <TextField label="Online meeting link" name="onlineUrl" type="url" optional placeholder="https://" defaultValue={v("onlineUrl")} error={fe.onlineUrl} />
      <TextField label="Note for this date" name="note" optional maxLength={500} defaultValue={v("note")} hint="Shown on the event page, e.g. “Meeting in the fellowship hall this week.”" />
      <SubmitButton size="sm" pendingText="Saving…">
        Save this date
      </SubmitButton>
    </form>
  );
}

export function OccurrenceStatusForm({ id, canceled }: { id: string; canceled: boolean }) {
  const [state, action] = useActionState(occurrenceStatusAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="occurrenceId" value={id} />
      <input type="hidden" name="op" value={canceled ? "restore" : "cancel"} />
      {!canceled ? <TextField label="Reason (shown to members)" name="reason" optional maxLength={500} /> : null}
      <SubmitButton size="sm" variant={canceled ? "secondary" : "danger-outline"} pendingText="Saving…">
        {canceled ? "Restore this date" : "Cancel this date only"}
      </SubmitButton>
    </form>
  );
}

export function AdminRegisterForm({ occurrenceId, profileId, name }: { occurrenceId: string; profileId: string; name: string }) {
  const [state, action] = useActionState(adminRegisterAction, initialFormState);
  return (
    <form action={action} className="space-y-2 rounded-control border border-border p-3">
      <FormMessage state={state} />
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <input type="hidden" name="profileId" value={profileId} />
      <p className="font-semibold">{name}</p>
      <TextField label="Reason (for the audit log)" name="reason" required maxLength={250} error={state.fieldErrors?.reason} />
      <CheckboxField name="override" label="Allow over capacity" hint="Otherwise they join the waitlist (if offered) when the date is full." />
      <SubmitButton size="sm" pendingText="Adding…" icon={<UserPlus className="size-4" aria-hidden="true" />}>
        Register
      </SubmitButton>
    </form>
  );
}

export function AdminCancelRegistrationForm({ registrationId, name }: { registrationId: string; name: string }) {
  const [state, action] = useActionState(adminCancelRegistrationAction, initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <TextField label={<span className="sr-only">Reason for canceling {name}</span>} name="reason" placeholder="Reason" required maxLength={250} className="w-40" />
      <SubmitButton size="sm" variant="danger-outline" pendingText="Canceling…">
        Cancel<span className="sr-only"> registration for {name}</span>
      </SubmitButton>
    </form>
  );
}
