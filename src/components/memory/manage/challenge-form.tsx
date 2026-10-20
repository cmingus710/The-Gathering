"use client";

import { useActionState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { saveChallengeAction } from "@/lib/memory/manage-actions";
import type { Challenge } from "@/lib/memory/types";
import type { ManageBase } from "./types";

/**
 * A group challenge: a published collection, dates, and a shared goal.
 * After creation the group, collection, and start date are fixed (the end
 * date can only move later), so what members agreed to doesn't change.
 */
export function ChallengeForm({
  base,
  challenge,
  groups,
  collections,
  today,
}: {
  base: ManageBase;
  challenge?: Challenge;
  groups: Array<{ id: string; name: string }>;
  collections: Array<{ id: string; title: string; audience: string; group_id: string | null }>;
  today: string;
}) {
  const [state, action] = useActionState(saveChallengeAction, initialFormState);
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="base" value={base} />
      {challenge ? <input type="hidden" name="id" value={challenge.id} /> : null}
      <TextField label="Title" name="title" required maxLength={120} defaultValue={v("title", challenge?.title ?? "")} />
      <TextAreaField label="Description" name="description" rows={3} maxLength={2000} optional defaultValue={v("description", challenge?.description ?? "")} />
      {challenge ? (
        <p className="text-meta text-text-secondary">
          {challenge.group?.name} · {challenge.collection?.title} · starts {challenge.starts_on}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Group" name="group_id" defaultValue={v("group_id", groups[0]?.id ?? "")}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Verse collection" name="collection_id" defaultValue={v("collection_id", collections[0]?.id ?? "")} hint="A published collection for all members, or for this group.">
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {challenge ? null : <TextField label="Starts" name="starts_on" type="date" required defaultValue={v("starts_on", today)} />}
        <TextField label="Ends" name="ends_on" type="date" required defaultValue={v("ends_on", challenge?.ends_on ?? "")} hint="At most 120 days after the start." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Shared goal (practice activities, together)" name="goal_sessions" required inputMode="numeric" pattern="\d{1,6}" defaultValue={v("goal_sessions", challenge ? String(challenge.goal_sessions) : "100")} />
        {challenge ? null : (
          <TextField
            label="Show totals once this many people share"
            name="min_participants"
            inputMode="numeric"
            pattern="\d{1,2}"
            defaultValue={v("min_participants", "5")}
            hint="At least 3. Larger numbers protect privacy in small groups."
          />
        )}
      </div>
      <SubmitButton pendingText="Saving…">{challenge ? "Save" : "Create challenge"}</SubmitButton>
    </form>
  );
}
