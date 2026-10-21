"use client";

import { useActionState } from "react";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { DIFFICULTIES } from "@/lib/memory/format";
import type { PracticeSettings } from "@/lib/memory/types";
import { deleteHistoryAction, saveSettingsAction } from "../actions";

export function SettingsForm({ settings: s, timezones }: { settings: PracticeSettings; timezones: string[] }) {
  const [state, action] = useActionState(saveSettingsAction, initialFormState);
  return (
    <form action={action} className="space-y-8">
      <FormMessage state={state} />
      <fieldset className="space-y-4">
        <legend className="text-[1.125rem] font-semibold">Practice</legend>
        <SelectField label="Usual difficulty" name="difficulty" defaultValue={s.difficulty} hint={DIFFICULTIES.map((d) => `${d.label}: ${d.description}`).join(" ")}>
          {DIFFICULTIES.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Presentation"
          name="presentation"
          defaultValue={s.presentation}
          hint="Kids presentation uses larger text and buttons, shorter parts, simple instructions, and word choices. It only changes how practice looks: it isn't an age setting and doesn't change anyone's permissions. Practicing with a child on your account records the progress as yours; verified guardians can record it for the child instead from Youth & Families."
        >
          <option value="standard">Standard</option>
          <option value="kids">Kids (practicing with a child)</option>
        </SelectField>
        <CheckboxField name="ignore_case" label="Ignore capital letters when I type" defaultChecked={s.ignore_case} />
        <CheckboxField name="ignore_punctuation" label="Ignore punctuation when I type (including apostrophes)" defaultChecked={s.ignore_punctuation} hint="Different words are never accepted either way." />
        <CheckboxField name="celebrations" label="Show celebrations for new badges" defaultChecked={s.celebrations} hint="Gentle and brief, with no sound. Motion follows your device's reduced-motion setting." />
        <SelectField label="Daily goal (optional)" name="daily_goal" defaultValue={s.daily_goal ? String(s.daily_goal) : ""} hint="Just for you. Missing it never removes progress.">
          <option value="">No daily goal</option>
          {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
            <option key={n} value={n}>
              {n} practice {n === 1 ? "activity" : "activities"} a day
            </option>
          ))}
        </SelectField>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-[1.125rem] font-semibold">Reminders</legend>
        <p className="text-meta text-text-secondary">All off unless you switch them on. At most one of each a day, outside your quiet hours.</p>
        <CheckboxField name="remind_weekly" label="A new memory verse is assigned" defaultChecked={s.remind_weekly} />
        <CheckboxField name="remind_review" label="Verses are ready to review" defaultChecked={s.remind_review} />
        <CheckboxField name="remind_practice" label="A practice reminder on days I haven't practiced" defaultChecked={s.remind_practice} />
        <CheckboxField name="remind_challenge" label="Milestones in group challenges I've joined" defaultChecked={s.remind_challenge} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Reminder time" name="reminder_time" type="time" defaultValue={s.reminder_time} />
          <SelectField label="Time zone" name="timezone" defaultValue={s.timezone ?? ""} hint={`Also decides when your day starts for reviews. Now: ${s.effective_timezone.replaceAll("_", " ")}.`}>
            <option value="">Same as my notification settings</option>
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </SelectField>
        </div>
        <CheckboxField name="paused" label="Pause practice for now" defaultChecked={s.paused} hint="Stops reminders. Your verses, schedule, and progress are kept exactly as they are." />
      </fieldset>
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </form>
  );
}

export function DeleteHistoryForm() {
  const [state, action] = useActionState(deleteHistoryAction, initialFormState);
  return (
    <form action={action} className="space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">Delete my practice history</h3>
      <p className="text-meta text-text-secondary">
        Deletes your verses, results, review schedule, and badges. Your contributions to any group challenge total are removed too. Church collections and the Bible text aren&apos;t affected. This can&apos;t be undone.
      </p>
      <FormMessage state={state} />
      <CheckboxField name="collections" label="Also delete my personal collections" />
      <TextField label='Type "delete my practice history" to confirm' name="confirm" autoComplete="off" />
      <SubmitButton variant="danger" pendingText="Deleting…">
        Delete my practice history
      </SubmitButton>
    </form>
  );
}
