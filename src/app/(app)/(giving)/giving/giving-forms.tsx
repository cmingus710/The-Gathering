"use client";

import { CreditCard, XCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { formatCents } from "@/lib/giving/money";
import { cancelRecurringAction, changeAmountAction, claimGiftAction, updatePaymentMethodAction } from "../actions";

export function RecurringControls({ commitmentId, amountCents, formToken }: { commitmentId: string; amountCents: number; formToken: string }) {
  const [editing, setEditing] = useState(false);
  // Close the editor once the new amount is saved, so the other controls come back.
  const [amountState, amountAction] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await changeAmountAction(prev, formData);
    if (result.status === "success") setEditing(false);
    return result;
  }, initialFormState);
  const [cancelState, cancelAction] = useActionState(cancelRecurringAction, initialFormState);
  const [pmState, pmAction] = useActionState(updatePaymentMethodAction, initialFormState);
  const state = [amountState, cancelState, pmState].find((s) => s.status !== "idle") ?? initialFormState;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <FormMessage state={state} />
      {editing ? (
        <form action={amountAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="commitmentId" value={commitmentId} />
          <input type="hidden" name="formToken" value={formToken} />
          <TextField label="New amount (USD)" name="amount" inputMode="decimal" defaultValue={(amountCents / 100).toFixed(2)} error={amountState.fieldErrors?.amount} className="w-44" />
          <SubmitButton size="sm" pendingText="Saving…">
            Save amount
          </SubmitButton>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Keep current amount
          </Button>
          <p className="w-full text-sm text-text-secondary">Applies to future gifts only. Past gifts keep their amounts.</p>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Change amount<span className="sr-only"> of {formatCents(amountCents)} gift</span>
          </Button>
          <form action={pmAction}>
            <input type="hidden" name="commitmentId" value={commitmentId} />
            <SubmitButton size="sm" variant="secondary" pendingText="Opening…" icon={<CreditCard className="size-4" aria-hidden="true" />}>
              Update payment method
            </SubmitButton>
          </form>
          <ConfirmDialog
            trigger={
              <>
                <XCircle className="size-4" aria-hidden="true" /> Cancel recurring gift
              </>
            }
            title="Cancel this recurring gift?"
            confirmLabel="Cancel recurring gift"
            formAction={cancelAction}
            hidden={{ commitmentId }}
          >
            This takes effect immediately: no further gifts will be charged. Gifts you&apos;ve already given are not affected.
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

export function ClaimForm() {
  const [state, action] = useActionState(claimGiftAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Gift reference" name="code" placeholder="ABCDE-12345" autoComplete="off" maxLength={20} defaultValue={state.values?.code} />
      <SubmitButton variant="secondary" pendingText="Checking…">
        Add gift
      </SubmitButton>
    </form>
  );
}
