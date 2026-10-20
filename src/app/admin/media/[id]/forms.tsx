"use client";

import { useActionState, useState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { AssetDetail } from "@/lib/media/types";
import { saveAssetDetailsAction, saveTranscriptAction } from "../actions";

export function AssetDetailsForm({ asset }: { asset: AssetDetail }) {
  const [state, action] = useActionState(saveAssetDetailsAction, initialFormState);
  const [rights, setRights] = useState(asset.rights);
  const [publicOk, setPublicOk] = useState(asset.public_ok);
  const confirmed = !!asset.rights_confirmed_at && rights === asset.rights && rights !== "unknown";
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={asset.id} />
      <TextField label="Title" name="title" required maxLength={160} defaultValue={asset.title} hint="For the library and as a default label." />
      {asset.kind === "image" ? (
        <TextAreaField
          label="Description for screen readers"
          name="alt_text"
          rows={2}
          maxLength={500}
          defaultValue={asset.alt_text ?? ""}
          hint="What the image shows, in a sentence. Leave empty only if it's purely decorative."
        />
      ) : (
        <input type="hidden" name="alt_text" value={asset.alt_text ?? ""} />
      )}
      {asset.kind === "captions" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Label" name="label" maxLength={60} defaultValue={asset.label ?? ""} placeholder="English" />
          <TextField label="Language code" name="language" maxLength={12} defaultValue={asset.language ?? "en"} />
        </div>
      ) : (
        <>
          <input type="hidden" name="label" value="" />
          <input type="hidden" name="language" value="" />
        </>
      )}
      <fieldset className="space-y-4 border-t border-border pt-4">
        <legend className="font-semibold">Source and permission</legend>
        <SelectField label="Rights" name="rights" value={rights} onChange={(e) => setRights(e.target.value as AssetDetail["rights"])}>
          <option value="unknown">Not confirmed yet</option>
          <option value="church_owned">Church owned (recorded or created by the church)</option>
          <option value="licensed">Licensed for this use</option>
          <option value="permission">Used with written permission</option>
          <option value="public_domain">Public domain</option>
        </SelectField>
        <TextField label="Source" name="source" maxLength={300} defaultValue={asset.source ?? ""} optional hint="Where it came from (for example a speaker, publisher, or licence)." />
        <TextField label="Attribution" name="attribution" maxLength={300} defaultValue={asset.attribution ?? ""} optional hint="Shown to members where the file is used." />
        <TextAreaField label="Notes" name="rights_notes" rows={2} maxLength={1000} defaultValue={asset.rights_notes ?? ""} optional hint="Administrative only (licence terms, permission dates)." />
        {rights !== "unknown" ? (
          <CheckboxField
            name="confirm_rights"
            label={confirmed ? "Rights confirmed — confirm again" : "I confirm the church may host and share this file for this use"}
            hint="A podcast feed, a streaming subscription, a purchased audiobook, or a third-party link is not permission to copy and redistribute media."
            defaultChecked={false}
          />
        ) : null}
        <CheckboxField
          name="public_ok"
          label="Approved for public use"
          hint="Needed before this file can reach people who aren't signed in (public lessons, the public podcast feed). Members-only and group content never needs it."
          checked={publicOk}
          onChange={(e) => setPublicOk(e.target.checked)}
        />
      </fieldset>
      <SubmitButton pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}

export function TranscriptForm({ id, transcript }: { id: string; transcript: string }) {
  const [state, action] = useActionState(saveTranscriptAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <TextAreaField
        label={<span className="sr-only">Transcript</span>}
        name="transcript"
        rows={10}
        defaultValue={state.values?.transcript ?? transcript}
        hint="Plain text. Paragraph breaks are kept."
      />
      <SubmitButton variant="secondary" pendingText="Saving…">
        Save transcript
      </SubmitButton>
    </form>
  );
}
