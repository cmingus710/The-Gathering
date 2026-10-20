import type Stripe from "stripe";
import { renderGivingEmail, type EmailJob } from "./emails";
import { IngestError, type Ingest } from "./ingest";

/**
 * Turns Stripe events into giving records.
 *
 * Rules:
 * - The webhook signature is verified before anything reaches this module.
 * - Every event is deduplicated by id in the database (event_begin/finish).
 * - Objects are always re-read from the Stripe API, so the stored state is
 *   Stripe's current state regardless of delivery order or duplicates, and
 *   the same functions repair missed events during reconciliation.
 * - Only provider-confirmed state is stored; the browser reaching a success
 *   page never marks a gift paid.
 * - Nothing personal is logged; errors are reduced to a short code.
 */

type List<T> = { data: T[] };

/** The subset of the Stripe SDK the processor uses (the real client satisfies it). */
export interface StripeLike {
  checkout: { sessions: { retrieve(id: string, params?: Stripe.Checkout.SessionRetrieveParams): Promise<Stripe.Checkout.Session> } };
  paymentIntents: { retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams): Promise<Stripe.PaymentIntent> };
  subscriptions: { retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<Stripe.Subscription> };
  invoices: { retrieve(id: string, params?: Stripe.InvoiceRetrieveParams): Promise<Stripe.Invoice> };
  charges: { retrieve(id: string, params?: Stripe.ChargeRetrieveParams): Promise<Stripe.Charge> };
  refunds: {
    retrieve(id: string, params?: Stripe.RefundRetrieveParams): Promise<Stripe.Refund>;
    list(params?: Stripe.RefundListParams): Promise<List<Stripe.Refund>>;
  };
  disputes: {
    retrieve(id: string, params?: Stripe.DisputeRetrieveParams): Promise<Stripe.Dispute>;
    list(params?: Stripe.DisputeListParams): Promise<List<Stripe.Dispute>>;
  };
  balanceTransactions: { retrieve(id: string, params?: Stripe.BalanceTransactionRetrieveParams): Promise<Stripe.BalanceTransaction> };
}

export type Mailer = {
  from: string;
  send(message: { to: string; subject: string; text: string; html: string; idempotencyKey: string }): Promise<
    { ok: true; id: string | null } | { ok: false; error: string }
  >;
};

export type ProcessorDeps = {
  stripe: StripeLike;
  ingest: Ingest;
  mailer: Mailer | null;
  siteUrl: string;
  emailAllowlist: string[];
};

export type MinimalEvent = { id: string; type: string; livemode: boolean; created: number; data: { object: { id?: string } } };

export type EventOutcome = "processed" | "ignored" | "duplicate" | "busy" | "live_mode_ignored";

export class RetryLaterError extends Error {
  constructor() {
    super("Event is already being processed");
    this.name = "RetryLaterError";
  }
}

const idOf = (v: string | { id: string } | null | undefined): string | null => (v == null ? null : typeof v === "string" ? v : v.id);

/** Exact fee from the balance transaction; never estimated. */
export async function feeFromCharge(stripe: StripeLike, charge: Stripe.Charge | null | undefined) {
  if (!charge) return { status: "pending" };
  let bt = charge.balance_transaction;
  if (typeof bt === "string") {
    try {
      bt = await stripe.balanceTransactions.retrieve(bt);
    } catch {
      return { status: "unavailable" };
    }
  }
  if (!bt) return { status: "pending" };
  if (bt.currency !== "usd") return { status: "unavailable", balance_transaction_id: bt.id };
  return { status: "known", fee_cents: bt.fee, net_cents: bt.net, balance_transaction_id: bt.id };
}

// ---------------------------------------------------------------------------
// Object sync (shared by webhooks and reconciliation)
// ---------------------------------------------------------------------------
export type SyncResult = { created?: boolean; changed?: boolean; ignored?: boolean };

export async function syncCheckoutSession(deps: ProcessorDeps, sessionId: string, opts: { asyncFailed?: boolean } = {}): Promise<SyncResult> {
  const s = await deps.stripe.checkout.sessions.retrieve(sessionId);
  const intentId = s.metadata?.gift_intent_id ?? s.client_reference_id ?? null;
  if (!intentId) return { ignored: true };
  const r = await deps.ingest<SyncResult & { frequency?: string }>("sync_checkout", {
    session_id: s.id,
    intent_id: intentId,
    status: s.status,
    payment_status: s.payment_status,
    async_failed: opts.asyncFailed ?? false,
    mode: s.mode,
    customer_id: idOf(s.customer as string | { id: string } | null),
    donor_name: s.customer_details?.name ?? null,
    donor_email: s.customer_details?.email ?? null,
    livemode: s.livemode,
  });
  if (r.ignored) return r;
  if (s.mode === "payment" && s.payment_intent) {
    const p = await syncPaymentIntent(deps, idOf(s.payment_intent as string | { id: string })!, {
      donorName: s.customer_details?.name ?? null,
      donorEmail: s.customer_details?.email ?? null,
    });
    return { created: r.created || p.created, changed: r.changed || p.changed };
  }
  if (s.mode === "subscription" && s.subscription) {
    const sub = await syncSubscription(deps, idOf(s.subscription as string | { id: string })!);
    return { created: sub.created, changed: r.changed || sub.changed };
  }
  return r;
}

export async function syncPaymentIntent(
  deps: ProcessorDeps,
  piId: string,
  donor: { donorName?: string | null; donorEmail?: string | null } = {},
): Promise<SyncResult> {
  const pi = await deps.stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
  const intentId = pi.metadata?.gift_intent_id;
  if (!intentId) return { ignored: true }; // invoice payments are handled by syncInvoice
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  return deps.ingest<SyncResult>("sync_payment", {
    intent_id: intentId,
    payment_intent_id: pi.id,
    pi_status: pi.status,
    amount_cents: pi.status === "succeeded" ? pi.amount_received : pi.amount,
    charge_id: idOf(pi.latest_charge as string | { id: string } | null),
    failure_code: pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? null,
    succeeded_at: charge?.created ?? null,
    donor_name: donor.donorName ?? charge?.billing_details?.name ?? null,
    donor_email: donor.donorEmail ?? charge?.billing_details?.email ?? null,
    fee: pi.status === "succeeded" ? await feeFromCharge(deps.stripe, charge) : null,
    livemode: pi.livemode,
  });
}

export async function syncSubscription(deps: ProcessorDeps, subscriptionId: string): Promise<SyncResult> {
  const sub = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  return deps.ingest<SyncResult>("sync_subscription", {
    subscription_id: sub.id,
    intent_id: sub.metadata?.gift_intent_id ?? null,
    status: sub.status,
    customer_id: idOf(sub.customer as string | { id: string }),
    item_id: item?.id ?? null,
    amount_cents: item?.price?.unit_amount != null ? item.price.unit_amount * (item.quantity ?? 1) : null,
    interval: item?.price?.recurring?.interval ?? null,
    next_payment_at: item?.current_period_end ?? null,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at,
    ended_at: sub.ended_at,
    livemode: sub.livemode,
  });
}

function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const details = inv.parent?.type === "subscription_details" ? inv.parent.subscription_details : null;
  return idOf((details?.subscription as string | { id: string } | null | undefined) ?? null);
}

export async function syncInvoice(deps: ProcessorDeps, invoiceId: string, opts: { failedEvent?: boolean } = {}): Promise<SyncResult> {
  const inv = await deps.stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  const subscriptionId = invoiceSubscriptionId(inv);
  if (!subscriptionId || inv.status === "draft" || inv.status === "void") return { ignored: true };

  const payments = inv.payments?.data ?? [];
  const chosen = payments.find((p) => p.status === "paid") ?? payments.find((p) => p.is_default) ?? payments[0];
  const piId = idOf((chosen?.payment?.payment_intent as string | { id: string } | undefined) ?? null);
  let pi: Stripe.PaymentIntent | null = null;
  if (piId) pi = await deps.stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
  const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;

  const failed =
    inv.status === "uncollectible" ||
    (inv.status === "open" && (opts.failedEvent || (pi?.status === "requires_payment_method" && !!pi.last_payment_error)));
  const outcome = inv.status === "paid" ? "succeeded" : failed ? "failed" : "pending";

  const payload = {
    invoice_id: inv.id,
    subscription_id: subscriptionId,
    outcome,
    amount_cents: inv.status === "paid" ? inv.amount_paid : inv.amount_due,
    paid_at: inv.status_transitions?.paid_at ?? null,
    payment_intent_id: pi?.id ?? null,
    charge_id: idOf((pi?.latest_charge as string | { id: string } | null | undefined) ?? null),
    failure_code: pi?.last_payment_error?.decline_code ?? pi?.last_payment_error?.code ?? null,
    recovery_url: outcome === "failed" ? (inv.hosted_invoice_url ?? null) : null,
    fee: outcome === "succeeded" ? await feeFromCharge(deps.stripe, charge) : null,
    livemode: inv.livemode,
  };
  let r = await deps.ingest<SyncResult & { needs_subscription?: boolean }>("sync_invoice", payload);
  if (r.needs_subscription) {
    // The invoice arrived before the subscription was recorded: record it, then retry once.
    const sub = await syncSubscription(deps, subscriptionId);
    if (sub.ignored) return { ignored: true };
    r = await deps.ingest("sync_invoice", payload);
    if (r.needs_subscription) return { ignored: true };
  }
  return r;
}

export async function syncCharge(deps: ProcessorDeps, chargeId: string, opts: { withRefunds?: boolean } = {}): Promise<SyncResult> {
  const ch = await deps.stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
  let r = await deps.ingest<SyncResult>("sync_charge", {
    charge_id: ch.id,
    payment_intent_id: idOf(ch.payment_intent as string | { id: string } | null),
    fee: ch.status === "succeeded" ? await feeFromCharge(deps.stripe, ch) : null,
  });
  if (r.ignored && ch.payment_intent) {
    // Charge event arrived before the checkout events: try the payment directly.
    const p = await syncPaymentIntent(deps, idOf(ch.payment_intent as string | { id: string })!);
    if (!p.ignored) r = await deps.ingest("sync_charge", { charge_id: ch.id, payment_intent_id: idOf(ch.payment_intent as string | { id: string }), fee: await feeFromCharge(deps.stripe, ch) });
  }
  if (r.ignored) return r;
  if (opts.withRefunds || ch.amount_refunded > 0) {
    const refunds = await deps.stripe.refunds.list({ charge: ch.id, limit: 100 });
    for (const refund of refunds.data) await recordRefund(deps, refund);
  }
  if (ch.disputed) {
    const disputes = await deps.stripe.disputes.list({ charge: ch.id, limit: 100 });
    for (const d of disputes.data) await recordDispute(deps, d);
  }
  return r;
}

async function recordRefund(deps: ProcessorDeps, refund: Stripe.Refund, initiatedBy?: string | null): Promise<SyncResult> {
  return deps.ingest<SyncResult>("sync_refund", {
    refund_id: refund.id,
    charge_id: idOf(refund.charge as string | { id: string } | null),
    payment_intent_id: idOf(refund.payment_intent as string | { id: string } | null),
    amount_cents: refund.amount,
    status: refund.status,
    reason: refund.reason,
    created: refund.created,
    initiated_by: initiatedBy ?? null,
  });
}

export async function syncRefund(deps: ProcessorDeps, refundId: string, initiatedBy?: string | null): Promise<SyncResult> {
  return recordRefund(deps, await deps.stripe.refunds.retrieve(refundId), initiatedBy);
}

async function recordDispute(deps: ProcessorDeps, d: Stripe.Dispute): Promise<SyncResult> {
  return deps.ingest<SyncResult>("sync_dispute", {
    dispute_id: d.id,
    charge_id: idOf(d.charge as string | { id: string }),
    payment_intent_id: idOf(d.payment_intent as string | { id: string } | null),
    amount_cents: d.amount,
    status: d.status,
    reason: d.reason,
    created: d.created,
  });
}

export async function syncDispute(deps: ProcessorDeps, disputeId: string): Promise<SyncResult> {
  return recordDispute(deps, await deps.stripe.disputes.retrieve(disputeId));
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------
/** Events the webhook endpoint should be subscribed to (see docs/giving-setup.md). */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.canceled",
  "charge.succeeded",
  "charge.updated",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

async function dispatch(deps: ProcessorDeps, event: MinimalEvent): Promise<SyncResult> {
  const id = event.data.object.id;
  if (!id) return { ignored: true };
  const t = event.type;
  if (t.startsWith("checkout.session.")) return syncCheckoutSession(deps, id, { asyncFailed: t === "checkout.session.async_payment_failed" });
  if (t.startsWith("payment_intent.")) return syncPaymentIntent(deps, id);
  if (t.startsWith("charge.dispute.")) return syncDispute(deps, id);
  if (t.startsWith("charge.")) return syncCharge(deps, id, { withRefunds: t === "charge.refunded" });
  if (t.startsWith("refund.")) return syncRefund(deps, id);
  if (t === "invoice.paid" || t === "invoice.payment_failed") return syncInvoice(deps, id, { failedEvent: t === "invoice.payment_failed" });
  if (t.startsWith("customer.subscription.")) return syncSubscription(deps, id);
  return { ignored: true };
}

function safeError(err: unknown): string {
  if (err instanceof IngestError) return `db:${err.code ?? "error"}`;
  const e = err as { type?: string; code?: string; name?: string };
  return [e?.type ?? e?.name ?? "error", e?.code].filter(Boolean).join(":").slice(0, 120);
}

export async function handleEvent(deps: ProcessorDeps, event: MinimalEvent): Promise<EventOutcome> {
  const begin = await deps.ingest<{ action: "process" | "skip" | "busy" | "ignore" }>("event_begin", {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    created: event.created,
  });
  if (begin.action === "skip") return "duplicate";
  if (begin.action === "busy") throw new RetryLaterError();
  if (begin.action === "ignore") return "live_mode_ignored";

  try {
    const r = await dispatch(deps, event);
    await deps.ingest("event_finish", { id: event.id, status: r.ignored ? "ignored" : "processed" });
    await deliverEmails(deps).catch(() => undefined);
    return r.ignored ? "ignored" : "processed";
  } catch (err) {
    await deps.ingest("event_finish", { id: event.id, status: "failed", error: safeError(err) }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Email delivery (retryable; tracked separately from payment state)
// ---------------------------------------------------------------------------
export async function deliverEmails(deps: ProcessorDeps, opts: { id?: string; limit?: number } = {}) {
  const jobs = await deps.ingest<EmailJob[]>("email_claim", { id: opts.id ?? null, limit: opts.limit ?? 10 });
  const summary = { sent: 0, failed: 0, suppressed: 0 };
  for (const job of jobs) {
    let result: { status: "sent" | "failed" | "suppressed"; provider_id?: string | null; error?: string };
    if (!job.livemode && !deps.emailAllowlist.includes(job.to.toLowerCase())) {
      // Test mode: only allow-listed test addresses ever receive email.
      result = { status: "suppressed", error: "not on the test allowlist" };
    } else if (!deps.mailer) {
      result = { status: "failed", error: "email not configured" };
    } else {
      const message = renderGivingEmail(job, deps.siteUrl);
      try {
        const sent = await deps.mailer.send({ to: job.to, ...message, idempotencyKey: `giving-${job.dedupe_key}` });
        result = sent.ok ? { status: "sent", provider_id: sent.id } : { status: "failed", error: sent.error };
      } catch (err) {
        result = { status: "failed", error: (err as Error)?.name ?? "error" };
      }
    }
    await deps.ingest("email_result", { id: job.id, ...result });
    summary[result.status] += 1;
  }
  return summary;
}
