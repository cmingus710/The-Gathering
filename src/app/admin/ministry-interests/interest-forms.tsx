"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { addInterestAction, updateInterestAction } from "./actions";

export function AddInterestForm() {
  const [state, action] = useActionState(addInterestAction, initialFormState);
  const v = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <TextField label="Option name" name="label" required maxLength={60} defaultValue={v.label} error={state.fieldErrors?.label} />
        <TextField label="Order" name="sortOrder" inputMode="numeric" optional defaultValue={v.sortOrder ?? ""} error={state.fieldErrors?.sortOrder} />
      </div>
      <SubmitButton pendingText="Adding…">Add option</SubmitButton>
    </form>
  );
}

export function InterestRow({ id, label, sortOrder, active, members }: { id: string; label: string; sortOrder: number; active: boolean; members: number }) {
  const [state, action] = useActionState(updateInterestAction, initialFormState);
  const v = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form action={action} noValidate className="space-y-3 py-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <TextField id={`label-${id}`} label="Name" name="label" maxLength={60} defaultValue={v.label ?? label} error={state.fieldErrors?.label} />
        <TextField id={`order-${id}`} label="Order" name="sortOrder" inputMode="numeric" defaultValue={v.sortOrder ?? String(sortOrder)} error={state.fieldErrors?.sortOrder} />
      </div>
      <p className="text-meta text-text-secondary">
        {members === 1 ? "Chosen by 1 member" : `Chosen by ${members} members`}
        {active ? "" : " · Archived (hidden from members)"}
      </p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="op" value="save" size="sm" variant="secondary" pendingText="Saving…">
          Save<span className="sr-only"> {label}</span>
        </SubmitButton>
        {active ? (
          <SubmitButton name="op" value="archive" size="sm" variant="ghost" pendingText="Archiving…">
            Archive<span className="sr-only"> {label}</span>
          </SubmitButton>
        ) : (
          <SubmitButton name="op" value="restore" size="sm" variant="ghost" pendingText="Restoring…">
            Restore<span className="sr-only"> {label}</span>
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
