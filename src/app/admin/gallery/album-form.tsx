"use client";

import { useActionState, useState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveAlbumAction } from "./actions";

export type AlbumFormValues = {
  id?: string;
  title: string;
  description: string;
  album_on: string | null;
  event_series_id: string | null;
  audience: "members" | "group";
  group_id: string | null;
  uploads_open: boolean;
  sort_order: number;
};

export function AlbumForm({
  album,
  groups,
  events,
}: {
  album: AlbumFormValues;
  groups: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string; start_date: string }>;
}) {
  const [state, action] = useActionState(saveAlbumAction, initialFormState);
  const v = state.values;
  const [audience, setAudience] = useState(v?.audience ?? album.audience);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      {album.id ? <input type="hidden" name="id" value={album.id} /> : null}
      <TextField label="Title" name="title" required maxLength={160} defaultValue={v?.title ?? album.title} error={state.fieldErrors?.title} />
      <TextAreaField label="Description" name="description" rows={3} maxLength={2000} defaultValue={v?.description ?? album.description} optional />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date" name="album_on" type="date" defaultValue={v?.album_on ?? album.album_on ?? ""} optional error={state.fieldErrors?.album_on} />
        <SelectField
          label="Related event"
          name="event_series_id"
          defaultValue={v?.event_series_id ?? album.event_series_id ?? ""}
          optional
          hint="For context only. It doesn't change who can see the album."
        >
          <option value="">None</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ({e.start_date})
            </option>
          ))}
        </SelectField>
      </div>
      <SelectField label="Who can see it" name="audience" value={audience} onChange={(e) => setAudience(e.target.value as "members" | "group")} hint="Albums are never public.">
        <option value="members">Approved members</option>
        <option value="group">One group</option>
      </SelectField>
      {audience === "group" ? (
        <SelectField label="Group" name="group_id" defaultValue={v?.group_id ?? album.group_id ?? ""} error={state.fieldErrors?.group_id}>
          <option value="">Choose a group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <CheckboxField
        name="uploads_open"
        label="Members can add photos"
        hint="Every photo waits for a gallery moderator's approval before anyone else sees it."
        defaultChecked={v ? v.uploads_open === "on" : album.uploads_open}
      />
      <TextField label="Display order" name="sort_order" type="number" min={0} max={100000} defaultValue={v?.sort_order ?? String(album.sort_order)} />
      <SubmitButton pendingText="Saving…">{album.id ? "Save album" : "Create album"}</SubmitButton>
    </form>
  );
}
