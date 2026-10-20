"use client";

import { useActionState, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { formatCents } from "@/lib/giving/money";
import {
  associateDonorAction,
  correctManualAction,
  reconcileAction,
  recordManualAction,
  refundAction,
  retryEmailAction,
  reverseManualAction,
  saveFundAction,
  saveSettingsAction,
} from "./actions";

type Fund = { id: string; name: string; active: boolean };
type Donor = { id: string; name: string; email: string } | null;

export type ManualDefaults = {
  donorName?: string;
  receivedOn: string;
  amount?: string;
  fundId?: string;
  method?: "cash" | "check";
  checkReference?: string;
  note?: string;
};

function ManualFields({ state, funds, donor, defaults, today }: { state: FormState; funds: Fund[]; donor: Donor; defaults: ManualDefaults; today: string }) {
  const v = { ...defaults, ...(state.status === "error" ? state.values : {}) } as ManualDefaults & Record<string, string>;
  const [method, setMethod] = useState<"cash" | "check">((v.method as "cash" | "check") ?? "check");
  const err = state.fieldErrors ?? {};
  return (
    <>
      <input type="hidden" name="donorProfileId" value={donor?.id ?? ""} />
      {donor ? (
        <p>
          Donor: <span className="font-semibold">{donor.name}</span> <span className="text-text-secondary">({donor.email})</span>
        </p>
      ) : (
        <TextField label="Donor name" name="donorName" optional hint="Leave blank for an unidentified donor. Link a member account to show the gift in their history." defaultValue={v.donorName} error={err.donorName} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date received" name="receivedOn" type="date" max={today} required defaultValue={v.receivedOn} error={err.receivedOn} />
        <TextField label="Amount (USD)" name="amount" inputMode="decimal" required defaultValue={v.amount} error={err.amount} />
      </div>
      {/* Keyed so a submitted choice survives an error (a select reads defaultValue only when mounted). */}
      <SelectField key={v.fundId ?? "default"} label="Fund" name="fundId" defaultValue={v.fundId ?? funds.find((f) => f.active)?.id} error={err.fundId}>
        {funds.filter((f) => f.active || f.id === v.fundId).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </SelectField>
      <fieldset>
        <legend className="font-semibold">Method</legend>
        <div className="mt-2 flex gap-4">
          {(["check", "cash"] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="size-5 accent-primary" />
              {m === "cash" ? "Cash" : "Check"}
            </label>
          ))}
        </div>
      </fieldset>
      {method === "check" ? (
        <TextField label="Check number or reference" name="checkReference" optional maxLength={60} hint="Don't enter bank account or routing numbers." defaultValue={v.checkReference} error={err.checkReference} />
      ) : (
        <input type="hidden" name="checkReference" value="" />
      )}
      <TextAreaField label="Internal note" name="note" optional maxLength={500} hint="Visible to finance users only." defaultValue={v.note} error={err.note} />
    </>
  );
}

export function RecordManualForm({ funds, donor, today, formToken }: { funds: Fund[]; donor: Donor; today: string; formToken: string }) {
  const [state, action] = useActionState(recordManualAction, initialFormState);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      {state.status === "success" && state.values?.paymentId ? (
        <p>
          <a href={`/admin/finance/contributions/${state.values.paymentId}`} className="font-semibold text-primary underline">
            View the recorded gift
          </a>{" "}
          · <a href="/admin/finance/manual" className="font-semibold text-primary underline">Record another</a>
        </p>
      ) : null}
      <input type="hidden" name="formToken" value={formToken} />
      <ManualFields state={state} funds={funds} donor={donor} defaults={{ receivedOn: today }} today={today} />
      <SubmitButton pendingText="Recording…" >Record gift</SubmitButton>
    </form>
  );
}

export function CorrectManualForm({ paymentId, funds, donor, defaults, today, formToken }: { paymentId: string; funds: Fund[]; donor: Donor; defaults: ManualDefaults; today: string; formToken: string }) {
  const [state, action] = useActionState(correctManualAction, initialFormState);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="formToken" value={formToken} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <ManualFields state={state} funds={funds} donor={donor} defaults={defaults} today={today} />
      <TextField label="Reason for correction" name="reason" required maxLength={250} error={state.fieldErrors?.reason} />
      <SubmitButton pendingText="Saving…">Save correction</SubmitButton>
    </form>
  );
}

export function ReverseForm({ paymentId }: { paymentId: string }) {
  const [state, action] = useActionState(reverseManualAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <TextField label="Reason for reversal" name="reason" required maxLength={300} error={state.fieldErrors?.reason} hint="For example, a returned check or an entry made in error." />
      <SubmitButton variant="danger-outline" size="sm" pendingText="Reversing…">
        Reverse this gift
      </SubmitButton>
    </form>
  );
}

export function AssociateDonorForm({ paymentId, candidates, linked }: { paymentId: string; candidates: Array<{ id: string; name: string; email: string }>; linked: boolean }) {
  const [state, action] = useActionState(associateDonorAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      {candidates.length ? (
        <ul className="divide-y divide-border">
          {candidates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold">{c.name}</span> <span className="text-text-secondary">{c.email}</span>
              </span>
              <form action={action}>
                <input type="hidden" name="paymentId" value={paymentId} />
                <input type="hidden" name="profileId" value={c.id} />
                <SubmitButton size="sm" variant="secondary" pendingText="Linking…">
                  Link<span className="sr-only"> {c.name}</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      {linked ? (
        <form action={action}>
          <input type="hidden" name="paymentId" value={paymentId} />
          <input type="hidden" name="profileId" value="" />
          <SubmitButton size="sm" variant="ghost" pendingText="Removing…">
            Remove donor link
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

export function RefundForm({ paymentId, remainingCents, formToken }: { paymentId: string; remainingCents: number; formToken: string }) {
  const [state, action] = useActionState(refundAction, initialFormState);
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <TextField label="Refund amount (USD)" name="amount-display" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} hint={`Up to ${formatCents(remainingCents)}. Stripe's processing fee is not returned.`} error={state.fieldErrors?.amount} className="max-w-xs" />
      <ConfirmDialog trigger="Issue refund…" title="Issue this refund?" confirmLabel="Refund now" formAction={action} hidden={{ paymentId, formToken, amount }}>
        {`This refunds ${amount ? `$${amount}` : "the amount"} to the donor's original payment method through Stripe (test mode). It can't be undone. The donor is notified by email.`}
      </ConfirmDialog>
    </div>
  );
}

export function RetryEmailButton({ emailId }: { emailId: string }) {
  const [state, action] = useActionState(retryEmailAction, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="emailId" value={emailId} />
      <SubmitButton size="sm" variant="ghost" pendingText="Retrying…">
        Retry
      </SubmitButton>
      {state.status !== "idle" ? <span role="status" className="ml-2 text-sm">{state.message}</span> : null}
    </form>
  );
}

export function ReconcileForm({ from, to }: { from: string; to: string }) {
  const [state, action] = useActionState(reconcileAction, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-4">
        <TextField label="From" name="from" type="date" defaultValue={v.from ?? from} />
        <TextField label="To" name="to" type="date" defaultValue={v.to ?? to} />
      </div>
      <SubmitButton pendingText="Reconciling with Stripe…">Reconcile with Stripe</SubmitButton>
    </form>
  );
}

export function FundForm({ fund }: { fund?: { id: string; name: string; description: string | null; sort_order: number; active: boolean } }) {
  const [state, action] = useActionState(saveFundAction, initialFormState);
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const id = fund?.id ?? "new";
  return (
    <form action={action} noValidate className="space-y-3 py-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={fund?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <TextField id={`fund-name-${id}`} label="Name" name="name" required maxLength={80} defaultValue={v.name ?? fund?.name} error={state.fieldErrors?.name} />
        <TextField id={`fund-order-${id}`} label="Order" name="sortOrder" inputMode="numeric" defaultValue={v.sortOrder ?? String(fund?.sort_order ?? 0)} />
      </div>
      <TextField id={`fund-desc-${id}`} label="Description" name="description" optional maxLength={300} defaultValue={v.description ?? fund?.description ?? ""} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="op" value="save" size="sm" variant="secondary" pendingText="Saving…">
          {fund ? "Save" : "Add fund"}
        </SubmitButton>
        {fund ? (
          fund.active ? (
            <SubmitButton name="op" value="archive" size="sm" variant="ghost" pendingText="Archiving…">
              Archive
            </SubmitButton>
          ) : (
            <SubmitButton name="op" value="restore" size="sm" variant="ghost" pendingText="Restoring…">
              Restore
            </SubmitButton>
          )
        ) : null}
      </div>
    </form>
  );
}

export type SettingsValues = { minAmount: string; maxAmount: string; acknowledgment: string; orgName: string; orgAddress: string; taxId: string; wording: string; approved: boolean };

export function SettingsForm({ initial, readOnly }: { initial: SettingsValues; readOnly: boolean }) {
  const [state, action] = useActionState(saveSettingsAction, initialFormState);
  const v = { ...initial, ...(state.values ?? {}) } as SettingsValues & Record<string, string>;
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Minimum online gift (USD)" name="minAmount" inputMode="decimal" defaultValue={v.minAmount} />
          <TextField label="Maximum online gift (USD)" name="maxAmount" inputMode="decimal" defaultValue={v.maxAmount} />
        </div>
        <TextAreaField label="Acknowledgment message" name="acknowledgment" maxLength={1000} hint="Included in every gift acknowledgment email. Avoid tax language unless it has been approved." defaultValue={v.acknowledgment} error={err.acknowledgment} />
        <fieldset className="space-y-4 rounded-card border border-border p-4">
          <legend className="px-1 font-semibold">Annual statement details</legend>
          <p className="text-meta text-text-secondary">
            Statements stay in draft (watermarked, not available to members) until these are entered from the church&apos;s approved
            records and marked approved. Don&apos;t enter wording that hasn&apos;t been approved.
          </p>
          <TextField label="Legal organization name" name="orgName" optional maxLength={120} defaultValue={v.orgName} />
          <TextAreaField label="Organization address" name="orgAddress" optional maxLength={300} defaultValue={v.orgAddress} />
          <TextField label="Tax ID (EIN)" name="taxId" optional maxLength={40} defaultValue={v.taxId} />
          <TextAreaField label="Statement acknowledgment wording" name="wording" optional maxLength={2000} defaultValue={v.wording} />
          <label className="flex items-start gap-3">
            <input type="checkbox" name="approved" defaultChecked={initial.approved} className="mt-1 size-5 accent-primary" />
            <span>
              <span className="font-semibold">These statement details and wording are approved by the church</span>
              <span className="block text-meta text-text-secondary">Members can download statements only when this is checked.</span>
            </span>
          </label>
        </fieldset>
        {!readOnly ? <SubmitButton pendingText="Saving…">Save settings</SubmitButton> : null}
      </fieldset>
    </form>
  );
}
