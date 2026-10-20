import "server-only";
import { createHmac } from "node:crypto";
import type Stripe from "stripe";
import type { Frequency } from "./money";
import { deliverEmails, syncCharge, syncCheckoutSession, syncDispute, syncInvoice, syncRefund, syncSubscription } from "./processor";
import { stripeClient, type GivingServer } from "./server";

/**
 * Payment-provider extension point. Stripe-hosted Checkout is the only
 * provider in this phase (cards, plus Apple Pay / Google Pay where Stripe
 * offers them). A future provider (e.g. PayPal or Venmo) would implement the
 * same shape: create a hosted session from a prepared intent, and report
 * confirmed payments through the same giving_ingest operations. No buttons
 * are shown for providers that aren't implemented.
 */
export type CheckoutProvider = "stripe";

export type CheckoutRequest = {
  profileId: string | null;
  fundId: string;
  amountCents: number;
  frequency: Frequency;
  formToken: string;
  clientIp: string | null;
};

export class CheckoutError extends Error {}

/** Rate-limit key: the client IP is never stored, only a keyed hash of it. */
function ipKey(server: GivingServer, ip: string | null): string {
  const h = createHmac("sha256", server.config.ingestSecret).update(`ip:${ip ?? "unknown"}`).digest("hex").slice(0, 24);
  return `checkout:ip:${h}`;
}

async function ensureFundProduct(server: GivingServer, fundId: string, fundName: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  const stripe = stripeClient(server);
  // Product names are generic (no donor data). The idempotency key makes concurrent creation safe.
  const product = await stripe.products.create(
    { name: `Gift: ${fundName}`, metadata: { fund_id: fundId } },
    { idempotencyKey: `gathering-fund-product-${fundId}` },
  );
  const r = await server.ingest<{ product_id: string }>("fund_product", { fund_id: fundId, product_id: product.id });
  return r.product_id;
}

async function ensureCustomer(server: GivingServer, profileId: string, email: string | null, existing: string | null): Promise<string> {
  if (existing) return existing;
  const stripe = stripeClient(server);
  // Only an internal account id goes in metadata; the email is needed for Stripe receipts and the portal.
  const customer = await stripe.customers.create(
    { email: email ?? undefined, metadata: { app_account: profileId } },
    { idempotencyKey: `gathering-customer-${profileId}` },
  );
  const r = await server.ingest<{ customer_id: string }>("customer_link", { profile_id: profileId, customer_id: customer.id, livemode: false });
  return r.customer_id;
}

/**
 * Creates (or reuses, for a repeated submission of the same form) a Stripe
 * Checkout Session and returns its URL. Amount, currency, fund, and
 * frequency are validated in the database against the giving settings and
 * active funds before Stripe is called.
 */
export async function createCheckout(server: GivingServer, req: CheckoutRequest): Promise<string> {
  const limit = await server.ingest<{ allowed: boolean }>("rate_limit", {
    key: req.profileId ? `checkout:profile:${req.profileId}` : ipKey(server, req.clientIp),
    limit: req.profileId ? 20 : 10,
    window_seconds: 900,
  });
  if (!limit.allowed) throw new CheckoutError("Too many checkout attempts. Please wait a few minutes and try again.");

  const prep = await server.ingest<{
    intent_id: string;
    status: string;
    session_id: string | null;
    checkout_url: string | null;
    session_expires_at: string | null;
    fund_id: string;
    fund_name: string;
    product_id: string | null;
    amount_cents: number;
    frequency: Frequency;
    customer_id: string | null;
    profile_email: string | null;
  }>("checkout_prepare", {
    idempotency_key: req.formToken,
    profile_id: req.profileId,
    fund_id: req.fundId,
    amount_cents: req.amountCents,
    frequency: req.frequency,
  });

  if (prep.status !== "open") throw new CheckoutError("This gift form has already been used. Please start a new gift.");
  if (prep.checkout_url && (!prep.session_expires_at || new Date(prep.session_expires_at).getTime() > Date.now() + 60_000)) {
    return prep.checkout_url;
  }

  const product = await ensureFundProduct(server, prep.fund_id, prep.fund_name, prep.product_id);
  const customer = req.profileId ? await ensureCustomer(server, req.profileId, prep.profile_email, prep.customer_id) : null;
  const recurring = prep.frequency !== "one_time";
  const metadata = { gift_intent_id: prep.intent_id };

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: recurring ? "subscription" : "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: prep.amount_cents,
          product,
          ...(recurring ? { recurring: { interval: prep.frequency === "weekly" ? "week" : "month" } } : {}),
        },
      },
    ],
    client_reference_id: prep.intent_id,
    metadata,
    ...(customer ? { customer } : {}),
    ...(recurring
      ? { subscription_data: { metadata } }
      : { submit_type: "donate", payment_intent_data: { metadata } }),
    // Return URLs come only from trusted configuration, never from the request.
    success_url: `${server.siteUrl}/give/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${server.siteUrl}/give?canceled=1`,
  };

  const session = await stripeClient(server).checkout.sessions.create(params, { idempotencyKey: `gathering-checkout-${prep.intent_id}` });
  if (!session.url) throw new CheckoutError("Checkout couldn't be started. Please try again.");
  const attached = await server.ingest<{ checkout_url: string | null }>("checkout_attach", {
    intent_id: prep.intent_id,
    session_id: session.id,
    checkout_url: session.url,
    expires_at: session.expires_at,
  });
  return attached.checkout_url ?? session.url;
}

// ---------------------------------------------------------------------------
// Member recurring-gift management (ownership verified in the database)
// ---------------------------------------------------------------------------
type OwnedCommitment = {
  commitment_id?: string;
  subscription_id: string;
  item_id: string | null;
  customer_id: string | null;
  product_id: string | null;
  fund_id: string;
  frequency: Frequency;
  status: string;
  amount_cents: number;
};

async function ownedCommitment(server: GivingServer, profileId: string, commitmentId: string): Promise<OwnedCommitment> {
  const c = await server.ingest<Partial<OwnedCommitment>>("owner_commitment", { profile_id: profileId, commitment_id: commitmentId });
  if (!c.subscription_id) throw new CheckoutError("That recurring gift wasn't found.");
  return c as OwnedCommitment;
}

/** Changes the amount of future gifts only (no proration, past payments untouched). */
export async function changeRecurringAmount(server: GivingServer, profileId: string, commitmentId: string, amountCents: number, token: string) {
  const c = await ownedCommitment(server, profileId, commitmentId);
  if (!["active", "trialing", "past_due"].includes(c.status)) throw new CheckoutError("Only active recurring gifts can be changed.");
  if (!c.item_id) throw new CheckoutError("This recurring gift can't be changed right now. Please try again later.");
  const limit = await server.ingest<{ allowed: boolean }>("rate_limit", { key: `amount:${profileId}`, limit: 10, window_seconds: 3600 });
  if (!limit.allowed) throw new CheckoutError("Too many changes. Please try again later.");
  const product = c.product_id ?? (await ensureFundProduct(server, c.fund_id, "Recurring gift", null));
  await stripeClient(server).subscriptions.update(
    c.subscription_id,
    {
      items: [
        {
          id: c.item_id,
          price_data: { currency: "usd", product, unit_amount: amountCents, recurring: { interval: c.frequency === "weekly" ? "week" : "month" } },
        },
      ],
      proration_behavior: "none",
    },
    { idempotencyKey: `gathering-amount-${commitmentId}-${token}` },
  );
  await syncSubscription(server, c.subscription_id);
}

/** Cancels immediately: no further gifts are charged; past gifts are unaffected. */
export async function cancelRecurring(server: GivingServer, profileId: string, commitmentId: string) {
  const c = await ownedCommitment(server, profileId, commitmentId);
  if (c.status === "canceled") return;
  await stripeClient(server).subscriptions.cancel(c.subscription_id, {}, { idempotencyKey: `gathering-cancel-${commitmentId}` });
  await syncSubscription(server, c.subscription_id);
  await deliverEmails(server).catch(() => undefined);
}

/** Stripe customer portal session for updating the payment method. */
export async function paymentMethodPortal(server: GivingServer, profileId: string, commitmentId: string): Promise<string> {
  const c = await ownedCommitment(server, profileId, commitmentId);
  if (!c.customer_id) throw new CheckoutError("Payment details aren't available for this gift.");
  const session = await stripeClient(server).billingPortal.sessions.create({
    customer: c.customer_id,
    return_url: `${server.siteUrl}/giving`,
    flow_data: { type: "payment_method_update" },
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Finance: refunds and reconciliation (capability checked by the caller and again in the database)
// ---------------------------------------------------------------------------
export async function issueRefund(
  server: GivingServer,
  check: { payment_intent_id: string | null; charge_id: string | null },
  amountCents: number,
  token: string,
  paymentId: string,
  actorId: string,
) {
  const stripe = stripeClient(server);
  const refund = await stripe.refunds.create(
    {
      ...(check.payment_intent_id ? { payment_intent: check.payment_intent_id } : { charge: check.charge_id! }),
      amount: amountCents,
      reason: "requested_by_customer",
    },
    { idempotencyKey: `gathering-refund-${paymentId}-${token}` },
  );
  // Stripe has accepted the refund. If recording it here fails, the
  // refund.created webhook (or Reconcile) records it, so don't report failure.
  await syncRefund(server, refund.id, actorId).catch((err) =>
    console.error("[giving] refund recorded later", { error: (err as { type?: string })?.type ?? (err as Error)?.name }),
  );
  await deliverEmails(server).catch(() => undefined);
  return refund.status;
}

export type ReconcileReport = {
  sessions: number;
  invoices: number;
  refunds: number;
  disputes: number;
  fees: number;
  created: number;
  changed: number;
  errors: number;
  emails: { sent: number; failed: number; suppressed: number };
};

/**
 * Re-reads Stripe objects created in a date range and applies them through
 * the same idempotent operations as the webhook. Safe to run repeatedly:
 * existing records are only updated, and emails are deduplicated.
 */
export async function reconcile(server: GivingServer, from: Date, to: Date): Promise<ReconcileReport> {
  const stripe = stripeClient(server);
  const created = { gte: Math.floor(from.getTime() / 1000), lt: Math.floor(to.getTime() / 1000) };
  const report: ReconcileReport = { sessions: 0, invoices: 0, refunds: 0, disputes: 0, fees: 0, created: 0, changed: 0, errors: 0, emails: { sent: 0, failed: 0, suppressed: 0 } };
  const tally = (r: { created?: boolean; changed?: boolean }) => {
    if (r.created) report.created += 1;
    else if (r.changed) report.changed += 1;
  };
  const guard = async (fn: () => Promise<{ created?: boolean; changed?: boolean }>) => {
    try {
      tally(await fn());
    } catch {
      report.errors += 1;
    }
  };

  for await (const s of stripe.checkout.sessions.list({ created, limit: 100 })) {
    if (!s.metadata?.gift_intent_id) continue;
    report.sessions += 1;
    await guard(() => syncCheckoutSession(server, s.id));
  }
  for await (const inv of stripe.invoices.list({ created, limit: 100 })) {
    if (inv.parent?.type !== "subscription_details") continue;
    report.invoices += 1;
    await guard(() => syncInvoice(server, inv.id));
  }
  for await (const r of stripe.refunds.list({ created, limit: 100 })) {
    report.refunds += 1;
    await guard(() => syncRefund(server, r.id));
  }
  for await (const d of stripe.disputes.list({ created, limit: 100 })) {
    report.disputes += 1;
    await guard(() => syncDispute(server, d.id));
  }
  const pending = await server.ingest<Array<{ charge_id: string | null }>>("pending_fees", { limit: 100 });
  for (const p of pending) {
    if (!p.charge_id) continue;
    report.fees += 1;
    await guard(() => syncCharge(server, p.charge_id!));
  }
  report.emails = await deliverEmails(server, { limit: 50 }).catch(() => report.emails);
  return report;
}
