"use client";

import { useActionState, useRef } from "react";
import { UnsavedNotice, useUnsavedChanges } from "@/components/profile/unsaved-changes";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { MONTHS } from "@/lib/directory/format";
import { initialFormState } from "@/lib/forms";
import { updateMemberProfileAction } from "../actions";

type Values = Record<
  "firstName" | "lastName" | "preferredName" | "phone" | "contactEmail" | "streetAddress" | "city" | "stateRegion" | "postalCode" | "bio" | "birthdayMonth" | "birthdayDay",
  string
>;

export function AdminProfileForm({ userId, initial, hasPhoto, isSelf }: { userId: string; initial: Values; hasPhoto: boolean; isSelf: boolean }) {
  const [state, action] = useActionState(updateMemberProfileAction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const savedKey = state.status === "success" ? state.message : "initial";
  const dirty = useUnsavedChanges(formRef, savedKey);
  const v = { ...initial, ...(state.values ?? {}) } as Values;
  const err = state.fieldErrors ?? {};

  return (
    <form ref={formRef} action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      {isSelf ? <Alert tone="info" title="This is your own profile. You can also edit it from your member profile." live={false} /> : null}
      <p className="text-[0.95rem] text-text-secondary">
        Correct details only at the member&apos;s request or to fix an error. Each save is recorded in the audit log by field
        name (never the values).
      </p>
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField label="First name" name="firstName" defaultValue={v.firstName} error={err.firstName} />
        <TextField label="Last name" name="lastName" optional defaultValue={v.lastName} error={err.lastName} />
        <TextField label="Preferred name" name="preferredName" optional defaultValue={v.preferredName} error={err.preferredName} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Phone" name="phone" type="tel" optional defaultValue={v.phone} error={err.phone} />
        <TextField label="Directory email" name="contactEmail" type="email" optional hint="Not the sign-in email." defaultValue={v.contactEmail} error={err.contactEmail} />
      </div>
      <TextField label="Street address" name="streetAddress" optional defaultValue={v.streetAddress} error={err.streetAddress} />
      <div className="grid gap-5 sm:grid-cols-[1fr_8rem_9rem]">
        <TextField label="City" name="city" optional defaultValue={v.city} error={err.city} />
        <TextField label="State" name="stateRegion" optional defaultValue={v.stateRegion} error={err.stateRegion} />
        <TextField label="Postal code" name="postalCode" optional defaultValue={v.postalCode} error={err.postalCode} />
      </div>
      <TextAreaField label="Bio" name="bio" optional maxLength={500} defaultValue={v.bio} error={err.bio} />
      <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
        <SelectField label="Birthday month" name="birthdayMonth" defaultValue={v.birthdayMonth} error={err.birthdayMonth}>
          <option value="">—</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </SelectField>
        <SelectField label="Birthday day" name="birthdayDay" defaultValue={v.birthdayDay} error={err.birthdayDay}>
          <option value="">—</option>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </SelectField>
      </div>
      {hasPhoto ? <CheckboxField name="removePhoto" label="Remove profile photo" hint="Deletes the photo. Members will see initials instead." /> : null}
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
        <UnsavedNotice dirty={dirty} />
      </div>
    </form>
  );
}
