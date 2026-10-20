"use client";

import { useActionState } from "react";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { REMINDER_CHOICES } from "@/lib/events/format";
import { initialFormState } from "@/lib/forms";
import { retryEventEmailAction, saveCategoryAction, saveEventSettingsAction } from "../actions";

export function CategoryForm({ category }: { category?: { id: string; name: string; active: boolean; sort_order: number; events: number } }) {
  const [state, action] = useActionState(saveCategoryAction, initialFormState);
  const key = category?.id ?? "new";
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 py-3">
      <FormMessage state={state} />
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <TextField id={`cat-name-${key}`} label={category ? "Name" : "New category"} name="name" required maxLength={60} defaultValue={category?.name} className="min-w-48 flex-1" error={state.fieldErrors?.name} />
      <TextField id={`cat-sort-${key}`} label="Order" name="sortOrder" inputMode="numeric" defaultValue={String(category?.sort_order ?? 100)} className="w-24" />
      {category ? <CheckboxField id={`cat-active-${key}`} name="active" label="Active" defaultChecked={category.active} hint={`${category.events} events`} /> : null}
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        {category ? "Save" : "Add"}
      </SubmitButton>
    </form>
  );
}

export function EventSettingsForm({ publicFeed, reminders }: { publicFeed: boolean; reminders: number[] }) {
  const [state, action] = useActionState(saveEventSettingsAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="publicFeed"
        label="Publish a public church calendar feed"
        defaultChecked={publicFeed}
        hint="Anyone with the link can subscribe. It includes public events only; members-only events never appear in it."
      />
      <fieldset>
        <legend className="font-semibold">Default reminders for new events</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {REMINDER_CHOICES.map((c) => (
            <label key={c.minutes} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="reminders" value={c.minutes} defaultChecked={reminders.includes(c.minutes)} className="size-5 accent-primary" />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton size="sm" pendingText="Saving…">
        Save settings
      </SubmitButton>
    </form>
  );
}

export function RetryForm({ id }: { id: string }) {
  const [state, action] = useActionState(retryEventEmailAction, initialFormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="secondary" pendingText="Queuing…">
        Retry
      </SubmitButton>
    </form>
  );
}
