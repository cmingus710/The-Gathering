"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveAlbumAction } from "./actions";
import { AlbumCoverEditor, uploadAlbumCover, type StagedCover } from "./album-cover-editor";

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
  newCover,
}: {
  album: AlbumFormValues;
  groups: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string; start_date: string }>;
  /** New albums: offer a cover image, uploaded right after the album is created. */
  newCover?: { fileMb: number };
}) {
  const [state, action] = useActionState(saveAlbumAction, initialFormState);
  const v = state.values;
  const [audience, setAudience] = useState(v?.audience ?? album.audience);
  const [title, setTitle] = useState(v?.title ?? album.title);
  const [staged, setStaged] = useState<StagedCover | null>(null);
  const [coverProgress, setCoverProgress] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const router = useRouter();
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  });
  const started = useRef<string | null>(null);

  // The album exists now: upload its cover, then open the album either way.
  useEffect(() => {
    const albumId = state.status === "success" ? state.id : undefined;
    const cover = stagedRef.current;
    if (!albumId || started.current === albumId) return;
    started.current = albumId;
    if (!cover) {
      router.push(`/admin/gallery/${albumId}?saved=created`);
      return;
    }
    void uploadAlbumCover(
      albumId,
      cover,
      (p) => setCoverProgress(p.state === "uploading" ? `Uploading the cover… ${p.total ? Math.round((p.sent / p.total) * 100) : 0}%` : "Processing the cover…"),
      () => undefined,
    ).then((r) => {
      const q = r.ok ? "saved=created_cover" : `saved=created&error=${encodeURIComponent(`The album was created, but its cover wasn't saved: ${r.message}`)}`;
      router.push(`/admin/gallery/${albumId}?${q}#cover`);
    });
  }, [state, router]);

  return (
    <form
      action={action}
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        setBlocked(null);
        if (staged && !staged.noMinors) {
          e.preventDefault();
          setBlocked("Confirm that no one under 18 can be identified in the cover image, or discard the cover.");
        }
      }}
    >
      <FormMessage state={state} />
      {album.id ? <input type="hidden" name="id" value={album.id} /> : null}
      {newCover && staged ? <input type="hidden" name="then" value="cover" /> : null}
      <TextField
        label="Title"
        name="title"
        required
        maxLength={160}
        defaultValue={v?.title ?? album.title}
        onChange={(e) => setTitle(e.target.value)}
        error={state.fieldErrors?.title}
      />
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
      {newCover ? (
        <fieldset className="space-y-3 rounded-tile border border-border p-4">
          <legend className="px-1 font-semibold">Collection cover image</legend>
          <AlbumCoverEditor
            albumId={null}
            albumTitle={title}
            cover={null}
            coverUrl={null}
            canEdit
            canChoosePhoto={false}
            photos={[]}
            fileMb={newCover.fileMb}
            onStagedChange={setStaged}
          />
          <p className="text-meta text-text-secondary">Optional. You can also add or change it after creating the album, or choose one of its photos once they&apos;re published.</p>
        </fieldset>
      ) : null}
      {blocked ? <Alert tone="error" title={blocked} /> : null}
      {coverProgress ? <Alert tone="info" title={coverProgress} /> : null}
      <SubmitButton pendingText="Saving…" disabled={!!coverProgress || (state.status === "success" && !!state.id)}>
        {album.id ? "Save album" : "Create album"}
      </SubmitButton>
    </form>
  );
}
