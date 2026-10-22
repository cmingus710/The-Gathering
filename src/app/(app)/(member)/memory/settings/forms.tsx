"use client";

import { useActionState } from "react";
import { UNAVAILABLE_NOTE, UnavailableVersionOptions, versionLabel } from "@/components/memory/unavailable-versions";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { DIFFICULTIES } from "@/lib/memory/format";
import type { Translation } from "@/lib/bible/types";
import type { PracticeSettings } from "@/lib/memory/types";
import { deleteHistoryAction, saveSettingsAction } from "../actions";

const SOURCE: Record<string, string> = { reading: "your Bible reading version", church: "the church's version" };

export function SettingsForm({
  settings: s,
  translations,
  unavailable,
  timezones,
}: {
  settings: PracticeSettings;
  translations: Translation[];
  unavailable: Translation[];
  timezones: string[];
}) {
  const [state, action] = useActionState(saveSettingsAction, initialFormState);
  const eff = s.effective_translation;
  // Not chosen yet: show what new verses use now (the reading or church version).
  const followLabel = eff && eff.source !== "memory" ? `Not chosen: use ${SOURCE[eff.source]} (${eff.code})` : "Not chosen: use my Bible reading version";
  return (
    <form action={action} className="space-y-8">
      <FormMessage state={state} />
      <fieldset className="space-y-4">
        <legend className="text-[1.125rem] font-semibold">Bible version</legend>
        {translations.length ? (
          <SelectField
            label="Default memory verse translation"
            name="default_translation_id"
            defaultValue={s.default_translation_available ? (s.default_translation_id ?? "") : ""}
            hint={`Used for new memory verses. You can choose a different translation for each verse. Changing it doesn't change verses you've already added or your earlier results.${unavailable.length ? ` ${UNAVAILABLE_NOTE}` : ""}`}
          >
            <option value="">{followLabel}</option>
            {translations.map((t) => (
              <option key={t.id} value={t.id}>
                {versionLabel(t)}
              </option>
            ))}
            <UnavailableVersionOptions items={unavailable} />
          </SelectField>
        ) : (
          <p className="text-meta text-text-secondary">No Bible version is available for memory practice yet.</p>
        )}
        {!s.default_translation_available ? (
          <Alert tone="warning" title="The version you chose is no longer offered for memory practice.">
            New verses use {eff ? `${eff.name} (${eff.code})` : "a version you choose when adding them"} until you pick another. Verses you already have keep their version.
          </Alert>
        ) : null}
      </fieldset>
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
