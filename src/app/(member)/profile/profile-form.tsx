"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { updateProfileAction } from "./actions";

export function ProfileForm({ initial }: { initial: { fullName: string; preferredName: string; phone: string } }) {
  const [state, action] = useActionState(updateProfileAction, initialFormState);
  const v = state.values ?? initial;
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField label="Full name" name="fullName" autoComplete="name" required defaultValue={v.fullName} error={state.fieldErrors?.fullName} />
      <TextField
        label="Preferred name"
        name="preferredName"
        autoComplete="nickname"
        optional
        hint="What you'd like to be called in the app."
        defaultValue={v.preferredName}
        error={state.fieldErrors?.preferredName}
      />
      <TextField
        label="Phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        optional
        hint="Visible only to you and church administrators."
        defaultValue={v.phone}
        error={state.fieldErrors?.phone}
      />
      <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
    </form>
  );
}
