"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addExternalVideoAction } from "./actions";

export function ExternalVideoForm() {
  const [state, action] = useActionState(addExternalVideoAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField
        label="Video link"
        name="url"
        type="url"
        inputMode="url"
        placeholder="https://www.youtube.com/watch?v=…"
        defaultValue={state.values?.url}
        error={state.fieldErrors?.url}
        hint="Paste the video's address, not embed code."
      />
      <TextField label="Title" name="title" maxLength={160} defaultValue={state.values?.title} optional />
      <p className="text-meta text-text-secondary">
        Restricting a page in this app doesn&apos;t make a YouTube or Vimeo video private. An unlisted video can still be watched by anyone who has its
        link; use the provider&apos;s own privacy settings for that.
      </p>
      <SubmitButton pendingText="Adding…">Add video</SubmitButton>
    </form>
  );
}
