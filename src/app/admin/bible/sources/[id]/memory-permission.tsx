"use client";

import { useActionState } from "react";
import { CheckboxField, TextAreaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { memoryExercisesAction, memoryPermissionAction } from "../actions";

export type MemoryPermission = {
  unchanged_text: boolean;
  terms_note: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  cards: number;
  exercise_modes: boolean;
  exercise_note: string | null;
  exercise_confirmed_at: string | null;
  exercise_confirmed_by: string | null;
  publisher_approval_required: boolean;
  publisher_approval_note: string | null;
  publisher_approval_confirmed_at: string | null;
  publisher_approval_confirmed_by: string | null;
};

const when = (at: string | null, by: string | null) => (at ? ` Recorded ${at.slice(0, 10)}${by ? ` by ${by}` : ""}.` : "");

/**
 * Memory verses for a licensed version, in two steps, each recorded with
 * what was checked: first unchanged-text practice (verse page, flashcards,
 * self-check); then all six exercises, on screen only (API.Bible support's
 * written clarification, 2026-10-26). A version with a direct publisher
 * agreement (NIV: Biblica's feature-approval clause) also needs that
 * approval recorded before its exercises can be turned on.
 */
export function MemoryPermissionForm({ translationId, code, permission }: { translationId: string; code: string; permission: MemoryPermission | null }) {
  const [state, action] = useActionState(memoryPermissionAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={translationId} />
      <CheckboxField
        name="unchanged_text"
        label={`Offer ${code} for memory verses, shown unchanged`}
        defaultChecked={permission?.unchanged_text ?? false}
        hint="Members see the verse exactly as API.Bible returns it, with its copyright and usage reporting, in flashcards and self-check. The text is fetched when shown and never stored. Turning this off pauses practice (and the exercises below); members' verses and results are kept."
      />
      <TextAreaField
        label="What you checked"
        name="terms_note"
        rows={4}
        maxLength={2000}
        required
        defaultValue={state.values?.terms_note ?? permission?.terms_note ?? ""}
        error={state.fieldErrors?.terms_note}
        hint={`For example: the API.Bible dashboard entry for ${code}, its license or publisher terms, the date, and what they say about memory verses, caching, and FUMS.`}
      />
      {permission?.confirmed_at ? <p className="text-meta text-text-secondary">{`Unchanged-text practice:${when(permission.confirmed_at, permission.confirmed_by)}`}</p> : null}
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}

/** The second step: all six exercises (on screen only), and the publisher's own feature approval where its agreement needs one. */
export function MemoryExercisesForm({ translationId, code, permission }: { translationId: string; code: string; permission: MemoryPermission | null }) {
  const [state, action] = useActionState(memoryExercisesAction, initialFormState);
  if (!permission?.unchanged_text) {
    return <p className="text-meta text-text-secondary">Record that {code} may be shown unchanged for memory verses first.</p>;
  }
  const needsPublisher = permission.publisher_approval_required;
  const approved = !!permission.publisher_approval_confirmed_at;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="translation_id" value={translationId} />
      <p className="text-meta text-text-secondary">
        Read &amp; repeat, flashcards both ways, missing words, word order, typed recall, and self-check with hints. Words are hidden, revealed, or rearranged on the
        member&apos;s screen only. The verse is fetched when shown and never stored, and nothing altered, no typed answer, and no answer feedback is kept: only scores.
        The abbreviation and copyright notice stay on screen, and each display is reported to FUMS.
      </p>
      {needsPublisher ? (
        <fieldset className="space-y-3 rounded-tile border border-primary/50 bg-primary-soft/40 p-3">
          <legend className="px-1 font-semibold">{code}: publisher feature approval</legend>
          <p className="text-meta">
            {code} is licensed through a direct agreement with its publisher that requires feature approval for significantly new or enhanced product editions (for NIV,
            Biblica&apos;s §V.K). API.Bible&apos;s clarification covers the exercise mechanics, not that agreement. Record the publisher&apos;s approval here before
            turning on the exercises.
            {approved ? when(permission.publisher_approval_confirmed_at, permission.publisher_approval_confirmed_by) : ""}
          </p>
          <input type="hidden" name="publisher_field" value="1" />
          <CheckboxField name="publisher_approval_confirmed" label={`The publisher has approved this feature for ${code}`} defaultChecked={approved} />
          <TextAreaField
            label="Publisher approval checked"
            name="publisher_approval_note"
            rows={3}
            maxLength={2000}
            optional={approved}
            defaultValue={state.values?.publisher_approval_note ?? permission.publisher_approval_note ?? ""}
            hint="Who approved it, when, and where the written approval is kept."
          />
        </fieldset>
      ) : null}
      <CheckboxField
        name="exercise_modes"
        label={`Offer all six memory exercises for ${code}`}
        defaultChecked={permission.exercise_modes}
        disabled={needsPublisher && !approved && !permission.exercise_modes}
        hint={`Turning this off returns ${code} to flashcards and self-check; members' verses and results are kept.${when(permission.exercise_confirmed_at, permission.exercise_confirmed_by)}`}
      />
      <TextAreaField
        label="Written permission relied on"
        name="exercise_note"
        rows={3}
        maxLength={2000}
        optional={permission.exercise_modes}
        defaultValue={state.values?.exercise_note ?? permission.exercise_note ?? ""}
        hint="For example: API.Bible support's written clarification (sender, date, ticket), and the license it refers to."
      />
      <SubmitButton pendingText="Saving…">Save exercises</SubmitButton>
    </form>
  );
}
