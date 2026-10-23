"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { ALL_ON_TEXT } from "@/lib/notifications/channels";
import { addMembershipAlertRecipientAction, removeMembershipAlertRecipientAction, setMembershipAlertsEnabledAction } from "./actions";

export function EnabledForm({ enabled, recipientCount, emailAll }: { enabled: boolean; recipientCount: number; emailAll: boolean }) {
  const [state, action] = useActionState(setMembershipAlertsEnabledAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      {emailAll ? (
        // "All email notifications" (Notifications, above) covers this type; the switch keeps its own value underneath.
        <p id="membership-alerts-all" role="status" className="text-meta text-text-secondary">
          {ALL_ON_TEXT} It&apos;s the &ldquo;All email notifications&rdquo; switch under Notifications, above.
        </p>
      ) : null}
      <fieldset disabled={emailAll} className="space-y-4 disabled:opacity-60" aria-describedby={emailAll ? "membership-alerts-all" : undefined}>
        <CheckboxField
          // Re-mount after a save so the box shows the stored value.
          key={String(enabled)}
          label="Send membership approval notifications"
          name="enabled"
          defaultChecked={enabled}
          hint={
            (enabled || emailAll) && recipientCount === 0
              ? "On, but nobody is listed yet, so no email will be sent."
              : "Turning this on doesn't notify anyone about people who are already waiting."
          }
        />
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save
        </SubmitButton>
      </fieldset>
    </form>
  );
}

export function RemoveRecipientList({ recipients }: { recipients: { id: string; email: string }[] }) {
  const [state, action] = useActionState(removeMembershipAlertRecipientAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      {recipients.length === 0 ? (
        <p className="text-meta text-text-secondary">Nobody is listed yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 break-all">{r.email}</span>
              <form action={action}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden="true" />} pendingText="Removing…">
                  <span>
                    Remove<span className="sr-only"> {r.email}</span>
                  </span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddRecipientForm() {
  const [state, action] = useActionState(addMembershipAlertRecipientAction, initialFormState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          // A fresh, empty field after each successful add.
          key={state.status === "success" ? state.message : "entry"}
          label="Add a recipient"
          name="email"
          type="email"
          autoComplete="off"
          hint="One email address at a time. Each person gets their own message."
          defaultValue={state.status === "error" ? (state.values?.email ?? "") : ""}
          error={fe.email}
          className="flex-1"
        />
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
