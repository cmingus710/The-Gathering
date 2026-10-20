"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { UnsavedNotice, useUnsavedChanges } from "@/components/profile/unsaved-changes";
import { Card, SectionHeading } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { MONTHS } from "@/lib/directory/format";
import { initialFormState } from "@/lib/forms";
import { updateProfileAction } from "../actions";

type Values = Record<
  | "firstName"
  | "lastName"
  | "preferredName"
  | "phone"
  | "contactEmail"
  | "streetAddress"
  | "city"
  | "stateRegion"
  | "postalCode"
  | "bio"
  | "birthdayMonth"
  | "birthdayDay",
  string
>;

function Shared({ on }: { on: boolean }) {
  return on ? <>Shared with approved members.</> : <>Hidden from the directory.</>;
}

export function ProfileDetailsForm({
  initial,
  interests,
  chosen,
  visibility,
}: {
  initial: Values;
  interests: Array<{ id: string; label: string }>;
  chosen: string[];
  visibility: { phone: boolean; contactEmail: boolean; street: boolean; city: boolean; birthday: boolean; interests: boolean };
}) {
  const [state, action] = useActionState(updateProfileAction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const savedAt = state.values?.savedAt ?? "initial";
  const dirty = useUnsavedChanges(formRef, savedAt);
  const v = { ...initial, ...(state.values ?? {}) } as Values;
  const err = state.fieldErrors ?? {};
  const chosenNow = new Set(state.values?.__interests !== undefined ? state.values.__interests.split(",").filter(Boolean) : chosen);

  return (
    <form ref={formRef} action={action} noValidate className="space-y-6">
      <FormMessage state={state} successTitle="Saved" />
      <input type="hidden" name="savedAt" value={savedAt} />

      <Card className="space-y-5">
        <SectionHeading>Name</SectionHeading>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="First name" name="firstName" autoComplete="given-name" required defaultValue={v.firstName} error={err.firstName} />
          <TextField label="Last name" name="lastName" autoComplete="family-name" optional defaultValue={v.lastName} error={err.lastName} />
        </div>
        <TextField
          label="Preferred name"
          name="preferredName"
          autoComplete="nickname"
          optional
          hint="Shown first in the app and the directory, e.g. “Liz” instead of “Elizabeth”."
          defaultValue={v.preferredName}
          error={err.preferredName}
        />
      </Card>

      <Card className="space-y-5">
        <SectionHeading>Contact</SectionHeading>
        <TextField
          label="Directory email"
          name="contactEmail"
          type="email"
          autoComplete="email"
          optional
          hint={
            <>
              An address other members can use to reach you. It is separate from your sign-in email, and changing it never changes how you sign in. <Shared on={visibility.contactEmail} />
            </>
          }
          defaultValue={v.contactEmail}
          error={err.contactEmail}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          optional
          hint={
            <>
              Church administrators can see this. <Shared on={visibility.phone} />
            </>
          }
          defaultValue={v.phone}
          error={err.phone}
        />
      </Card>

      <Card className="space-y-5">
        <SectionHeading>Address</SectionHeading>
        <p className="-mt-2 text-meta text-text-secondary">
          Street address: <Shared on={visibility.street} /> City and state: <Shared on={visibility.city} />
        </p>
        <TextField label="Street address" name="streetAddress" autoComplete="street-address" optional defaultValue={v.streetAddress} error={err.streetAddress} />
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem_9rem]">
          <TextField label="City" name="city" autoComplete="address-level2" optional defaultValue={v.city} error={err.city} />
          <TextField label="State" name="stateRegion" autoComplete="address-level1" optional defaultValue={v.stateRegion} error={err.stateRegion} />
          <TextField label="Postal code" name="postalCode" autoComplete="postal-code" optional defaultValue={v.postalCode} error={err.postalCode} />
        </div>
      </Card>

      <Card className="space-y-5">
        <SectionHeading>About you</SectionHeading>
        <TextAreaField
          label="Short bio"
          name="bio"
          optional
          maxLength={500}
          hint="Up to 500 characters. Shown on your directory profile."
          defaultValue={v.bio}
          error={err.bio}
        />
        <fieldset>
          <legend className="font-semibold">
            Birthday <span className="font-normal text-text-secondary">(optional, month and day only)</span>
          </legend>
          <p className="text-meta text-text-secondary">
            No year is collected. <Shared on={visibility.birthday} />
          </p>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:max-w-sm">
            <SelectField label="Month" name="birthdayMonth" defaultValue={v.birthdayMonth} error={err.birthdayMonth} autoComplete="bday-month">
              <option value="">—</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectField>
            <SelectField label="Day" name="birthdayDay" defaultValue={v.birthdayDay} error={err.birthdayDay} autoComplete="bday-day">
              <option value="">—</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-semibold">
            Ministry interests <span className="font-normal text-text-secondary">(optional)</span>
          </legend>
          <p className="text-meta text-text-secondary">
            {interests.length ? <Shared on={visibility.interests} /> : "The church hasn't added any options yet."}
          </p>
          {interests.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {interests.map((i) => (
                <li key={i.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-4 has-checked:border-primary has-checked:bg-primary-soft">
                    <input type="checkbox" name="interests" value={i.id} defaultChecked={chosenNow.has(i.id)} className="size-5 accent-primary" />
                    {i.label}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {err.interests ? <p className="mt-1 text-meta font-medium text-danger">{err.interests[0]}</p> : null}
        </fieldset>
      </Card>

      <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-4 rounded-card border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
        <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
        <Link href="/profile/privacy" className="font-semibold text-primary hover:underline">
          Choose what&apos;s shared
        </Link>
        <UnsavedNotice dirty={dirty} />
      </div>
    </form>
  );
}
