"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { ChurchSettings } from "@/lib/settings/queries";
import { SOCIAL_LABEL, SOCIAL_NETWORKS, WEEKDAY_LABEL, WEEKDAYS, type GatheringTime } from "@/lib/settings/schema";
import { saveSettingsAction } from "./actions";

type Row = { key: number; label: string; day: string; time: string; location: string };

function Fieldset({ legend, children, description }: { legend: string; children: React.ReactNode; description?: string }) {
  return (
    <fieldset className="space-y-5 rounded-card border border-border bg-surface p-5 sm:p-6">
      <legend className="float-left mb-1 w-full text-xl font-bold">{legend}</legend>
      {description ? <p className="clear-both text-meta text-text-secondary">{description}</p> : null}
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
  );
}

export function SettingsForm({ settings, timeZones }: { settings: ChurchSettings; timeZones: string[] }) {
  const [state, action] = useActionState(saveSettingsAction, initialFormState);
  const [rows, setRows] = useState<Row[]>(() =>
    settings.gatheringTimes.map((g: GatheringTime, i) => ({ key: i, label: g.label, day: g.day, time: g.time, location: g.location ?? "" })),
  );
  const [nextKey, setNextKey] = useState(settings.gatheringTimes.length);
  const v = state.values;
  const val = (name: string, fallback: string | null | undefined) => v?.[name] ?? fallback ?? "";
  const fe = state.fieldErrors ?? {};
  // Zod reports nested errors as "gatheringTimes" for the array as a whole.
  const gatheringError = fe.gatheringTimes;

  return (
    <form action={action} noValidate className="space-y-6">
      <FormMessage state={state} />

      <Fieldset legend="About the church">
        <TextField label="Church name" name="churchName" required defaultValue={val("churchName", settings.churchName)} error={fe.churchName} />
        <TextAreaField
          label="Welcome description"
          name="description"
          optional
          rows={4}
          hint="Shown on the public welcome page. A few warm sentences work best."
          defaultValue={val("description", settings.description)}
          error={fe.description}
        />
      </Fieldset>

      <Fieldset legend="Contact">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Contact email" name="contactEmail" type="email" optional defaultValue={val("contactEmail", settings.contactEmail)} error={fe.contactEmail} />
          <TextField label="Contact phone" name="contactPhone" type="tel" optional defaultValue={val("contactPhone", settings.contactPhone)} error={fe.contactPhone} />
        </div>
      </Fieldset>

      <Fieldset legend="Address">
        <TextField label="Street address" name="addressLine1" optional autoComplete="address-line1" defaultValue={val("addressLine1", settings.address.line1)} error={fe.addressLine1} />
        <TextField label="Address line 2" name="addressLine2" optional autoComplete="address-line2" defaultValue={val("addressLine2", settings.address.line2)} error={fe.addressLine2} />
        <div className="grid gap-5 sm:grid-cols-3">
          <TextField label="City" name="city" optional defaultValue={val("city", settings.address.city)} error={fe.city} />
          <TextField label="State" name="region" optional defaultValue={val("region", settings.address.region)} error={fe.region} />
          <TextField label="ZIP code" name="postalCode" optional defaultValue={val("postalCode", settings.address.postalCode)} error={fe.postalCode} />
        </div>
        <TextField label="Country" name="country" optional defaultValue={val("country", settings.address.country)} error={fe.country} />
      </Fieldset>

      <Fieldset legend="Gathering times" description="Regular weekly gatherings shown on the welcome and home pages.">
        <SelectField
          label="Church time zone"
          name="timezone"
          hint="Used for gathering times and announcement scheduling."
          defaultValue={val("timezone", settings.timezone)}
          error={fe.timezone}
        >
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        {rows.length === 0 ? <p className="text-text-secondary">No gathering times yet.</p> : null}
        <ol className="space-y-4">
          {rows.map((row, index) => (
            <li key={row.key} className="rounded-control border border-border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Name"
                  name={`gathering[${index}][label]`}
                  id={`gathering-${row.key}-label`}
                  placeholder="e.g. Sunday Worship"
                  defaultValue={row.label}
                />
                <TextField label="Location" name={`gathering[${index}][location]`} id={`gathering-${row.key}-location`} optional defaultValue={row.location} />
                <SelectField label="Day" name={`gathering[${index}][day]`} id={`gathering-${row.key}-day`} defaultValue={row.day || "sunday"}>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_LABEL[d]}
                    </option>
                  ))}
                </SelectField>
                <TextField label="Time" type="time" name={`gathering[${index}][time]`} id={`gathering-${row.key}-time`} defaultValue={row.time} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                icon={<Trash2 className="size-4" aria-hidden="true" />}
                onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
              >
                Remove<span className="sr-only"> gathering time {index + 1}</span>
              </Button>
            </li>
          ))}
        </ol>
        {gatheringError ? (
          <p role="alert" className="font-medium text-danger">
            Check the gathering times: each needs a name, a day, and a time.
          </p>
        ) : null}
        {rows.length < 12 ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => {
              setRows((r) => [...r, { key: nextKey, label: "", day: "sunday", time: "", location: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add a gathering time
          </Button>
        ) : null}
      </Fieldset>

      <Fieldset legend="Social links" description="Full web addresses, starting with https://">
        <div className="grid gap-5 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((n) => (
            <TextField
              key={n}
              label={SOCIAL_LABEL[n]}
              name={`social_${n}`}
              type="url"
              optional
              inputMode="url"
              defaultValue={val(`social_${n}`, settings.socialLinks[n])}
              error={fe[`socialLinks.${n}`]}
            />
          ))}
        </div>
      </Fieldset>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <SubmitButton pendingText="Saving…" className="shadow-lg">
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}
