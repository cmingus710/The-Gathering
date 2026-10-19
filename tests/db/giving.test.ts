import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIngest, signIngest, type Ingest } from "@/lib/giving/ingest";
import { deliverEmails, handleEvent, syncInvoice, type Mailer, type MinimalEvent, type ProcessorDeps } from "@/lib/giving/processor";
import { TEST_DATABASE_URL, TestDb, anon, as } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 3 giving, end to end against a real database: the real processor and
 * ingest RPC, with an in-memory stand-in for the Stripe API. All donors,
 * emails, and amounts are synthetic.
 */
const SECRET = "test-ingest-secret-0123456789abcdef0123456789";

type Obj = Record<string, unknown> & { id: string };

class FakeStripe {
  objects = new Map<string, Obj>();
  put<T extends Obj>(o: T): T {
    this.objects.set(o.id, o);
    return o;
  }
  get(id: string): Obj {
    const o = this.objects.get(id);
    if (!o) throw Object.assign(new Error("No such object"), { type: "StripeInvalidRequestError", code: "resource_missing" });
    return structuredClone(o);
  }
  private expandCharge(c: Obj | null) {
    if (!c) return null;
    const bt = c.balance_transaction as string | null;
    return { ...c, balance_transaction: bt ? this.get(bt) : null };
  }
  checkout = { sessions: { retrieve: async (id: string) => this.get(id) } };
  paymentIntents = {
    retrieve: async (id: string) => {
      const pi = this.get(id);
      const ch = pi.latest_charge ? this.expandCharge(this.get(pi.latest_charge as string)) : null;
      return { ...pi, latest_charge: ch };
    },
  };
  subscriptions = { retrieve: async (id: string) => this.get(id) };
  invoices = {
    retrieve: async (id: string) => {
      const inv = this.get(id);
      return { ...inv, payments: { data: ((inv.payment_ids as string[]) ?? []).map((p) => this.get(p)) } };
    },
  };
  charges = { retrieve: async (id: string) => this.expandCharge(this.get(id)) };
  refunds = {
    retrieve: async (id: string) => this.get(id),
    list: async ({ charge }: { charge?: string }) => ({ data: [...this.objects.values()].filter((o) => o.object === "refund" && o.charge === charge) }),
  };
  disputes = {
    retrieve: async (id: string) => this.get(id),
    list: async ({ charge }: { charge?: string }) => ({ data: [...this.objects.values()].filter((o) => o.object === "dispute" && o.charge === charge) }),
  };
  balanceTransactions = { retrieve: async (id: string) => this.get(id) };
}

describeDb("giving: payments, recurring gifts, refunds, finance access", () => {
  let db: TestDb;
  let ingest: Ingest;
  let stripe: FakeStripe;
  let deps: ProcessorDeps;
  const sent: Array<{ to: string; subject: string; idempotencyKey: string; text: string }> = [];
  let mailerFails = 0;
  let superAdmin: string;
  let financeAdmin: string;
  let memberAdmin: string;
  let editor: string;
  let member: string;
  let other: string;
  let funds: Record<string, string>;
  let seq = 0;
  const nid = (p: string) => `${p}_test${++seq}`;
  const now = () => Math.floor(Date.now() / 1000);

  const mailer: Mailer = {
    from: "test@example.test",
    async send(m) {
      if (mailerFails > 0) {
        mailerFails -= 1;
        return { ok: false, error: "simulated_outage" };
      }
      sent.push(m);
      return { ok: true, id: `msg_${sent.length}` };
    },
  };

  const event = (type: string, objectId: string, livemode = false): MinimalEvent => ({
    id: nid("evt"),
    type,
    livemode,
    created: now(),
    data: { object: { id: objectId } },
  });

  async function prepare(opts: { profile?: string | null; fund?: string; cents?: number; frequency?: string; key?: string }) {
    return ingest<{ intent_id: string }>("checkout_prepare", {
      idempotency_key: opts.key ?? `key-${nid("k")}-padding`,
      profile_id: opts.profile ?? null,
      fund_id: opts.fund ?? funds["General Offering"],
      amount_cents: opts.cents ?? 2500,
      frequency: opts.frequency ?? "one_time",
    });
  }

  /** A completed one-time Checkout in the fake Stripe. */
  function oneTime(intentId: string, cents: number, opts: { piStatus?: string; payment_status?: string; fee?: number | null; email?: string } = {}) {
    const bt = opts.fee === null ? null : stripe.put({ id: nid("txn"), object: "balance_transaction", currency: "usd", fee: opts.fee ?? 103, net: cents - (opts.fee ?? 103) });
    const ch = stripe.put({ id: nid("ch"), object: "charge", status: "succeeded", created: now(), amount_refunded: 0, disputed: false,
      payment_intent: null as string | null, balance_transaction: bt?.id ?? null, billing_details: { name: null, email: null } });
    const pi = stripe.put({ id: nid("pi"), object: "payment_intent", status: opts.piStatus ?? "succeeded", amount: cents, amount_received: opts.piStatus && opts.piStatus !== "succeeded" ? 0 : cents,
      latest_charge: ch.id, metadata: { gift_intent_id: intentId }, last_payment_error: null as unknown, livemode: false });
    ch.payment_intent = pi.id;
    const s = stripe.put({ id: nid("cs"), object: "checkout.session", mode: "payment", status: "complete", payment_status: opts.payment_status ?? "paid",
      metadata: { gift_intent_id: intentId }, client_reference_id: intentId, payment_intent: pi.id, subscription: null, customer: null,
      customer_details: { name: "Guest Donor", email: opts.email ?? "guest.donor@example.test" }, livemode: false });
    return { s, pi, ch };
  }

  function subscription(intentId: string, cents: number, interval: "week" | "month", opts: { email?: string } = {}) {
    const sub = stripe.put({ id: nid("sub"), object: "subscription", status: "active", customer: nid("cus"), cancel_at_period_end: false,
      canceled_at: null, ended_at: null, livemode: false, metadata: { gift_intent_id: intentId },
      items: { data: [{ id: nid("si"), quantity: 1, current_period_end: now() + 7 * 86400, price: { unit_amount: cents, recurring: { interval } } }] } });
    const s = stripe.put({ id: nid("cs"), object: "checkout.session", mode: "subscription", status: "complete", payment_status: "paid",
      metadata: { gift_intent_id: intentId }, client_reference_id: intentId, payment_intent: null, subscription: sub.id, customer: sub.customer,
      customer_details: { name: "Recurring Guest", email: opts.email ?? "recurring.guest@example.test" }, livemode: false });
    return { sub, s };
  }

  function invoice(subId: string, cents: number, opts: { status?: string; fail?: boolean } = {}) {
    const bt = stripe.put({ id: nid("txn"), object: "balance_transaction", currency: "usd", fee: 59, net: cents - 59 });
    const ch = stripe.put({ id: nid("ch"), object: "charge", status: opts.fail ? "failed" : "succeeded", created: now(), amount_refunded: 0, disputed: false,
      payment_intent: null as string | null, balance_transaction: opts.fail ? null : bt.id, billing_details: {} });
    const pi = stripe.put({ id: nid("pi"), object: "payment_intent", status: opts.fail ? "requires_payment_method" : "succeeded", amount: cents, amount_received: opts.fail ? 0 : cents,
      latest_charge: ch.id, metadata: {}, last_payment_error: opts.fail ? { code: "card_declined", decline_code: "insufficient_funds" } : null, livemode: false });
    ch.payment_intent = pi.id;
    const ip = stripe.put({ id: nid("inpay"), object: "invoice_payment", status: opts.fail ? "open" : "paid", is_default: true, payment: { type: "payment_intent", payment_intent: pi.id } });
    const inv = stripe.put({ id: nid("in"), object: "invoice", status: opts.status ?? (opts.fail ? "open" : "paid"), amount_paid: opts.fail ? 0 : cents, amount_due: cents,
      livemode: false, hosted_invoice_url: "https://invoice.stripe.example/pay", status_transitions: { paid_at: opts.fail ? null : now() },
      parent: { type: "subscription_details", subscription_details: { subscription: subId, metadata: {} } }, payment_ids: [ip.id] });
    return { inv, pi, ch };
  }

  const payments = (where = "true", params: unknown[] = []) => db.raw<Record<string, unknown>>(`select * from giving.payments where ${where} order by created_at`, params);
  const outbox = (where = "true", params: unknown[] = []) => db.raw<Record<string, unknown>>(`select * from giving.email_outbox where ${where} order by created_at`, params);

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await db.createAuthUser("super@example.test", { fullName: "Synthetic Super" });
    await db.raw("select public.bootstrap_super_admin('super@example.test')");
    financeAdmin = await db.createAuthUser("finance@example.test", { fullName: "Synthetic Finance" });
    memberAdmin = await db.createAuthUser("membership@example.test", { fullName: "Synthetic Membership" });
    editor = await db.createAuthUser("editor@example.test", { fullName: "Synthetic Editor" });
    member = await db.createAuthUser("member@example.test", { fullName: "Synthetic Member" });
    other = await db.createAuthUser("other@example.test", { fullName: "Other Member" });
    for (const id of [financeAdmin, memberAdmin, editor, member, other]) await db.setStatus(id, "approved");
    await db.grantRole(memberAdmin, "membership_admin");
    await db.grantRole(editor, "content_editor");
    await db.query(as(superAdmin), "select public.admin_grant_role($1, 'finance_admin')", [financeAdmin]);

    stripe = new FakeStripe();
    ingest = createIngest(SECRET, async (args) => {
      try {
        const [row] = await db.query<{ r: unknown }>(anon, "select public.giving_ingest($1, $2, $3, $4) r", [args.p_op, args.p_payload, args.p_ts, args.p_sig]);
        return { data: row.r, error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, code: err.code } };
      }
    });
    deps = { stripe: stripe as unknown as ProcessorDeps["stripe"], ingest, mailer, siteUrl: "https://app.example.test", emailAllowlist: ["member@example.test", "guest.donor@example.test", "recurring.guest@example.test"] };
    funds = Object.fromEntries((await db.raw<{ id: string; name: string }>("select id, name from giving.funds")).map((f) => [f.name, f.id]));
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
    mailerFails = 0;
  });

  describe("ingest path and isolation", () => {
    it("refuses ingest calls until the database secret is configured", async () => {
      await expect(prepare({})).rejects.toThrow(/not configured/);
      await db.raw("insert into giving.secrets (name, value) values ('ingest', $1)", [SECRET]);
    });

    it("refuses unsigned, mis-signed, and stale requests", async () => {
      const body = JSON.stringify({ key: "x", limit: 1, window_seconds: 60 });
      const ts = now();
      await expect(db.query(anon, "select public.giving_ingest('rate_limit', $1, $2, 'bad')", [body, ts])).rejects.toThrow(/Invalid signature/);
      const wrong = signIngest("another-secret-that-is-long-enough-000000", "rate_limit", ts, body);
      await expect(db.query(anon, "select public.giving_ingest('rate_limit', $1, $2, $3)", [body, ts, wrong])).rejects.toThrow(/Invalid signature/);
      const stale = ts - 3600;
      await expect(
        db.query(anon, "select public.giving_ingest('rate_limit', $1, $2, $3)", [body, stale, signIngest(SECRET, "rate_limit", stale, body)]),
      ).rejects.toThrow(/expired/);
      // A signature for one operation can't be reused for another.
      await expect(
        db.query(anon, "select public.giving_ingest('checkout_status', $1, $2, $3)", [body, ts, signIngest(SECRET, "rate_limit", ts, body)]),
      ).rejects.toThrow(/Invalid signature/);
    });

    it("gives the API roles no access to giving tables", async () => {
      for (const actor of [anon, as(member), as(financeAdmin)]) {
        await expect(db.query(actor, "select * from giving.payments")).rejects.toThrow(/permission denied/);
        await expect(db.query(actor, "select * from giving.secrets")).rejects.toThrow(/permission denied/);
      }
    });

    it("publishes only active funds and limits", async () => {
      const [{ c }] = await db.query<{ c: { funds: Array<{ name: string }>; min_amount_cents: number } }>(anon, "select public.giving_public_config() c");
      expect(c.funds.map((f) => f.name)).toEqual(["General Offering", "Missions", "Youth", "Benevolence"]);
      expect(c.min_amount_cents).toBe(100);
      expect(JSON.stringify(c)).not.toMatch(/"amount_cents"|payment|donor/);
    });

    it("rate-limits by key", async () => {
      const results = [];
      for (let i = 0; i < 4; i++) results.push((await ingest<{ allowed: boolean }>("rate_limit", { key: "checkout:ip:test", limit: 3, window_seconds: 600 })).allowed);
      expect(results).toEqual([true, true, true, false]);
    });
  });

  describe("checkout preparation", () => {
    it("validates amount and fund, and is idempotent per form", async () => {
      await expect(prepare({ cents: 50 })).rejects.toThrow(/between/);
      await expect(prepare({ cents: 1_000_001 })).rejects.toThrow(/between/);
      await expect(prepare({ fund: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/not available/);
      const key = "same-form-token-0123456789";
      const a = await prepare({ key, cents: 3000 });
      const b = await prepare({ key, cents: 3000 });
      expect(b.intent_id).toBe(a.intent_id);
      await expect(prepare({ key, cents: 4000 })).rejects.toThrow(/already submitted/);
    });
  });

  describe("one-time gifts", () => {
    it("records a gift only from provider-confirmed state, once", async () => {
      const { intent_id } = await prepare({ profile: member, cents: 5000 });
      const { s, pi } = oneTime(intent_id, 5000, { email: "member@example.test" });
      await ingest("checkout_attach", { intent_id, session_id: s.id, checkout_url: "https://checkout.example/x" });

      // The browser reaching the thank-you page proves nothing yet.
      expect(await ingest("checkout_status", { session_id: s.id })).toMatchObject({ state: "processing", amount_cents: 5000 });

      const e = event("checkout.session.completed", s.id);
      expect(await handleEvent(deps, e)).toBe("processed");
      expect(await handleEvent(deps, e)).toBe("duplicate");
      expect(await handleEvent(deps, event("payment_intent.succeeded", pi.id))).toBe("processed");

      const rows = await payments("stripe_payment_intent_id = $1", [pi.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "succeeded", amount_cents: 5000, profile_id: member, fee_cents: 103, net_cents: 4897, fee_status: "known" });
      expect(await ingest("checkout_status", { session_id: s.id })).toMatchObject({ state: "confirmed" });
      expect((await outbox("payment_id = $1", [rows[0].id])).map((o) => o.kind)).toEqual(["acknowledgment"]);
      expect(sent.filter((m) => m.to === "member@example.test")).toHaveLength(1);
      expect(sent[0].subject).toBe("[TEST] Thank you for your gift");
    });

    it("handles delayed confirmation", async () => {
      const { intent_id } = await prepare({ cents: 7000 });
      const { s, pi } = oneTime(intent_id, 7000, { piStatus: "processing", payment_status: "unpaid" });
      await handleEvent(deps, event("checkout.session.completed", s.id));
      expect((await payments("stripe_payment_intent_id = $1", [pi.id]))[0]).toMatchObject({ status: "pending", received_at: null });
      expect(await outbox("payment_id in (select id from giving.payments where stripe_payment_intent_id = $1)", [pi.id])).toHaveLength(0);

      stripe.put({ ...stripe.get(pi.id), status: "succeeded", amount_received: 7000 });
      stripe.put({ ...stripe.get(s.id), payment_status: "paid" });
      await handleEvent(deps, event("checkout.session.async_payment_succeeded", s.id));
      await handleEvent(deps, event("payment_intent.succeeded", pi.id));
      const [p] = await payments("stripe_payment_intent_id = $1", [pi.id]);
      expect(p.status).toBe("succeeded");
      expect(await outbox("payment_id = $1", [p.id])).toHaveLength(1);
    });

    it("records a failed payment and never acknowledges it", async () => {
      const { intent_id } = await prepare({ cents: 1500 });
      const { s, pi } = oneTime(intent_id, 1500, { piStatus: "requires_payment_method", payment_status: "unpaid" });
      stripe.put({ ...stripe.get(pi.id), last_payment_error: { code: "card_declined" } });
      await handleEvent(deps, event("checkout.session.async_payment_failed", s.id));
      const [p] = await payments("stripe_payment_intent_id = $1", [pi.id]);
      expect(p).toMatchObject({ status: "failed", failure_code: "card_declined" });
      expect(await outbox("payment_id = $1", [p.id])).toHaveLength(0);
      expect(await ingest("checkout_status", { session_id: s.id })).toMatchObject({ state: "failed" });
    });

    it("marks abandoned checkouts expired without creating a gift", async () => {
      const { intent_id } = await prepare({ cents: 1200 });
      const s = stripe.put({ id: nid("cs"), object: "checkout.session", mode: "payment", status: "expired", payment_status: "unpaid",
        metadata: { gift_intent_id: intent_id }, payment_intent: null, livemode: false, customer_details: null });
      await ingest("checkout_attach", { intent_id, session_id: s.id, checkout_url: "https://checkout.example/y" });
      await handleEvent(deps, event("checkout.session.expired", s.id));
      expect((await db.raw("select status from giving.intents where id = $1", [intent_id]))[0].status).toBe("expired");
      expect(await payments("intent_id = $1", [intent_id])).toHaveLength(0);
      expect(await ingest("checkout_status", { session_id: s.id })).toMatchObject({ state: "expired" });
    });

    it("tolerates out-of-order delivery (charge before checkout)", async () => {
      const { intent_id } = await prepare({ cents: 2200 });
      const { s, pi, ch } = oneTime(intent_id, 2200);
      await handleEvent(deps, event("charge.succeeded", ch.id));
      await handleEvent(deps, event("checkout.session.completed", s.id));
      const rows = await payments("intent_id = $1", [intent_id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].stripe_payment_intent_id).toBe(pi.id);
      expect(await outbox("payment_id = $1", [rows[0].id])).toHaveLength(1);
    });

    it("shows fees as pending until Stripe reports them", async () => {
      const { intent_id } = await prepare({ cents: 10000 });
      const { s, ch } = oneTime(intent_id, 10000, { fee: null });
      await handleEvent(deps, event("checkout.session.completed", s.id));
      const [p] = await payments("intent_id = $1", [intent_id]);
      expect(p).toMatchObject({ fee_status: "pending", fee_cents: null, net_cents: null });
      const bt = stripe.put({ id: nid("txn"), object: "balance_transaction", currency: "usd", fee: 320, net: 9680 });
      stripe.put({ ...stripe.get(ch.id), balance_transaction: bt.id });
      await handleEvent(deps, event("charge.updated", ch.id));
      expect((await payments("id = $1", [p.id]))[0]).toMatchObject({ fee_status: "known", fee_cents: 320, net_cents: 9680 });
    });

    it("ignores live-mode events in this phase", async () => {
      expect(await handleEvent(deps, event("checkout.session.completed", "cs_live_whatever", true))).toBe("live_mode_ignored");
    });
  });

  describe("recurring gifts", () => {
    let monthly: { sub: Obj; s: Obj };
    let commitmentId: string;

    it("creates a commitment separate from its payments, then records renewals", async () => {
      const { intent_id } = await prepare({ profile: member, cents: 4000, frequency: "monthly", fund: funds.Missions });
      monthly = subscription(intent_id, 4000, "month", { email: "member@example.test" });
      // The first invoice arrives before the checkout event (out of order).
      const first = invoice(monthly.sub.id as string, 4000);
      await handleEvent(deps, event("invoice.paid", first.inv.id));
      await handleEvent(deps, event("checkout.session.completed", monthly.s.id));
      await handleEvent(deps, event("customer.subscription.created", monthly.sub.id));

      const [c] = await db.raw<{ id: string; status: string; amount_cents: number; frequency: string; profile_id: string }>(
        "select * from giving.commitments where stripe_subscription_id = $1", [monthly.sub.id]);
      commitmentId = c.id;
      expect(c).toMatchObject({ status: "active", amount_cents: 4000, frequency: "monthly", profile_id: member });
      const renewal = invoice(monthly.sub.id as string, 4000);
      await handleEvent(deps, event("invoice.paid", renewal.inv.id));
      await handleEvent(deps, event("invoice.paid", renewal.inv.id));
      const rows = await payments("commitment_id = $1", [c.id]);
      expect(rows.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
      expect(rows.every((r) => r.fund_name === "Missions" && r.fee_cents === 59)).toBe(true);
      expect(await outbox("commitment_id = $1 and kind = 'acknowledgment'", [c.id])).toHaveLength(2);
    });

    it("notifies once about a failed renewal, then recovers", async () => {
      const failed = invoice(monthly.sub.id as string, 4000, { fail: true });
      await handleEvent(deps, event("invoice.payment_failed", failed.inv.id));
      await handleEvent(deps, event("invoice.payment_failed", failed.inv.id));
      const [p] = await payments("stripe_invoice_id = $1", [failed.inv.id]);
      expect(p).toMatchObject({ status: "failed", failure_code: "insufficient_funds" });
      const notices = await outbox("dedupe_key = $1", [`failed:${failed.inv.id}`]);
      expect(notices).toHaveLength(1);
      expect(sent.find((m) => m.subject.includes("couldn't process"))?.text).toContain("/giving");

      stripe.put({ ...stripe.get(failed.inv.id), status: "paid", amount_paid: 4000, status_transitions: { paid_at: now() } });
      stripe.put({ ...stripe.get(failed.pi.id), status: "succeeded", amount_received: 4000, last_payment_error: null });
      await handleEvent(deps, event("invoice.paid", failed.inv.id));
      expect((await payments("id = $1", [p.id]))[0].status).toBe("succeeded");
    });

    it("changes the amount for future gifts without rewriting history", async () => {
      await db.raw("update giving.funds set name = 'Global Missions' where id = $1", [funds.Missions]);
      const sub = stripe.get(monthly.sub.id as string) as Obj & { items: { data: Array<{ price: { unit_amount: number } }> } };
      sub.items.data[0].price.unit_amount = 6500;
      stripe.put(sub);
      await handleEvent(deps, event("customer.subscription.updated", sub.id));
      const [c] = await db.raw("select amount_cents, fund_name from giving.commitments where id = $1", [commitmentId]);
      expect(c).toMatchObject({ amount_cents: 6500, fund_name: "Missions" });
      const rows = await payments("commitment_id = $1", [commitmentId]);
      expect(rows.every((r) => r.amount_cents === 4000 && r.fund_name === "Missions")).toBe(true);
      const next = invoice(monthly.sub.id as string, 6500);
      await handleEvent(deps, event("invoice.paid", next.inv.id));
      expect((await payments("stripe_invoice_id = $1", [next.inv.id]))[0]).toMatchObject({ amount_cents: 6500, fund_name: "Global Missions" });
      await db.raw("update giving.funds set name = 'Missions' where id = $1", [funds.Missions]);
    });

    it("cancels with one confirmation email", async () => {
      stripe.put({ ...stripe.get(monthly.sub.id as string), status: "canceled", canceled_at: now(), ended_at: now() });
      const e = event("customer.subscription.deleted", monthly.sub.id as string);
      await handleEvent(deps, e);
      await handleEvent(deps, event("customer.subscription.deleted", monthly.sub.id as string));
      const [c] = await db.raw("select status, next_payment_at from giving.commitments where id = $1", [commitmentId]);
      expect(c.status).toBe("canceled");
      expect(await outbox("commitment_id = $1 and kind = 'cancellation'", [commitmentId])).toHaveLength(1);
      const [{ g }] = await db.query<{ g: { commitments: Array<{ next_payment_at: string | null }> } }>(as(member), "select public.my_giving() g");
      expect(g.commitments.find((x) => x.next_payment_at)).toBeUndefined();
    });

    it("supports weekly guest gifts with a claim reference in the acknowledgment", async () => {
      const { intent_id } = await prepare({ cents: 1000, frequency: "weekly", fund: funds.Youth });
      const weekly = subscription(intent_id, 1000, "week", { email: "recurring.guest@example.test" });
      await handleEvent(deps, event("checkout.session.completed", weekly.s.id));
      const paid = invoice(weekly.sub.id as string, 1000);
      await handleEvent(deps, event("invoice.paid", paid.inv.id));
      const [c] = await db.raw("select frequency, profile_id, donor_email from giving.commitments where stripe_subscription_id = $1", [weekly.sub.id]);
      expect(c).toMatchObject({ frequency: "weekly", profile_id: null, donor_email: "recurring.guest@example.test" });
      const ack = sent.find((m) => m.to === "recurring.guest@example.test");
      expect(ack?.text).toMatch(/Gift reference: [0-9A-F]{5}-[0-9A-F]{5}/);
    });
  });

  describe("refunds and disputes", () => {
    let paymentId: string;
    let chargeId: string;

    beforeAll(async () => {
      const { intent_id } = await prepare({ profile: member, cents: 10000, fund: funds.Benevolence });
      const { s, ch } = oneTime(intent_id, 10000);
      chargeId = ch.id;
      await handleEvent(deps, event("checkout.session.completed", s.id));
      [{ id: paymentId }] = await db.raw<{ id: string }>("select id from giving.payments where intent_id = $1", [intent_id]);
    });

    it("records partial and full refunds, including ones made outside the app", async () => {
      const r1 = stripe.put({ id: nid("re"), object: "refund", charge: chargeId, payment_intent: null, amount: 2500, status: "succeeded", reason: "requested_by_customer", created: now() });
      stripe.put({ ...stripe.get(chargeId), amount_refunded: 2500 });
      await handleEvent(deps, event("charge.refunded", chargeId));
      await handleEvent(deps, event("refund.created", r1.id));
      let refunds = await db.raw("select amount_cents, status from giving.refunds where payment_id = $1", [paymentId]);
      expect(refunds).toEqual([{ amount_cents: 2500, status: "succeeded" }]);

      const r2 = stripe.put({ id: nid("re"), object: "refund", charge: chargeId, payment_intent: null, amount: 7500, status: "succeeded", reason: null, created: now() });
      await handleEvent(deps, event("refund.created", r2.id));
      refunds = await db.raw("select amount_cents from giving.refunds where payment_id = $1 order by amount_cents", [paymentId]);
      expect(refunds.map((r) => r.amount_cents)).toEqual([2500, 7500]);
      expect(await outbox("payment_id = $1 and kind = 'refund'", [paymentId])).toHaveLength(2);
      // The original payment and its fee are untouched.
      expect((await payments("id = $1", [paymentId]))[0]).toMatchObject({ status: "succeeded", amount_cents: 10000, fee_cents: 103 });
    });

    it("tracks disputes and their outcome", async () => {
      const d = stripe.put({ id: nid("dp"), object: "dispute", charge: chargeId, payment_intent: null, amount: 10000, status: "needs_response", reason: "fraudulent", created: now() });
      await handleEvent(deps, event("charge.dispute.created", d.id));
      stripe.put({ ...stripe.get(d.id), status: "lost" });
      await handleEvent(deps, event("charge.dispute.closed", d.id));
      const [row] = await db.raw("select status, closed_at is not null closed from giving.disputes where stripe_dispute_id = $1", [d.id]);
      expect(row).toEqual({ status: "lost", closed: true });
    });
  });

  describe("email delivery", () => {
    it("retries failed sends without duplicating acknowledgments, and suppresses non-test recipients", async () => {
      mailerFails = 1;
      const { intent_id } = await prepare({ profile: member, cents: 1800 });
      const { s } = oneTime(intent_id, 1800);
      await handleEvent(deps, event("checkout.session.completed", s.id));
      const [p] = await payments("intent_id = $1", [intent_id]);
      let [o] = await outbox("payment_id = $1", [p.id]);
      expect(o).toMatchObject({ status: "failed", attempts: 1 });
      await deliverEmails(deps);
      await deliverEmails(deps);
      [o] = await outbox("payment_id = $1", [p.id]);
      expect(o).toMatchObject({ status: "sent", attempts: 2 });
      expect(sent.filter((m) => m.idempotencyKey === `giving-ack:${p.id}`)).toHaveLength(1);

      const { intent_id: i2 } = await prepare({ cents: 1900 });
      const g = oneTime(i2, 1900, { email: "someone.real@example.org" });
      await handleEvent(deps, event("checkout.session.completed", g.s.id));
      const [p2] = await payments("intent_id = $1", [i2]);
      expect((await outbox("payment_id = $1", [p2.id]))[0].status).toBe("suppressed");
      expect(sent.find((m) => m.to === "someone.real@example.org")).toBeUndefined();
    });
  });

  describe("member records and guest claims", () => {
    it("shows members only their own gifts, without finance internals", async () => {
      const [{ g }] = await db.query<{ g: { payments: Array<Record<string, unknown>> } }>(as(member), "select public.my_giving() g");
      expect(g.payments.length).toBeGreaterThan(0);
      expect(Object.keys(g.payments[0])).not.toContain("fee_cents");
      expect(Object.keys(g.payments[0])).not.toContain("donor_email");
      const [{ g: og }] = await db.query<{ g: { payments: unknown[] } }>(as(other), "select public.my_giving() g");
      expect(og.payments).toHaveLength(0);
      const [{ id }] = await db.raw<{ id: string }>("select id from giving.payments where profile_id = $1 limit 1", [member]);
      expect((await db.query(as(other), "select public.my_giving_payment($1) p", [id]))[0].p).toBeNull();
      await expect(db.query(anon, "select public.my_giving()")).rejects.toThrow(/permission denied/);
    });

    it("never attaches guest gifts by email alone; requires the emailed reference", async () => {
      const guestEmail = "claimer@example.test";
      const claimer = await db.createAuthUser(guestEmail, { fullName: "Claiming Member" });
      const { intent_id } = await prepare({ cents: 2600 });
      const { s } = oneTime(intent_id, 2600, { email: guestEmail });
      await handleEvent(deps, event("checkout.session.completed", s.id));
      const [p] = await payments("intent_id = $1", [intent_id]);
      expect(p.profile_id).toBeNull();
      const [{ c: code }] = await db.raw<{ c: string }>("select giving.claim_code($1) c", [p.id]);

      expect(await ingest("claim_gift", { profile_id: claimer, code: "AAAAA-AAAAA" })).toEqual({ ok: false });
      // The right reference doesn't work for a different account.
      expect(await ingest("claim_gift", { profile_id: other, code })).toEqual({ ok: false });
      expect(await ingest("claim_gift", { profile_id: claimer, code: code.toLowerCase() })).toMatchObject({ ok: true });
      expect((await payments("id = $1", [p.id]))[0].profile_id).toBe(claimer);
    });

    it("rate-limits claim attempts", async () => {
      for (let i = 0; i < 4; i++) expect(await ingest("claim_gift", { profile_id: other, code: "BBBBB-BBBBB" })).toEqual({ ok: false });
      await expect(ingest("claim_gift", { profile_id: other, code: "BBBBB-BBBBB" })).rejects.toThrow(/Too many attempts/);
    });
  });

  describe("finance access", () => {
    const summary = (actor: string) => db.query(as(actor), "select public.finance_summary(now() - interval '1 day', now() + interval '1 day') s");

    it("requires an explicit finance role, even for super admins", async () => {
      for (const actor of [member, editor, memberAdmin, superAdmin]) {
        await expect(summary(actor)).rejects.toThrow(/permission/);
        await expect(db.query(as(actor), "select public.finance_contributions('{}'::jsonb)")).rejects.toThrow(/permission/);
      }
      const [{ s }] = await summary(financeAdmin);
      expect(Number((s as { gross_cents: number }).gross_cents)).toBeGreaterThan(0);
      const [{ c }] = await db.query<{ c: string[] }>(as(superAdmin), "select array(select public.my_capabilities()) c");
      expect(c.some((x) => x.startsWith("finance."))).toBe(false);
    });

    it("lets a super admin assign finance roles (audited), and revocation applies immediately", async () => {
      const viewer = await db.createAuthUser("viewer@example.test");
      await db.setStatus(viewer, "approved");
      await db.query(as(superAdmin), "select public.admin_grant_role($1, 'finance_viewer')", [viewer]);
      await summary(viewer);
      await expect(db.query(as(viewer), "select public.finance_export('{}'::jsonb)")).rejects.toThrow(/permission/);
      await expect(
        db.query(as(viewer), "select public.finance_record_manual(gen_random_uuid(), null, null, current_date, 100, $1, 'cash', null, null)", [funds["General Offering"]]),
      ).rejects.toThrow(/permission/);
      await db.query(as(superAdmin), "select public.admin_revoke_role($1, 'finance_viewer')", [viewer]);
      await expect(summary(viewer)).rejects.toThrow(/permission/);
      const audit = await db.raw("select action from public.audit_log where target_id = $1 and action like 'role.%' order by id", [viewer]);
      expect(audit.map((a) => a.action)).toEqual(["role.granted", "role.revoked"]);
      // Suspension also removes finance access.
      await db.setStatus(financeAdmin, "suspended");
      await expect(summary(financeAdmin)).rejects.toThrow(/permission/);
      await db.setStatus(financeAdmin, "approved");
    });

    it("records manual gifts once, corrects and reverses them with history", async () => {
      const token = "11111111-2222-3333-4444-555555555555";
      const rec = (cents: number) =>
        db.query<{ r: { payment_id: string; duplicate: boolean } }>(as(financeAdmin),
          "select public.finance_record_manual($1, null, 'Anonymous envelope', (now() at time zone 'America/Chicago')::date, $2, $3, 'check', '1042', 'Synthetic note') r",
          [token, cents, funds["General Offering"]]);
      const [{ r: first }] = await rec(5000);
      const [{ r: again }] = await rec(5000);
      expect(again).toEqual({ payment_id: first.payment_id, duplicate: true });

      const [{ r: corrected }] = await db.query<{ r: { payment_id: string } }>(as(financeAdmin),
        "select public.finance_correct_manual($1, gen_random_uuid(), $2, null, (now() at time zone 'America/Chicago')::date, 5500, $3, 'check', '1042', null, 'Amount misread') r",
        [first.payment_id, member, funds["General Offering"]]);
      const rows = await payments("id in ($1, $2)", [first.payment_id, corrected.payment_id]);
      expect(rows.find((r) => r.id === first.payment_id)).toMatchObject({ status: "reversed", amount_cents: 5000 });
      expect(rows.find((r) => r.id === corrected.payment_id)).toMatchObject({ status: "succeeded", amount_cents: 5500, replaces_payment_id: first.payment_id, profile_id: member });

      await expect(db.query(as(financeAdmin), "select public.finance_reverse_payment($1, 'x')", [first.payment_id])).rejects.toThrow(/already been reversed/);
      const audit = await db.raw("select action, details from public.audit_log where action like 'finance.manual%' order by id");
      expect(audit.map((a) => a.action)).toEqual(["finance.manual_recorded", "finance.manual_corrected", "finance.manual_recorded"]);
      expect(JSON.stringify(audit)).not.toMatch(/5000|5500|Synthetic note|Anonymous/);

      const [{ g }] = await db.query<{ g: { payments: Array<{ id: string; source: string }> } }>(as(member), "select public.my_giving() g");
      expect(g.payments.map((p) => p.id)).toContain(corrected.payment_id);
      expect(g.payments.map((p) => p.id)).not.toContain(first.payment_id);
    });

    it("refuses refunds without the refund capability or beyond the remaining balance", async () => {
      const [{ id }] = await db.raw<{ id: string }>("select id from giving.payments where source = 'stripe' and status = 'succeeded' and not exists (select 1 from giving.refunds r where r.payment_id = giving.payments.id) limit 1");
      await expect(db.query(as(memberAdmin), "select public.finance_refund_check($1, 100)", [id])).rejects.toThrow(/permission/);
      await expect(db.query(as(financeAdmin), "select public.finance_refund_check($1, 99999999)", [id])).rejects.toThrow(/remaining/);
      const [{ r }] = await db.query<{ r: { remaining_cents: number } }>(as(financeAdmin), "select public.finance_refund_check($1, 100) r", [id]);
      expect(r.remaining_cents).toBeGreaterThan(100);
    });

    it("summarises gross, refunds, fees, disputes, and net consistently", async () => {
      const [{ s }] = await summary(financeAdmin);
      const t = s as Record<string, number>;
      expect(Number(t.net_cents)).toBe(Number(t.gross_cents) - Number(t.fees_cents) - Number(t.refunded_cents) - Number(t.disputed_lost_cents));
      expect(Number(t.refunded_cents)).toBe(10000);
      expect(Number(t.disputed_lost_cents)).toBe(10000);
    });
  });

  describe("statements and reconciliation", () => {
    it("uses church-time-zone year boundaries and excludes unpaid commitments", async () => {
      const someone = await db.createAuthUser("statement@example.test", { fullName: "Statement Donor" });
      await db.setStatus(someone, "approved");
      // 05:30 UTC on Jan 1 2026 is still Dec 31 2025 in Chicago.
      await db.raw(
        `insert into giving.payments (source, status, profile_id, fund_id, fund_name, amount_cents, received_on, received_at, manual_token, fee_status, reversed_at)
         values ('cash', 'succeeded', $1, $2, 'General Offering', 1234, '2025-12-31', '2026-01-01T05:30:00Z', gen_random_uuid(), 'not_applicable', null),
                ('cash', 'succeeded', $1, $2, 'General Offering', 4321, '2026-01-01', '2026-01-01T18:00:00Z', gen_random_uuid(), 'not_applicable', null),
                ('cash', 'reversed', $1, $2, 'General Offering', 9999, '2025-06-01', '2025-06-01T18:00:00Z', gen_random_uuid(), 'not_applicable', now())`,
        [someone, funds["General Offering"]],
      );
      const stmt = async (year: number) => (await db.query<{ s: { gross_cents: number; items: unknown[]; approved: boolean } }>(as(someone), "select public.my_giving_statement($1) s", [year]))[0].s;
      expect(await stmt(2025)).toMatchObject({ gross_cents: 1234, approved: false });
      expect((await stmt(2025)).items).toHaveLength(1);
      expect(await stmt(2026)).toMatchObject({ gross_cents: 4321 });
      await expect(db.query(as(other), "select public.finance_statement_data($1, 2025)", [someone])).rejects.toThrow(/permission/);
    });

    it("repairs a missed renewal by re-reading Stripe, without duplicates", async () => {
      const { intent_id } = await prepare({ profile: member, cents: 3300, frequency: "monthly" });
      const sub = subscription(intent_id, 3300, "month");
      await handleEvent(deps, event("checkout.session.completed", sub.s.id));
      const missed = invoice(sub.sub.id as string, 3300);
      // No webhook arrived for this invoice; reconciliation syncs it directly.
      expect(await syncInvoice(deps, missed.inv.id)).toMatchObject({ created: true });
      expect(await syncInvoice(deps, missed.inv.id)).toMatchObject({ created: false, changed: false });
      expect(await payments("stripe_invoice_id = $1", [missed.inv.id])).toHaveLength(1);
    });
  });
});
