"use client";

import { useActionState } from "react";
import { deleteHistoryAction, joinPlanAction, updateEnrollmentAction } from "@/app/(member)/bible/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";

export function JoinForm({
  planId,
  mode,
  started,
  today,
  startDate,
  timezone,
  timezones,
  rejoin,
}: {
  planId: string;
  mode: "calendar" | "personal";
  started: boolean;
  today: string;
  /** The earlier start date when rejoining, so "today" stays where it was. */
  startDate: string | null;
  timezone: string;
  timezones: string[];
  rejoin: boolean;
}) {
  const [state, action] = useActionState(joinPlanAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      {mode === "personal" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Start date" name="start_date" type="date" defaultValue={startDate ?? today} hint={rejoin && startDate ? "Day 1 is this date. It's the date you started before; change it to start over from a new day." : "Day 1 is this date."} required error={state.fieldErrors?.start_date} />
          <SelectField label="Your time zone" name="timezone" defaultValue={timezone} hint="“Today” follows this time zone.">
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
        </div>
      ) : started ? (
        <fieldset className="space-y-2">
          <legend className="font-semibold">This plan has already begun</legend>
          <label className="flex min-h-11 items-start gap-3">
            <input type="radio" name="count_from" value="today" defaultChecked className="mt-1 size-5 accent-(--color-primary)" />
            <span>
              Start from today <span className="block text-meta text-text-secondary">Earlier readings stay available but don&apos;t count toward your progress.</span>
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input type="radio" name="count_from" value="start" className="mt-1 size-5 accent-(--color-primary)" />
            <span>
              Include the earlier readings <span className="block text-meta text-text-secondary">Catch up at your own pace.</span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <SubmitButton pendingText="Joining…">{rejoin ? "Rejoin plan" : "Join plan"}</SubmitButton>
    </form>
  );
}

export function ReminderForm({
  enrollmentId,
  reminders,
  time,
  paused,
  timezone,
  timezones,
  showTimezone,
}: {
  enrollmentId: string;
  reminders: boolean;
  time: string;
  paused: boolean;
  timezone: string;
  timezones: string[];
  showTimezone: boolean;
}) {
  const [state, action] = useActionState(updateEnrollmentAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={enrollmentId} />
      <input type="hidden" name="reminders_form" value="1" />
      <CheckboxField name="reminders" label="Send me a daily reading reminder" defaultChecked={reminders} hint="Reminders say only that today's reading is ready. Not on rest days or once you've read." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Reminder time" name="reminder_time" type="time" defaultValue={time} />
        <SelectField label="Time zone" name="timezone" defaultValue={timezone} hint={showTimezone ? "Also decides “today” for this plan." : "For your reminder time. The plan's dates follow the church's time zone."}>
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>
      <CheckboxField name="reminders_paused" label="Pause reminders for now" defaultChecked={paused} />
      <p className="text-meta text-text-secondary">
        How reminders arrive (in the app, email, push) and quiet hours are set in <a href="/notifications/settings" className="font-semibold text-primary hover:underline">notification settings</a>.
      </p>
      <SubmitButton pendingText="Saving…" variant="secondary">
        Save reminder
      </SubmitButton>
    </form>
  );
}

export function EnrollmentOptions({
  enrollmentId,
  mode,
  startDate,
  countingFromToday,
  isPrimary,
  multiple,
}: {
  enrollmentId: string;
  mode: "calendar" | "personal";
  startDate: string | null;
  countingFromToday: boolean;
  isPrimary: boolean;
  multiple: boolean;
}) {
  const [state, action] = useActionState(updateEnrollmentAction, initialFormState);
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {mode === "personal" ? (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={enrollmentId} />
          <TextField label="Start date" name="start_date" type="date" defaultValue={startDate ?? ""} hint="Changing it moves which day is “today”. What you've read stays read." />
          <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
            Change start date
          </SubmitButton>
        </form>
      ) : (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={enrollmentId} />
          <input type="hidden" name="count_from" value={countingFromToday ? "start" : "today"} />
          <p className="text-meta text-text-secondary">{countingFromToday ? "Progress counts from the day you joined." : "Progress counts every reading from the beginning."}</p>
          <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
            {countingFromToday ? "Include earlier readings" : "Count from today"}
          </SubmitButton>
        </form>
      )}
      {multiple && !isPrimary ? (
        <form action={action}>
          <input type="hidden" name="id" value={enrollmentId} />
          <input type="hidden" name="make_primary" value="1" />
          <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
            Make this my main plan
          </SubmitButton>
          <p className="mt-1 text-meta text-text-secondary">Your main plan is the one on the home page.</p>
        </form>
      ) : null}
    </div>
  );
}

/** Leaving lives in the enrollment status at the top of the page. */
export function LeaveControls({ enrollmentId }: { enrollmentId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog trigger="Delete my history" title="Delete your history for this plan?" confirmLabel="Delete history" formAction={deleteHistoryAction} hidden={{ id: enrollmentId }}>
        This removes which readings you marked as read and your settings for this plan. It can&apos;t be undone. Journal entries are kept (delete them in My Journal).
      </ConfirmDialog>
    </div>
  );
}
