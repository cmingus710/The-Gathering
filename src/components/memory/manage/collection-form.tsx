"use client";

import { useActionState, useState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveCollectionAction } from "@/lib/memory/manage-actions";
import type { Collection } from "@/lib/memory/types";
import type { ManageBase } from "./types";

/**
 * Collection details. Audience, Bible version, and kind can change only
 * while it's a draft (published collections keep them; duplicate to make a
 * new version).
 */
export function CollectionForm({
  base,
  collection,
  translations,
  defaultTranslation,
  groups,
  leaderOnly,
  timezone,
}: {
  base: ManageBase;
  collection?: Collection;
  translations: Array<{ id: string; code: string; name: string }>;
  defaultTranslation: string | null;
  groups: Array<{ id: string; name: string }>;
  leaderOnly: boolean;
  timezone: string;
}) {
  const [state, action] = useActionState(saveCollectionAction, initialFormState);
  const [clientKey] = useState(() => crypto.randomUUID());
  const draft = !collection || collection.status === "draft";
  const [audience, setAudience] = useState<string>(collection?.audience ?? (leaderOnly ? "group" : "members"));
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="base" value={base} />
      {collection ? <input type="hidden" name="id" value={collection.id} /> : <input type="hidden" name="client_key" value={clientKey} />}
      <TextField label="Title" name="title" required maxLength={120} defaultValue={v("title", collection?.title ?? "")} />
      <TextAreaField label="Description" name="description" rows={3} maxLength={2000} optional defaultValue={v("description", collection?.description ?? "")} hint="Shown to members. Keep explanations here or in verse notes, never mixed into scripture." />
      {draft ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {leaderOnly ? (
              <input type="hidden" name="audience" value="group" />
            ) : (
              <SelectField label="Who it's for" name="audience" defaultValue={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="members">All approved members</option>
                <option value="group">One group</option>
              </SelectField>
            )}
            {audience === "group" ? (
              <SelectField label="Group" name="group_id" defaultValue={v("group_id", collection?.group_id ?? groups[0]?.id ?? "")}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <input type="hidden" name="group_id" value="" />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Bible version" name="translation_id" defaultValue={v("translation_id", collection?.translation.id ?? defaultTranslation ?? translations[0]?.id ?? "")} hint="Every verse in the collection uses this version. It's never switched silently.">
              {translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </SelectField>
            <SelectField label="Kind" name="kind" defaultValue={v("kind", collection?.kind ?? "collection")} hint="A sequence assigns one verse after another, week by week.">
              <option value="collection">Collection</option>
              <option value="sequence">Multiweek sequence</option>
            </SelectField>
          </div>
          <input type="hidden" name="timezone" value={collection?.timezone ?? timezone} />
        </>
      ) : (
        <p className="text-meta text-text-secondary">
          For {collection!.audience === "group" ? collection!.group_name : "all members"} · {collection!.translation.name} ({collection!.translation.code}) · {collection!.kind === "sequence" ? "multiweek sequence" : "collection"}. These are fixed after publishing; duplicate it to change them.
        </p>
      )}
      {draft || !collection?.translation_choice ? (
        <>
          <input type="hidden" name="translation_choice_field" value="1" />
          <CheckboxField
            name="translation_choice"
            label="Members may practice in their own Bible version"
            defaultChecked={collection?.translation_choice ?? false}
            hint={
              draft
                ? "Off: everyone practices in the version above. On: each member may choose another version that's available for memory practice; the collection itself never changes. After publishing this can be turned on but not off."
                : "Each member may choose another version for themselves; the collection itself never changes. Once on, it stays on for this collection."
            }
          />
        </>
      ) : (
        <p className="text-meta text-text-secondary">Members may practice in their own Bible version. This stays on for this collection; duplicate it to require one version.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Practice goal" name="goal_note" optional maxLength={300} defaultValue={v("goal_note", collection?.goal_note ?? "")} hint='For example "Learn one verse a week."' className="sm:col-span-2" />
        <TextField label="Suggested sessions a week" name="goal_sessions_per_week" optional inputMode="numeric" pattern="\d{1,2}" defaultValue={v("goal_sessions_per_week", collection?.goal_sessions_per_week ? String(collection.goal_sessions_per_week) : "")} />
      </div>
      <TextField label="Order" name="sort_order" inputMode="numeric" pattern="\d{1,5}" defaultValue={v("sort_order", String(collection?.sort_order ?? 100))} hint="Lower numbers are listed first." />
      <SubmitButton pendingText="Saving…">{collection ? "Save details" : "Create collection"}</SubmitButton>
    </form>
  );
}
