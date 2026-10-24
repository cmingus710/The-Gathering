"use client";

import { Download, Eye, EyeOff, RotateCcw, Send, Undo2 } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";
import { CoverImageField } from "@/components/media/cover-image-field";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CollectionAdmin } from "@/lib/devotionals/types";
import { initialFormState } from "@/lib/forms";
import {
  collectionStatusAction,
  importMorningEveningAction,
  removeCollectionAction,
  restoreReadingAction,
  saveCollectionAction,
  saveReadingAction,
} from "./actions";

/** Runs the import (dry run again on the server, then staging and one all-or-nothing apply). */
export function ImportForm({ disabled, rerun }: { disabled: boolean; rerun: boolean }) {
  const [state, action] = useActionState(importMorningEveningAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton disabled={disabled} pendingText="Importing… (this takes a few seconds)" icon={<Download className="size-4" aria-hidden="true" />}>
        {rerun ? "Run the import again" : "Import into a draft collection"}
      </SubmitButton>
    </form>
  );
}

/** Publish / unpublish / hide / show. */
export function StatusButtons({ collection }: { collection: CollectionAdmin }) {
  const [state, action] = useActionState(collectionStatusAction, initialFormState);
  const button = (value: string, label: string, icon: ReactNode, variant: "primary" | "secondary" = "secondary") => (
    <SubmitButton name="action" value={value} variant={variant} size="sm" icon={icon}>
      {label}
    </SubmitButton>
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={collection.id} />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {collection.status === "draft" ? button("publish", "Publish and show to members", <Send className="size-4" aria-hidden="true" />, "primary") : null}
        {collection.status === "published" && collection.enabled ? button("hide", "Hide from members", <EyeOff className="size-4" aria-hidden="true" />) : null}
        {collection.status === "published" && !collection.enabled ? button("show", "Show to members again", <Eye className="size-4" aria-hidden="true" />, "primary") : null}
        {collection.status === "published" ? button("unpublish", "Return to draft for review", <Undo2 className="size-4" aria-hidden="true" />) : null}
      </div>
    </form>
  );
}

export function DetailsForm({
  collection,
  groups,
  canUpload,
  canPublish,
  imageMaxMb,
}: {
  collection: CollectionAdmin;
  groups: Array<{ id: string; name: string }>;
  canUpload: boolean;
  canPublish: boolean;
  imageMaxMb?: number;
}) {
  const [state, action] = useActionState(saveCollectionAction, initialFormState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const [audience, setAudience] = useState(v?.audience ?? collection.audience);
  const lockedAudience = collection.status === "published" && !canPublish;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={collection.id} />
      <FormMessage state={state} />
      <TextField label="Title" name="title" required maxLength={120} defaultValue={v?.title ?? collection.title} error={fe.title} />
      <TextField
        label="Card line"
        name="subtitle"
        maxLength={160}
        defaultValue={v?.subtitle ?? collection.subtitle}
        hint="Shown under the title on the devotionals page."
        error={fe.subtitle}
      />
      <TextAreaField label="Description" name="description" rows={4} maxLength={4000} defaultValue={v?.description ?? collection.description} error={fe.description} optional />
      <CoverImageField
        name="cover_asset_id"
        defaultAssetId={collection.cover_asset_id}
        altName="cover_alt"
        defaultAlt={collection.cover_alt ?? ""}
        canUpload={canUpload}
        maxUploadMb={imageMaxMb}
        saveLabel="Save details"
      />
      <SelectField
        label="Who can read it"
        name="audience"
        value={audience}
        onChange={(e) => setAudience(e.target.value as "members" | "group")}
        disabled={lockedAudience}
        hint={lockedAudience ? "Only a content publisher changes who sees a published collection." : "Never public: imported collections are for approved adult members."}
        error={fe.audience}
      >
        <option value="members">Approved members</option>
        <option value="group">One group</option>
      </SelectField>
      {lockedAudience ? <input type="hidden" name="audience" value={collection.audience} /> : null}
      {audience === "group" ? (
        <SelectField label="Group" name="group_id" defaultValue={v?.group_id ?? collection.group_id ?? ""} disabled={lockedAudience} error={fe.group_id}>
          <option value="">Choose a group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {lockedAudience && collection.group_id ? <input type="hidden" name="group_id" value={collection.group_id} /> : null}
      <SubmitButton pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}

export function ReadingForm({
  reading,
  locked,
}: {
  reading: { id: string; collection_id: string; revision: number; key_verse: string; scripture_ref: string; body: string; label: string };
  locked: boolean;
}) {
  const [state, action] = useActionState(saveReadingAction, initialFormState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={reading.id} />
      <input type="hidden" name="collection_id" value={reading.collection_id} />
      <input type="hidden" name="revision" value={reading.revision} />
      <FormMessage state={state} />
      <TextAreaField label="Key verse" name="key_verse" rows={2} maxLength={1000} defaultValue={v?.key_verse ?? reading.key_verse} disabled={locked} error={fe.key_verse} />
      <TextField label="Scripture reference" name="scripture_ref" maxLength={120} defaultValue={v?.scripture_ref ?? reading.scripture_ref} disabled={locked} error={fe.scripture_ref} />
      <TextAreaField
        label="Text"
        name="body"
        rows={18}
        maxLength={20000}
        required
        defaultValue={v?.body ?? reading.body}
        disabled={locked}
        hint="Separate paragraphs with a blank line. Put each line of a hymn or poem on its own line. Plain text only."
        error={fe.body}
      />
      <p className="text-meta text-text-secondary">
        Readings have no year: a correction changes the {reading.label} reading for every year, from now on. The reading keeps its link, and
        members&apos; reflections stay attached to it.
      </p>
      {locked ? null : <SubmitButton pendingText="Saving…">Save correction</SubmitButton>}
    </form>
  );
}

export function RestoreForm({ reading, importId, label }: { reading: { id: string; collection_id: string; revision: number }; importId?: string; label: string }) {
  const [state, action] = useActionState(restoreReadingAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={reading.id} />
      <input type="hidden" name="collection_id" value={reading.collection_id} />
      <input type="hidden" name="revision" value={reading.revision} />
      {importId ? <input type="hidden" name="import_id" value={importId} /> : null}
      <FormMessage state={state} />
      <SubmitButton variant="secondary" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />} pendingText="Restoring…">
        {label}
      </SubmitButton>
    </form>
  );
}

export function RemoveForm({ collection }: { collection: CollectionAdmin }) {
  const [state, action] = useActionState(removeCollectionAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={collection.id} />
      <FormMessage state={state} />
      <TextField
        label={`Type ${collection.key} to confirm`}
        name="confirm"
        autoComplete="off"
        required
        hint={`Deletes the ${collection.readings.toLocaleString("en-US")} readings, their import history, and their revisions. Other content is untouched. Members' journal entries keep their text; their link to a removed reading reads "no longer available".`}
      />
      <SubmitButton variant="danger" size="sm" pendingText="Removing…">
        Remove this collection
      </SubmitButton>
    </form>
  );
}
