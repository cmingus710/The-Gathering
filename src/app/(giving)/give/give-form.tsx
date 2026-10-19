"use client";

import { useActionState, useId, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { FREQUENCY_LABEL, formatCents, parseDollarsToCents, type Frequency } from "@/lib/giving/money";
import { startGiveAction } from "../actions";

const PRESETS = [2500, 5000, 10000, 25000];

const chip = (selected: boolean) =>
  cn(
    "flex min-h-12 cursor-pointer items-center justify-center rounded-full border px-4 font-semibold transition-colors",
    "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
    selected ? "border-cta bg-cta text-on-cta" : "border-border-strong bg-surface hover:bg-surface-muted",
  );

export function GiveForm({
  funds,
  minCents,
  maxCents,
  formToken,
}: {
  funds: Array<{ id: string; name: string; description: string | null }>;
  minCents: number;
  maxCents: number;
  formToken: string;
}) {
  const [state, action] = useActionState(startGiveAction, initialFormState);
  const v = state.values ?? {};
  const [amount, setAmount] = useState(v.amount ?? "50");
  const [frequency, setFrequency] = useState<Frequency>((v.frequency as Frequency) ?? "one_time");
  const [fundId, setFundId] = useState(v.fundId ?? funds[0].id);
  const amountId = useId();
  const cents = parseDollarsToCents(amount);
  const inRange = cents !== null && cents >= minCents && cents <= maxCents;
  const fund = funds.find((f) => f.id === fundId);
  const amountError = state.fieldErrors?.amount?.[0] ?? (amount && cents === null ? "Enter an amount in dollars, like 25 or 25.50." : null);

  return (
    <form action={action} noValidate className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="formToken" value={formToken} />

      <Card>
        <fieldset>
          <legend className="mb-3 text-lg font-bold">Amount</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Suggested amounts">
            {PRESETS.map((p) => (
              <button key={p} type="button" className={chip(cents === p)} aria-pressed={cents === p} onClick={() => setAmount(String(p / 100))}>
                {formatCents(p).replace(".00", "")}
              </button>
            ))}
          </div>
          <label htmlFor={amountId} className="mt-4 block font-semibold">
            Amount in US dollars
          </label>
          <p id={`${amountId}-hint`} className="text-[0.95rem] text-text-secondary">
            Between {formatCents(minCents)} and {formatCents(maxCents)}.
          </p>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-lg font-semibold text-text-secondary" aria-hidden="true">
              $
            </span>
            <input
              id={amountId}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              aria-invalid={amountError || (cents !== null && !inRange) ? true : undefined}
              aria-describedby={`${amountId}-hint${amountError ? ` ${amountId}-error` : ""}`}
              className="block min-h-14 w-full rounded-control border border-border-strong bg-surface pl-9 pr-4 text-2xl font-bold"
            />
          </div>
          {amountError ? (
            <p id={`${amountId}-error`} className="mt-1.5 font-medium text-danger">
              {amountError}
            </p>
          ) : cents !== null && !inRange ? (
            <p className="mt-1.5 font-medium text-danger">The amount must be between {formatCents(minCents)} and {formatCents(maxCents)}.</p>
          ) : null}
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-3 text-lg font-bold">How often</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
              <label key={f} className={chip(frequency === f)}>
                <input type="radio" name="frequency" value={f} checked={frequency === f} onChange={() => setFrequency(f)} className="sr-only" />
                {FREQUENCY_LABEL[f]}
              </label>
            ))}
          </div>
          {frequency !== "one_time" ? (
            <p className="mt-3 text-[0.95rem] text-text-secondary">
              Recurring gifts start today and repeat {frequency === "weekly" ? "every week" : "every month"} until you cancel. You can change the amount or cancel at any time.
            </p>
          ) : null}
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-3 text-lg font-bold">Fund</legend>
          <div className="space-y-2">
            {funds.map((f) => (
              <label
                key={f.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-start gap-3 rounded-card border p-4 has-focus-visible:outline-3 has-focus-visible:outline-primary",
                  fundId === f.id ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-muted",
                )}
              >
                <input type="radio" name="fundId" value={f.id} checked={fundId === f.id} onChange={() => setFundId(f.id)} className="mt-1 size-5 accent-primary" />
                <span>
                  <span className="block font-semibold">{f.name}</span>
                  {f.description ? <span className="block text-[0.95rem] text-text-secondary">{f.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <div className="rounded-card border border-primary/50 bg-primary-soft p-5" aria-live="polite">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">Your gift</p>
        <p className="mt-1 text-xl font-bold">
          {inRange ? formatCents(cents!) : "—"} · {FREQUENCY_LABEL[frequency]} · {fund?.name}
        </p>
        <p className="mt-1 text-[0.95rem] text-text-secondary">You&apos;ll confirm payment on Stripe&apos;s secure checkout page.</p>
      </div>

      <SubmitButton pendingText="Opening secure checkout…" className="w-full sm:w-auto">
        Continue to secure checkout
      </SubmitButton>
    </form>
  );
}
