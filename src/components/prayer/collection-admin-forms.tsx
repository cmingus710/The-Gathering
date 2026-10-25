"use client";

import { Archive, ArchiveRestore, FolderInput, FolderPlus, ImagePlus } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  archiveCollectionAction,
  createCollectionAction,
  reassignPrayersAction,
  saveCollectionAction,
} from "@/app/admin/prayer/library/collection-actions";
import { useCroppedFileInput } from "@/components/media/use-cropped-file-input";
import { Badge } from "@/components/ui/badge";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { collectionHref, prayerCount, STATUS_LABEL, type AdminCollection, type AdminCollectionPrayer, type CollectionRef } from "@/lib/prayer/library";
import { PrayerCollectionFolder } from "./collection-folder";

const COVER_ASPECT = 3 / 2;

export function CollectionCreateForm() {
  const [state, action] = useActionState(createCollectionAction, initialFormState);
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <TextField label="Name" name="name" required minLength={2} maxLength={80} defaultValue={v.name} error={fe.name} hint="For example “Morning Prayers” or “Prayers by St. Francis”." />
      <TextAreaField label="Short description" name="description" optional rows={2} maxLength={300} defaultValue={v.description} error={fe.description} hint="One or two sentences shown on the collection's card." />
      <SubmitButton pendingText="Creating…" icon={<FolderPlus className="size-4" aria-hidden="true" />}>
        Create collection
      </SubmitButton>
    </form>
  );
}

/**
 * Name, description, and cover, with a live preview of the card members will
 * see. The cover can be cropped to the card's 3:2 frame (or kept whole)
 * before it uploads; the server checks, re-encodes, and strips metadata.
 */
export function CollectionDetailsForm({ collection, coverUrl }: { collection: AdminCollection; coverUrl: string | null }) {
  // Counts successful saves, so the image picker starts over from what was saved.
  const [state, action] = useActionState<FormState & { saves?: number }, FormData>(async (prev, formData) => {
    const result = await saveCollectionAction(prev, formData);
    return { ...result, saves: (prev.saves ?? 0) + (result.status === "success" ? 1 : 0) };
  }, initialFormState);
  const image = useCroppedFileInput({ aspect: COVER_ASPECT, frameLabel: "3:2", maxBytes: 8 * 1024 * 1024, savedKey: `${state.saves ?? 0}:${coverUrl}` });
  const fe = state.fieldErrors ?? {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const [name, setName] = useState(v.name ?? collection.name);
  const [description, setDescription] = useState(v.description ?? collection.description);
  const [removeCover, setRemoveCover] = useState(false);
  const previewSrc = image.preview ?? (removeCover ? null : coverUrl);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <form action={action} className="space-y-4">
        <FormMessage state={state} />
        <input type="hidden" name="collectionId" value={collection.id} />
        <TextField label="Name" name="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={fe.name} />
        <TextAreaField
          label="Short description"
          name="description"
          optional
          rows={2}
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={fe.description}
          hint="One or two sentences shown on the card and the collection page."
        />
        <div className="space-y-1.5">
          <label htmlFor="collection-cover" className="block font-semibold">
            Cover image <span className="font-normal text-text-secondary">(optional)</span>
          </label>
          <p id="collection-cover-hint" className="text-meta text-text-secondary">
            JPEG, PNG, or WebP, at least 240 pixels, up to 8 MB. Crop it to the card&apos;s 3:2 frame or keep it whole. It&apos;s resized and stored privately, without
            location or camera details. Don&apos;t use a photo in which anyone under 18 can be identified.
          </p>
          <input
            id="collection-cover"
            name="cover"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="collection-cover-hint"
            className="block w-full text-sm"
            {...image.inputProps}
          />
          {image.tooLarge ? <p className="text-meta font-medium text-danger">That image is larger than 8 MB. Choose a smaller one.</p> : null}
          {image.controls}
          {image.dialog}
          {fe.cover ? <p className="text-meta font-medium text-danger">{fe.cover[0]}</p> : null}
        </div>
        <TextField
          label="Cover description"
          name="coverAlt"
          optional
          maxLength={200}
          defaultValue={v.coverAlt ?? collection.cover?.alt ?? ""}
          error={fe.coverAlt}
          hint="For people using screen readers, e.g. “Sunrise over a field”. Leave blank if the image is decorative."
        />
        {coverUrl && !image.preview ? (
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="removeCover" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} className="size-5 accent-primary" />
            Remove the current cover
          </label>
        ) : null}
        <SubmitButton pendingText="Saving…" icon={<ImagePlus className="size-4" aria-hidden="true" />}>
          Save collection
        </SubmitButton>
      </form>
      <aside aria-label="Preview" className="space-y-2 lg:sticky lg:top-6 lg:self-start">
        <p className="text-meta font-semibold uppercase tracking-wide text-text-secondary">Preview: the card members see</p>
        {/* The preview isn't a working link while editing. */}
        <div inert className="max-w-56">
          <PrayerCollectionFolder
            href={collectionHref(collection.id)}
            collection={{ name: name.trim() || "Collection name", description: description.trim(), count: collection.counts.published }}
            src={previewSrc}
          />
        </div>
        <p className="text-meta text-text-secondary">
          {collection.archived
            ? "Archived: members don't see it."
            : collection.counts.published
              ? `Members see it with ${prayerCount(collection.counts.published)}.`
              : "Members won't see it until it holds a published prayer."}
        </p>
      </aside>
    </div>
  );
}

/**
 * Archive, after reviewing what it holds: published, hidden, and archived
 * prayers move to the chosen collection first (drafts too, or they become
 * unassigned). Or restore an archived collection.
 */
export function CollectionArchiveForm({ collection, targets }: { collection: AdminCollection; targets: CollectionRef[] }) {
  const [state, action] = useActionState(archiveCollectionAction, initialFormState);
  const fe = state.fieldErrors ?? {};
  const shared = collection.counts.published + collection.counts.hidden + collection.counts.archived;
  if (collection.archived) {
    return (
      <form action={action} className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="collectionId" value={collection.id} />
        <input type="hidden" name="archived" value="false" />
        <p className="text-meta text-text-secondary">Restored collections appear for members again once a published prayer is filed in them.</p>
        <SubmitButton variant="secondary" pendingText="Restoring…" icon={<ArchiveRestore className="size-4" aria-hidden="true" />}>
          Restore collection
        </SubmitButton>
      </form>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="collectionId" value={collection.id} />
      <input type="hidden" name="archived" value="true" />
      <ul className="space-y-0.5 text-meta">
        <li>
          <span className="font-semibold">{collection.counts.published}</span> published
        </li>
        <li>
          <span className="font-semibold">{collection.counts.hidden}</span> hidden by a moderator
        </li>
        <li>
          <span className="font-semibold">{collection.counts.archived}</span> archived
        </li>
        <li>
          <span className="font-semibold">{collection.counts.private}</span> private drafts (titles and text stay private to their contributors)
        </li>
      </ul>
      <SelectField
        label="Move its prayers to"
        name="reassignTo"
        defaultValue=""
        required={shared > 0}
        hint={
          shared > 0
            ? "Required: every prayer that was shared needs a collection. Review them in the list above first."
            : "Drafts move along if you choose one; otherwise their contributors choose again when they publish."
        }
      >
        <option value="">{shared > 0 ? "Choose a collection" : "Don't move drafts"}</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <CheckboxField name="confirm" label="I've reviewed the prayers in this collection" hint="Members will no longer see this collection. You can restore it later." />
      {fe.confirm ? <p className="text-meta font-medium text-danger">{fe.confirm[0]}</p> : null}
      <SubmitButton variant="secondary" pendingText="Archiving…" icon={<Archive className="size-4" aria-hidden="true" />}>
        Archive collection
      </SubmitButton>
    </form>
  );
}

/** The collection's prayers with checkboxes: move one, several, or all shown to another collection. */
export function ReassignPrayersForm({ collectionId, prayers, targets }: { collectionId: string; prayers: AdminCollectionPrayer[]; targets: CollectionRef[] }) {
  const [state, action] = useActionState(reassignPrayersAction, initialFormState);
  const [selected, setSelected] = useState<string[]>([]);
  // After a successful move the list changes: start the selection over.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.status === "success") setSelected([]);
  }
  const fe = state.fieldErrors ?? {};
  const all = prayers.length > 0 && selected.length === prayers.length;
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="collectionId" value={collectionId} />
      <label className="flex min-h-11 items-center gap-2 text-meta font-semibold">
        <input type="checkbox" checked={all} onChange={(e) => setSelected(e.target.checked ? prayers.map((p) => p.id) : [])} className="size-5 accent-primary" />
        Select all {prayers.length} shown
      </label>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {prayers.map((p) => (
          <li key={p.id} className="flex items-start gap-3 px-4 py-3">
            <input
              id={`move-${p.id}`}
              type="checkbox"
              name="prayer"
              value={p.id}
              checked={selected.includes(p.id)}
              onChange={(e) => toggle(p.id, e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <label htmlFor={`move-${p.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block font-semibold [overflow-wrap:anywhere]">{p.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-meta text-text-secondary">
                Shared by {p.contributor}
                {p.hidden ? <Badge tone="danger">Hidden</Badge> : p.status !== "published" ? <Badge tone="neutral">{STATUS_LABEL[p.status]}</Badge> : null}
              </span>
            </label>
            {p.status === "published" && !p.hidden ? (
              <Link href={`/prayer/library/${p.id}`} className="shrink-0 text-meta font-semibold text-primary hover:underline">
                View<span className="sr-only"> {p.title}</span>
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Move selected to" name="target" defaultValue="" error={fe.target} className="min-w-56 flex-1 sm:flex-none">
          <option value="">Choose a collection</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SubmitButton variant="secondary" pendingText="Moving…" disabled={!selected.length} icon={<FolderInput className="size-4" aria-hidden="true" />}>
          Move {selected.length ? prayerCount(selected.length) : "prayers"}
        </SubmitButton>
      </div>
      <p className="text-meta text-text-secondary">Moving keeps each prayer&apos;s owner, dates, labels, and bookmarks. No one is notified.</p>
    </form>
  );
}
