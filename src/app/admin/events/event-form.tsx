"use client";

/* eslint-disable @next/next/no-img-element -- object-URL and signed-URL previews */
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { ORDINALS, REMINDER_CHOICES, WEEKDAYS } from "@/lib/events/format";
import { MAX_COVER_BYTES } from "@/lib/events/limits";
import { initialFormState, type FormState } from "@/lib/forms";
import { saveEventAction } from "./actions";

export type EventFormValues = {
  id?: string;
  title: string;
  description: string;
  categoryId: string;
  audience: "public" | "members" | "group";
  groupId: string;
  timezone: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  locationName: string;
  locationAddress: string;
  onlineUrl: string;
  organizerName: string;
  rsvpEnabled: boolean;
  capacity: string;
  waitlistEnabled: boolean;
  rsvpCloseHours: string;
  cancellationInstructions: string;
  reminders: number[];
  recurrence: "none" | "daily" | "weekly" | "monthly";
  interval: string;
  weekdays: number[];
  monthlyMode: "day" | "ordinal";
  monthOrdinal: string;
  endMode: "until" | "count";
  untilDate: string;
  occurrenceLimit: string;
  coverAlt: string;
  coverUrl: string | null;
};

const fieldset = "space-y-4 rounded-card bg-surface p-5 sm:p-6";
const legend = "mb-1 text-[0.95rem] font-bold uppercase tracking-[0.08em]";

type Props = {
  initial: EventFormValues;
  categories: Array<{ id: string; name: string; active: boolean }>;
  /** Groups this coordinator may target (discoverable, or ones they lead or administer). */
  groups: Array<{ id: string; name: string; visibility: "discoverable" | "hidden" }>;
  timezones: string[];
  published: boolean;
};

type SaveState = FormState & { attempt?: number };

async function save(prev: SaveState, formData: FormData): Promise<SaveState> {
  return { ...(await saveEventAction(prev, formData)), attempt: (prev.attempt ?? 0) + 1 };
}

/**
 * React resets a form after its action runs. Controlled fields (the repeat
 * menu, end-mode radios) can then show a different value than the component
 * holds, and Safari submitted "Does not repeat" for a weekly event after a
 * failed save. Remounting the fields from the server's echo of what was
 * submitted keeps the screen and the next submission in agreement.
 */
export function EventForm(props: Props) {
  const [state, action] = useActionState<SaveState, FormData>(save, initialFormState);
  return <EventFormFields key={state.attempt ?? 0} {...props} state={state} action={action} />;
}

function EventFormFields({ initial, categories, groups, timezones, published, state, action }: Props & { state: SaveState; action: (formData: FormData) => void }) {
  const sv = state.values;
  const str = (k: keyof EventFormValues) => (sv?.[k] !== undefined ? String(sv[k]) : String(initial[k] ?? ""));
  const bool = (k: keyof EventFormValues) => (sv ? sv[k] === "on" : Boolean(initial[k]));
  const nums = (k: "weekdays" | "reminders") => (sv?.[k] !== undefined ? sv[k].split(",").filter(Boolean).map(Number) : initial[k]);

  const [allDay, setAllDay] = useState(bool("allDay"));
  const [rsvp, setRsvp] = useState(bool("rsvpEnabled"));
  const [recurrence, setRecurrence] = useState(str("recurrence") || "none");
  const [audience, setAudience] = useState<EventFormValues["audience"]>((str("audience") || "members") as EventFormValues["audience"]);
  const [monthlyMode, setMonthlyMode] = useState(str("monthlyMode") || "day");
  const [endMode, setEndMode] = useState(str("endMode") || "until");
  const [preview, setPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const fe = state.fieldErrors ?? {};
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const coverUrl = preview ?? (removeCover ? null : initial.coverUrl);

  return (
    <form action={action} noValidate className="space-y-6" encType="multipart/form-data">
      <FormMessage state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {published ? (
        <p className="rounded-card border border-primary/50 bg-primary-soft p-4 text-[0.95rem]">
          This event is published. Changing its date, time, or place emails everyone registered for affected dates. Wording changes don&apos;t send email.
        </p>
      ) : null}

      <fieldset className={fieldset}>
        <legend className={legend}>Details</legend>
        <TextField label="Title" name="title" required maxLength={160} defaultValue={str("title")} error={fe.title} />
        <TextAreaField
          label="Description"
          name="description"
          optional
          rows={8}
          defaultValue={str("description")}
          error={fe.description}
          hint="Formatting: **bold**, *italic*, ## heading, - list, [link text](https://…). HTML isn't allowed. Don't include private information: descriptions appear in calendar feeds."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" name="categoryId" optional defaultValue={str("categoryId")} error={fe.categoryId}>
            <option value="">No category</option>
            {categories
              .filter((c) => c.active || c.id === initial.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Who can see it"
            name="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as EventFormValues["audience"])}
            error={fe.audience}
            hint={audience === "group" ? "Only the group's active members see it, its image, and its calendar entries." : undefined}
          >
            <option value="members">Approved members only</option>
            <option value="public">Everyone (public)</option>
            <option value="group" disabled={!groups.length && initial.audience !== "group"}>
              One group&apos;s members only{groups.length ? "" : " (no groups yet)"}
            </option>
          </SelectField>
        </div>
        {audience === "group" ? (
          <SelectField label="Group" name="groupId" defaultValue={str("groupId")} error={fe.groupId} hint="Changing the group cancels registrations of people who aren't in the new group.">
            <option value="">Choose a group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.visibility === "hidden" ? " (hidden group)" : ""}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label="Organizer" name="organizerName" optional maxLength={120} defaultValue={str("organizerName")} error={fe.organizerName} hint="A name or team. Don't add phone numbers or personal email." />
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Date and time</legend>
        <SelectField label="Time zone" name="timezone" defaultValue={str("timezone")} error={fe.timezone} hint="Times are entered and shown in this zone, including across daylight-saving changes.">
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <CheckboxField name="allDay" label="All-day event" checked={allDay} onChange={(e) => setAllDay(e.currentTarget.checked)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={recurrence === "none" ? "Date" : "First date"} name="startDate" type="date" required defaultValue={str("startDate")} error={fe.startDate} />
          {!allDay ? <TextField label="Start time" name="startTime" type="time" required defaultValue={str("startTime")} error={fe.startTime} /> : <input type="hidden" name="startTime" value="" />}
          <TextField
            label={allDay ? "Last day" : "End date"}
            name="endDate"
            type="date"
            optional
            defaultValue={str("endDate")}
            error={fe.endDate}
            hint={allDay ? "Leave blank for a one-day event." : "Leave blank if it ends the same day."}
          />
          {!allDay ? <TextField label="End time" name="endTime" type="time" required defaultValue={str("endTime")} error={fe.endTime} /> : <input type="hidden" name="endTime" value="" />}
        </div>
        <p className="text-sm text-text-secondary">
          On daylight-saving change days, a start time that doesn&apos;t exist (for example 2:30 AM in spring) moves forward by an hour, and a repeated time (1:30 AM in autumn) uses the second, standard-time one.
        </p>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Repeats</legend>
        <SelectField label="Repeat" name="recurrence" value={recurrence} onChange={(e) => setRecurrence(e.currentTarget.value)} error={fe.recurrence}>
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </SelectField>
        {recurrence !== "none" ? (
          <>
            <TextField
              label={`Every how many ${recurrence === "daily" ? "days" : recurrence === "weekly" ? "weeks" : "months"}`}
              name="interval"
              inputMode="numeric"
              defaultValue={str("interval") || "1"}
              error={fe.interval}
              className="max-w-xs"
            />
            {recurrence === "weekly" ? (
              <fieldset>
                <legend className="font-semibold">On these days</legend>
                {fe.weekdays ? <p className="text-danger">{fe.weekdays[0]}</p> : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  {WEEKDAYS.map((d, i) => (
                    <label key={d} className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="weekdays" value={i} defaultChecked={nums("weekdays").includes(i)} className="size-5 accent-primary" />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {recurrence === "monthly" ? (
              <fieldset>
                <legend className="font-semibold">Each month on</legend>
                <div className="mt-2 space-y-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="monthlyMode" value="day" checked={monthlyMode === "day"} onChange={() => setMonthlyMode("day")} className="size-5 accent-primary" />
                    The same date as the first date (months without that date are skipped)
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="monthlyMode" value="ordinal" checked={monthlyMode === "ordinal"} onChange={() => setMonthlyMode("ordinal")} className="size-5 accent-primary" />
                    A weekday of the month (the first date&apos;s weekday)
                  </label>
                  {monthlyMode === "ordinal" ? (
                    <SelectField label="Which one" name="monthOrdinal" defaultValue={str("monthOrdinal") || "1"} error={fe.monthOrdinal} className="max-w-xs">
                      {Object.entries(ORDINALS).map(([k, label]) => (
                        <option key={k} value={k}>
                          The {label}
                        </option>
                      ))}
                    </SelectField>
                  ) : null}
                </div>
              </fieldset>
            ) : null}
            <fieldset>
              <legend className="font-semibold">Ends</legend>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="endMode" value="until" checked={endMode === "until"} onChange={() => setEndMode("until")} className="size-5 accent-primary" />
                    On a date
                  </label>
                  {endMode === "until" ? <TextField label="Last possible date" name="untilDate" type="date" defaultValue={str("untilDate")} error={fe.untilDate} hint="Up to two years after the first date." /> : null}
                </div>
                <div className="space-y-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="endMode" value="count" checked={endMode === "count"} onChange={() => setEndMode("count")} className="size-5 accent-primary" />
                    After a number of dates
                  </label>
                  {endMode === "count" ? <TextField label="Number of dates" name="occurrenceLimit" inputMode="numeric" defaultValue={str("occurrenceLimit")} error={fe.occurrenceLimit} hint="1 to 200." /> : null}
                </div>
              </div>
            </fieldset>
            <p className="text-sm text-text-secondary">
              Editing the schedule keeps each date&apos;s registrations. Dates removed from the schedule are deleted only if nobody registered; otherwise they&apos;re kept as canceled and registrants are told.
            </p>
          </>
        ) : null}
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Place</legend>
        <TextField label="Location name" name="locationName" optional maxLength={200} defaultValue={str("locationName")} error={fe.locationName} />
        <TextField label="Address" name="locationAddress" optional maxLength={300} defaultValue={str("locationAddress")} error={fe.locationAddress} />
        <TextField label="Online meeting link" name="onlineUrl" type="url" optional placeholder="https://" defaultValue={str("onlineUrl")} error={fe.onlineUrl} hint="Must start with https://. Shown only to people who can see the event." />
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Registration</legend>
        <CheckboxField name="rsvpEnabled" label="Members register (RSVP) for this event" checked={rsvp} onChange={(e) => setRsvp(e.currentTarget.checked)} hint="One place per member account. Guests and children can't be registered yet." />
        {rsvp ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Capacity" name="capacity" inputMode="numeric" optional defaultValue={str("capacity")} error={fe.capacity} hint="Per date. Leave blank for unlimited." />
              <TextField label="Registration closes (hours before start)" name="rsvpCloseHours" inputMode="numeric" optional defaultValue={str("rsvpCloseHours")} error={fe.rsvpCloseHours} hint="Leave blank to close when the event starts." />
            </div>
            <CheckboxField
              name="waitlistEnabled"
              label="Offer a waitlist when full"
              defaultChecked={bool("waitlistEnabled")}
              hint="When a place opens, the first person waiting is registered automatically (their place is confirmed) and emailed."
            />
            {fe.waitlistEnabled ? <p className="text-danger">{fe.waitlistEnabled[0]}</p> : null}
            <TextAreaField label="If plans change" name="cancellationInstructions" optional rows={3} maxLength={1000} defaultValue={str("cancellationInstructions")} error={fe.cancellationInstructions} hint="Shown on the event page and in confirmation emails." />
          </>
        ) : null}
        <fieldset>
          <legend className="font-semibold">Reminder emails to registered members</legend>
          {fe.reminders ? <p className="text-danger">{fe.reminders[0]}</p> : null}
          <div className="mt-2 flex flex-wrap gap-3">
            {REMINDER_CHOICES.map((c) => (
              <label key={c.minutes} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="reminders" value={c.minutes} defaultChecked={nums("reminders").includes(c.minutes)} className="size-5 accent-primary" />
                {c.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-sm text-text-secondary">Up to three. Members can turn optional reminders off.</p>
        </fieldset>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>Image</legend>
        {coverUrl ? <img src={coverUrl} alt="" className="aspect-[16/9] w-full max-w-md rounded-card object-cover" /> : null}
        <TextField
          label={initial.coverUrl ? "Replace image" : "Cover image"}
          name="cover"
          type="file"
          optional
          accept="image/png,image/jpeg,image/webp"
          error={tooLarge ? "That image is larger than 4 MB. Choose a smaller one." : fe.cover}
          hint="PNG, JPEG, or WebP up to 4 MB. It's resized and its metadata (such as location) removed."
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            // Larger uploads are refused by the host before the app sees them.
            const big = Boolean(f && f.size > MAX_COVER_BYTES);
            setTooLarge(big);
            if (big) e.currentTarget.value = "";
            setPreview(f && !big ? URL.createObjectURL(f) : null);
          }}
        />
        {initial.coverUrl ? <CheckboxField name="removeCover" label="Remove the image" checked={removeCover} onChange={(e) => setRemoveCover(e.currentTarget.checked)} /> : null}
        <TextField label="Image description" name="coverAlt" optional maxLength={300} defaultValue={str("coverAlt")} error={fe.coverAlt} hint="Describe the image for people using screen readers. Required with an image." />
      </fieldset>

      <SubmitButton pendingText="Saving…">{initial.id ? "Save changes" : "Save as draft"}</SubmitButton>
    </form>
  );
}
