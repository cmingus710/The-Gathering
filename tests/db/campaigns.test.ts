import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createIngest, signIngest, type Ingest } from "@/lib/giving/ingest";
import { handleEvent, type Mailer, type MinimalEvent, type ProcessorDeps } from "@/lib/giving/processor";
import { TEST_DATABASE_URL, TestDb, anon, as } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 13 fundraising campaigns against a real database: the real processor
 * and ingest RPC with an in-memory stand-in for the Stripe API (same shape as
 * tests/db/giving.test.ts). All donors, emails, and amounts are synthetic.
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

type PublicCampaign = {
  id: string;
  title: string;
  goal_cents: number;
  raised_cents: number;
  percent: number;
  goal_reached: boolean;
  status: string;
  accepting_gifts: boolean;
  fund_id: string;
  fund_name: string;
};
type AdminCampaign = PublicCampaign & {
  gross_cents: number;
  refunded_cents: number;
  disputed_open_cents: number;
  disputed_lost_cents: number;
  gift_count: number;
  by_source: Array<{ source: string; gross_cents: number; raised_cents: number; count: number }>;
  history: Array<{ action: string }>;
};

describeDb("giving campaigns: attribution, progress, visibility, access", () => {
  let db: TestDb;
  let ingest: Ingest;
  let stripe: FakeStripe;
  let deps: ProcessorDeps;
  let superAdmin: string;
  let financeAdmin: string;
  let financeViewer: string;
  let member: string;
  let pending: string;
  let funds: Record<string, string>;
  let seq = 0;
  const nid = (p: string) => `${p}_camp${++seq}`;
  const now = () => Math.floor(Date.now() / 1000);
  const mailer: Mailer = { from: "test@example.test", send: async () => ({ ok: true, id: "msg" }) };

  const event = (type: string, objectId: string): MinimalEvent => ({ id: nid("evt"), type, livemode: false, created: now(), data: { object: { id: objectId } } });

  async function prepare(opts: { profile?: string | null; fund?: string; cents?: number; frequency?: string; campaign?: string | null; key?: string }) {
    return ingest<{ intent_id: string; campaign_id: string | null }>("checkout_prepare", {
      idempotency_key: opts.key ?? `key-${nid("k")}-padding`,
      profile_id: opts.profile ?? null,
      fund_id: opts.fund ?? funds.Missions,
      amount_cents: opts.cents ?? 2500,
      frequency: opts.frequency ?? "one_time",
      ...(opts.campaign !== undefined ? { campaign_id: opts.campaign } : {}),
    });
  }

  function oneTime(intentId: string, cents: number, opts: { fail?: boolean } = {}) {
    const ch = stripe.put({ id: nid("ch"), object: "charge", status: opts.fail ? "failed" : "succeeded", created: now(), amount_refunded: 0, disputed: false,
      payment_intent: null as string | null, balance_transaction: null, billing_details: { name: null, email: null } });
    const pi = stripe.put({ id: nid("pi"), object: "payment_intent", status: opts.fail ? "requires_payment_method" : "succeeded", amount: cents,
      amount_received: opts.fail ? 0 : cents, latest_charge: ch.id, metadata: { gift_intent_id: intentId },
      last_payment_error: opts.fail ? { code: "card_declined" } : null, livemode: false });
    ch.payment_intent = pi.id;
    const s = stripe.put({ id: nid("cs"), object: "checkout.session", mode: "payment", status: opts.fail ? "open" : "complete", payment_status: opts.fail ? "unpaid" : "paid",
      metadata: { gift_intent_id: intentId }, client_reference_id: intentId, payment_intent: pi.id, subscription: null, customer: null,
      customer_details: { name: "Campaign Donor", email: "campaign.donor@example.test" }, livemode: false });
    return { s, pi, ch };
  }

  function subscription(intentId: string, cents: number) {
    const sub = stripe.put({ id: nid("sub"), object: "subscription", status: "active", customer: nid("cus"), cancel_at_period_end: false,
      canceled_at: null, ended_at: null, livemode: false, metadata: { gift_intent_id: intentId },
      items: { data: [{ id: nid("si"), quantity: 1, current_period_end: now() + 30 * 86400, price: { unit_amount: cents, recurring: { interval: "month" } } }] } });
    const s = stripe.put({ id: nid("cs"), object: "checkout.session", mode: "subscription", status: "complete", payment_status: "paid",
      metadata: { gift_intent_id: intentId }, client_reference_id: intentId, payment_intent: null, subscription: sub.id, customer: sub.customer,
      customer_details: { name: "Recurring Donor", email: "recurring.donor@example.test" }, livemode: false });
    return { sub, s };
  }

  function invoice(subId: string, cents: number, opts: { fail?: boolean } = {}) {
    const ch = stripe.put({ id: nid("ch"), object: "charge", status: opts.fail ? "failed" : "succeeded", created: now(), amount_refunded: 0, disputed: false,
      payment_intent: null as string | null, balance_transaction: null, billing_details: {} });
    const pi = stripe.put({ id: nid("pi"), object: "payment_intent", status: opts.fail ? "requires_payment_method" : "succeeded", amount: cents, amount_received: opts.fail ? 0 : cents,
      latest_charge: ch.id, metadata: {}, last_payment_error: opts.fail ? { code: "card_declined" } : null, livemode: false });
    ch.payment_intent = pi.id;
    const ip = stripe.put({ id: nid("inpay"), object: "invoice_payment", status: opts.fail ? "open" : "paid", is_default: true, payment: { type: "payment_intent", payment_intent: pi.id } });
    const inv = stripe.put({ id: nid("in"), object: "invoice", status: opts.fail ? "open" : "paid", amount_paid: opts.fail ? 0 : cents, amount_due: cents,
      livemode: false, hosted_invoice_url: "https://invoice.stripe.example/pay", status_transitions: { paid_at: opts.fail ? null : now() },
      parent: { type: "subscription_details", subscription_details: { subscription: subId, metadata: {} } }, payment_ids: [ip.id] });
    return { inv, pi, ch };
  }

  /** A one-time campaign gift taken all the way to a succeeded payment. */
  async function give(campaign: string, cents: number, fund = funds.Missions, profile: string | null = null) {
    const { intent_id } = await prepare({ campaign, cents, fund, profile });
    const g = oneTime(intent_id, cents);
    expect(await handleEvent(deps, event("checkout.session.completed", g.s.id))).toBe("processed");
    return g;
  }

  async function save(actor: string, p: Partial<{ id: string | null; title: string; goal: number; fund: string; visibility: string; starts: string | null; ends: string | null; description: string | null }>) {
    const [{ id }] = await db.query<{ id: string }>(
      as(actor),
      "select public.finance_campaign_save($1, $2, $3, $4, $5, $6, $7, $8, null, null) id",
      [p.id ?? null, p.title ?? "Roof repair", p.description ?? "Help us fix the roof.", p.goal ?? 500000, p.starts ?? null, p.ends ?? null, p.fund ?? funds.Missions, p.visibility ?? "public"],
    );
    return id;
  }
  const setStatus = (id: string, status: string, actor = financeAdmin) => db.query(as(actor), "select public.finance_campaign_status($1, $2)", [id, status]);
  async function campaign(id: string, actor = financeAdmin): Promise<AdminCampaign> {
    const [{ c }] = await db.query<{ c: AdminCampaign }>(as(actor), "select public.finance_campaign($1) c", [id]);
    return c;
  }
  const raised = async (id: string) => Number((await campaign(id)).raised_cents);
  async function publicList(actor = anon) {
    const [{ c }] = await db.query<{ c: PublicCampaign[] }>(actor, "select public.giving_campaigns() c");
    return c;
  }

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await db.createAuthUser("super@example.test", { fullName: "Synthetic Super" });
    await db.raw("select public.bootstrap_super_admin('super@example.test')");
    financeAdmin = await db.createAuthUser("finance@example.test", { fullName: "Synthetic Finance" });
    financeViewer = await db.createAuthUser("viewer@example.test", { fullName: "Synthetic Viewer" });
    member = await db.createAuthUser("member@example.test", { fullName: "Synthetic Member" });
    pending = await db.createAuthUser("pending@example.test", { fullName: "Pending Person" });
    for (const id of [financeAdmin, financeViewer, member]) await db.setStatus(id, "approved");
    await db.query(as(superAdmin), "select public.admin_grant_role($1, 'finance_admin')", [financeAdmin]);
    await db.query(as(superAdmin), "select public.admin_grant_role($1, 'finance_viewer')", [financeViewer]);
    await db.raw("insert into giving.secrets (name, value) values ('ingest', $1)", [SECRET]);

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
    deps = { stripe: stripe as unknown as ProcessorDeps["stripe"], ingest, mailer, siteUrl: "https://app.example.test", emailAllowlist: [] };
    funds = Object.fromEntries((await db.raw<{ id: string; name: string }>("select id, name from giving.funds")).map((f) => [f.name, f.id]));
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("authorization", () => {
    it("lets only finance managers create and change campaigns", async () => {
      await expect(save(member, {})).rejects.toThrow(/permission/);
      await expect(save(financeViewer, {})).rejects.toThrow(/permission/);
      // Super administrators don't get finance.* implicitly.
      await expect(save(superAdmin, {})).rejects.toThrow(/permission/);
      await expect(db.query(as(superAdmin), "select public.finance_campaigns()")).rejects.toThrow(/permission/);
      await expect(db.query(anon, "select public.finance_campaigns()")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.finance_campaign_save(null, 'x', null, 1000, null, null, $1, 'public', null, null)", [funds.Missions])).rejects.toThrow(/permission denied/);

      const id = await save(financeAdmin, { title: "Authorization check" });
      await expect(setStatus(id, "published", financeViewer)).rejects.toThrow(/permission/);
      await expect(setStatus(id, "published", member)).rejects.toThrow(/permission/);
      await expect(setStatus(id, "published", superAdmin)).rejects.toThrow(/permission/);
      // Viewers can read the admin view; they just can't change it.
      expect((await campaign(id, financeViewer)).title).toBe("Authorization check");
      await expect(db.query(as(member), "select public.finance_campaign($1)", [id])).rejects.toThrow(/permission/);
      await expect(db.query(as(member), "select public.finance_record_campaign_gift(gen_random_uuid(), $1, null, null, current_date, 100, 'cash', null, null)", [id])).rejects.toThrow(/permission/);
      await expect(db.query(as(financeViewer), "select public.finance_record_campaign_gift(gen_random_uuid(), $1, null, null, current_date, 100, 'cash', null, null)", [id])).rejects.toThrow(/permission/);
    });

    it("keeps the API roles away from the campaigns table", async () => {
      for (const actor of [anon, as(member), as(financeAdmin)]) {
        await expect(db.query(actor, "select * from giving.campaigns")).rejects.toThrow(/permission denied/);
      }
    });
  });

  describe("lifecycle", () => {
    it("enforces status transitions and audits each change", async () => {
      const id = await save(financeAdmin, { title: "Lifecycle" });
      await expect(setStatus(id, "closed")).rejects.toThrow(/can't be moved/);
      await setStatus(id, "published");
      await expect(setStatus(id, "draft")).rejects.toThrow(/can't be moved/);
      await expect(setStatus(id, "archived")).rejects.toThrow(/can't be moved/);
      // The fund is fixed once published.
      await expect(save(financeAdmin, { id, title: "Lifecycle", fund: funds.Youth })).rejects.toThrow(/fund can't be changed/);
      await save(financeAdmin, { id, title: "Lifecycle renamed" });
      await setStatus(id, "closed");
      await setStatus(id, "published");
      await setStatus(id, "closed");
      await setStatus(id, "archived");
      await expect(save(financeAdmin, { id, title: "Edited while archived" })).rejects.toThrow(/Archived/);
      await setStatus(id, "closed");
      const c = await campaign(id);
      expect(c.title).toBe("Lifecycle renamed");
      expect(c.history.map((h) => h.action)).toEqual([
        "finance.campaign_created", "finance.campaign_status", "finance.campaign_updated", "finance.campaign_status",
        "finance.campaign_status", "finance.campaign_status", "finance.campaign_status", "finance.campaign_status",
      ]);
      const audit = await db.raw<{ details: Record<string, unknown> }>(
        "select details from public.audit_log where target_type = 'campaign' and target_id = $1 and action = 'finance.campaign_updated'", [id]);
      expect(audit[0].details).toEqual({ fields: ["title"] });
    });

    it("validates goal, dates, and fund", async () => {
      await expect(save(financeAdmin, { goal: 50 })).rejects.toThrow(/goal/);
      await expect(save(financeAdmin, { starts: "2026-12-10", ends: "2026-12-01" })).rejects.toThrow(/end date/);
      await expect(save(financeAdmin, { fund: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/fund/);
      const past = await save(financeAdmin, { title: "Ended", starts: "2020-01-01", ends: "2020-02-01" });
      await expect(setStatus(past, "published")).rejects.toThrow(/end date has passed/);
    });
  });

  describe("visibility and privacy", () => {
    let publicId: string;
    let membersId: string;
    let draftId: string;
    let archivedId: string;

    beforeAll(async () => {
      publicId = await save(financeAdmin, { title: "Public campaign", visibility: "public" });
      membersId = await save(financeAdmin, { title: "Members campaign", visibility: "members" });
      draftId = await save(financeAdmin, { title: "Draft campaign", visibility: "public" });
      archivedId = await save(financeAdmin, { title: "Archived campaign", visibility: "public" });
      await setStatus(publicId, "published");
      await setStatus(membersId, "published");
      await setStatus(archivedId, "archived");
      await give(publicId, 1234);
      await give(membersId, 4321, funds.Missions, member);
    });

    it("shows anon only public, published (or closed) campaigns", async () => {
      const titles = (await publicList()).map((c) => c.title);
      expect(titles).toContain("Public campaign");
      expect(titles).not.toContain("Members campaign");
      expect(titles).not.toContain("Draft campaign");
      expect(titles).not.toContain("Archived campaign");
      const one = async (actor: typeof anon, id: string) => (await db.query<{ c: PublicCampaign | null }>(actor, "select public.giving_campaign($1) c", [id]))[0].c;
      expect(await one(anon, publicId)).toMatchObject({ title: "Public campaign", raised_cents: 1234 });
      expect(await one(anon, membersId)).toBeNull();
      expect(await one(anon, draftId)).toBeNull();
      expect(await one(as(member), draftId)).toBeNull();
      expect(await one(as(member), archivedId)).toBeNull();
      // Pending (not yet approved) accounts are treated like guests.
      expect(await one(as(pending), membersId)).toBeNull();
      expect(await one(as(member), membersId)).toMatchObject({ title: "Members campaign", raised_cents: 4321 });
      expect((await publicList(as(member))).map((c) => c.title)).toEqual(expect.arrayContaining(["Public campaign", "Members campaign"]));
    });

    it("returns aggregates only: no donors, counts, or individual payments", async () => {
      const [c] = (await publicList()).filter((x) => x.id === publicId);
      expect(Object.keys(c).sort()).toEqual([
        "accepting_gifts", "description", "ends_on", "fund_id", "fund_name", "goal_cents", "goal_reached", "id", "image_alt", "image_path",
        "percent", "raised_cents", "starts_on", "status", "title", "visibility",
      ]);
      const text = JSON.stringify(await publicList(as(member)));
      expect(text).not.toMatch(/campaign\.donor|Campaign Donor|example\.test|profile|payment|gift_count|count|donor|email/i);
    });

    it("refuses members-only campaigns to guests at checkout", async () => {
      await expect(prepare({ campaign: membersId })).rejects.toThrow(/isn't accepting gifts/);
      await expect(prepare({ campaign: membersId, profile: pending })).rejects.toThrow(/isn't accepting gifts/);
      expect((await prepare({ campaign: membersId, profile: member })).campaign_id).toBe(membersId);
    });

    it("serves campaign images only while the campaign is visible", async () => {
      await db.raw("update giving.campaigns set image_path = 'campaigns/abc.webp' where id = $1", [membersId]);
      await db.raw("update giving.campaigns set image_path = 'campaigns/draft.webp' where id = $1", [draftId]);
      const can = async (actor: typeof anon, name: string) => (await db.query<{ ok: boolean }>(actor, "select public.can_view_campaign_image($1) ok", [name]))[0].ok;
      expect(await can(anon, "campaigns/abc.webp")).toBe(false);
      expect(await can(as(member), "campaigns/abc.webp")).toBe(true);
      expect(await can(as(member), "campaigns/draft.webp")).toBe(false);
      expect(await can(as(financeViewer), "campaigns/draft.webp")).toBe(true);
    });
  });

  describe("checkout attribution", () => {
    it("accepts only published, open campaigns with a matching fund", async () => {
      const draft = await save(financeAdmin, { title: "Not yet" });
      await expect(prepare({ campaign: draft })).rejects.toThrow(/isn't accepting gifts/);
      await expect(prepare({ campaign: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/isn't accepting gifts/);
      const future = await save(financeAdmin, { title: "Starts later", starts: "2099-01-01" });
      await setStatus(future, "published");
      await expect(prepare({ campaign: future })).rejects.toThrow(/isn't accepting gifts/);
      const open = await save(financeAdmin, { title: "Open now" });
      await setStatus(open, "published");
      await expect(prepare({ campaign: open, fund: funds.Youth })).rejects.toThrow(/own fund/);
      const key = `same-campaign-form-${nid("k")}`;
      const a = await prepare({ campaign: open, key });
      expect(a.campaign_id).toBe(open);
      expect((await prepare({ campaign: open, key })).intent_id).toBe(a.intent_id);
      // The same form token can't be reused to move the gift in or out of a campaign.
      await expect(prepare({ key })).rejects.toThrow(/already submitted/);
      await setStatus(open, "closed");
      await expect(prepare({ campaign: open })).rejects.toThrow(/isn't accepting gifts/);
      // Gifts without a campaign are unchanged.
      expect((await prepare({})).campaign_id).toBeNull();
    });
  });

  describe("progress", () => {
    let id: string;

    beforeAll(async () => {
      id = await save(financeAdmin, { title: "Progress", goal: 30000 });
      await setStatus(id, "published");
    });

    it("counts succeeded payments once, however often events are delivered", async () => {
      const { intent_id } = await prepare({ campaign: id, cents: 10000 });
      const g = oneTime(intent_id, 10000);
      const completed = event("checkout.session.completed", g.s.id);
      expect(await handleEvent(deps, completed)).toBe("processed");
      expect(await handleEvent(deps, completed)).toBe("duplicate");
      // Different events about the same payment, delivered twice each.
      for (let i = 0; i < 2; i++) {
        await handleEvent(deps, event("payment_intent.succeeded", g.pi.id));
        await handleEvent(deps, event("charge.succeeded", g.ch.id));
        await handleEvent(deps, event("checkout.session.completed", g.s.id));
      }
      const rows = await db.raw("select campaign_id from giving.payments where stripe_payment_intent_id = $1", [g.pi.id]);
      expect(rows).toEqual([{ campaign_id: id }]);
      expect(await raised(id)).toBe(10000);
    });

    it("counts concurrent ingest of the same payment once", async () => {
      const { intent_id } = await prepare({ campaign: id, cents: 2000 });
      const g = oneTime(intent_id, 2000);
      const payload = JSON.stringify({ intent_id, payment_intent_id: g.pi.id, pi_status: "succeeded", amount_cents: 2000, charge_id: g.ch.id, livemode: false });
      const clients: Client[] = [await db.connect(), await db.connect(), await db.connect()];
      try {
        await Promise.all(clients.map((c) => {
          const ts = now();
          return c.query("select public.giving_ingest('sync_payment', $1, $2, $3)", [payload, ts, signIngest(SECRET, "sync_payment", ts, payload)]);
        }));
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
      expect(await db.raw("select 1 from giving.payments where stripe_payment_intent_id = $1", [g.pi.id])).toHaveLength(1);
      expect(await raised(id)).toBe(12000);
    });

    it("excludes failed, pending, and canceled payments", async () => {
      const { intent_id } = await prepare({ campaign: id, cents: 7000 });
      const failed = oneTime(intent_id, 7000, { fail: true });
      await handleEvent(deps, event("payment_intent.payment_failed", failed.pi.id));
      const [row] = await db.raw("select status, campaign_id from giving.payments where stripe_payment_intent_id = $1", [failed.pi.id]);
      expect(row).toEqual({ status: "failed", campaign_id: id });
      const { intent_id: i2 } = await prepare({ campaign: id, cents: 900 });
      const processing = oneTime(i2, 900);
      stripe.put({ ...stripe.get(processing.pi.id), status: "processing", amount_received: 0 });
      await handleEvent(deps, event("payment_intent.processing", processing.pi.id));
      expect((await db.raw("select status from giving.payments where stripe_payment_intent_id = $1", [processing.pi.id]))[0].status).toBe("pending");
      expect(await raised(id)).toBe(12000);
      expect((await campaign(id)).gift_count).toBe(2);
    });

    it("subtracts partial and full refunds, interleaved with duplicate events", async () => {
      const a = await give(id, 5000);
      const b = await give(id, 3000);
      expect(await raised(id)).toBe(20000);
      const r1 = stripe.put({ id: nid("re"), object: "refund", charge: a.ch.id, payment_intent: null, amount: 2000, status: "pending", reason: null, created: now() });
      await handleEvent(deps, event("refund.created", r1.id));
      expect(await raised(id)).toBe(20000); // pending refunds don't count yet
      stripe.put({ ...stripe.get(r1.id), status: "succeeded" });
      const updated = event("refund.updated", r1.id);
      await handleEvent(deps, updated);
      await handleEvent(deps, updated);
      await handleEvent(deps, event("charge.refunded", a.ch.id));
      expect(await raised(id)).toBe(18000);
      const r2 = stripe.put({ id: nid("re"), object: "refund", charge: b.ch.id, payment_intent: null, amount: 3000, status: "succeeded", reason: null, created: now() });
      await handleEvent(deps, event("refund.created", r2.id));
      await handleEvent(deps, event("charge.refunded", b.ch.id));
      await handleEvent(deps, event("refund.created", r2.id));
      const c = await campaign(id);
      expect(Number(c.raised_cents)).toBe(15000);
      expect(Number(c.refunded_cents)).toBe(5000);
      expect(Number(c.gross_cents)).toBe(20000);
    });

    it("excludes open disputes, subtracts lost ones, and restores won ones", async () => {
      const lost = await give(id, 4000);
      const won = await give(id, 6000);
      expect(await raised(id)).toBe(25000);
      const d1 = stripe.put({ id: nid("dp"), object: "dispute", charge: lost.ch.id, payment_intent: null, amount: 4000, status: "needs_response", reason: "fraudulent", created: now() });
      const d2 = stripe.put({ id: nid("dp"), object: "dispute", charge: won.ch.id, payment_intent: null, amount: 6000, status: "warning_needs_response", reason: "general", created: now() });
      await handleEvent(deps, event("charge.dispute.created", d1.id));
      await handleEvent(deps, event("charge.dispute.created", d2.id));
      let c = await campaign(id);
      expect(Number(c.raised_cents)).toBe(15000);
      expect(Number(c.disputed_open_cents)).toBe(10000);

      stripe.put({ ...stripe.get(d1.id), status: "lost" });
      stripe.put({ ...stripe.get(d2.id), status: "under_review" });
      const closed = event("charge.dispute.closed", d1.id);
      await handleEvent(deps, closed);
      await handleEvent(deps, event("charge.dispute.updated", d2.id));
      await handleEvent(deps, closed);
      c = await campaign(id);
      expect(Number(c.raised_cents)).toBe(15000);
      expect(Number(c.disputed_lost_cents)).toBe(4000);
      expect(Number(c.disputed_open_cents)).toBe(6000);

      stripe.put({ ...stripe.get(d2.id), status: "won" });
      await handleEvent(deps, event("charge.dispute.closed", d2.id));
      await handleEvent(deps, event("charge.dispute.closed", d2.id));
      c = await campaign(id);
      expect(Number(c.raised_cents)).toBe(21000);
      expect(Number(c.disputed_open_cents)).toBe(0);
      expect(c.percent).toBe(70);
      expect(c.goal_reached).toBe(false);
    });

    it("keeps test and live rows strictly apart", async () => {
      const before = await raised(id);
      await db.raw(
        `insert into giving.payments (source, status, fund_id, fund_name, amount_cents, stripe_payment_intent_id, received_at, livemode, campaign_id)
         values ('stripe', 'succeeded', $1, 'Missions', 99999, $2, now(), true, $3)`,
        [funds.Missions, nid("pi_live"), id],
      );
      expect(await raised(id)).toBe(before);
      const [pub] = (await publicList()).filter((c) => c.id === id);
      expect(pub.raised_cents).toBe(before);
      // The per-mode function itself sees the live row only when asked for live.
      const [live] = await db.raw<{ raised_cents: string }>("select raised_cents from giving.campaign_totals($1, true)", [id]);
      expect(Number(live.raised_cents)).toBe(99999);
      // And live checkout events are still ignored outright.
      expect(await handleEvent(deps, { ...event("payment_intent.succeeded", "pi_live_x"), livemode: true })).toBe("live_mode_ignored");
    });

    it("shows the goal as reached without closing the campaign", async () => {
      await give(id, 9000);
      const [pub] = (await publicList()).filter((c) => c.id === id);
      expect(pub).toMatchObject({ raised_cents: 30000, percent: 100, goal_reached: true, accepting_gifts: true, status: "published" });
      await give(id, 1000);
      const [over] = (await publicList()).filter((c) => c.id === id);
      expect(over).toMatchObject({ raised_cents: 31000, percent: 100 });
    });
  });

  describe("recurring gifts", () => {
    it("counts paid installments only, never the commitment or future installments", async () => {
      const id = await save(financeAdmin, { title: "Recurring", goal: 100000 });
      await setStatus(id, "published");
      const { intent_id } = await prepare({ campaign: id, cents: 4000, frequency: "monthly", profile: member });
      const monthly = subscription(intent_id, 4000);
      await handleEvent(deps, event("checkout.session.completed", monthly.s.id));
      const [commitment] = await db.raw<{ id: string; campaign_id: string }>("select id, campaign_id from giving.commitments where stripe_subscription_id = $1", [monthly.sub.id]);
      expect(commitment.campaign_id).toBe(id);
      expect(await raised(id)).toBe(0);

      const first = invoice(monthly.sub.id as string, 4000);
      await handleEvent(deps, event("invoice.paid", first.inv.id));
      await handleEvent(deps, event("invoice.paid", first.inv.id));
      expect(await raised(id)).toBe(4000);
      const failed = invoice(monthly.sub.id as string, 4000, { fail: true });
      await handleEvent(deps, event("invoice.payment_failed", failed.inv.id));
      expect(await raised(id)).toBe(4000);
      const second = invoice(monthly.sub.id as string, 4000);
      await handleEvent(deps, event("invoice.paid", second.inv.id));
      expect(await raised(id)).toBe(8000);

      // After the campaign closes, later installments still go to the fund but not the campaign.
      await setStatus(id, "closed");
      const third = invoice(monthly.sub.id as string, 4000);
      await handleEvent(deps, event("invoice.paid", third.inv.id));
      const [p3] = await db.raw("select status, fund_id, campaign_id from giving.payments where stripe_invoice_id = $1", [third.inv.id]);
      expect(p3).toEqual({ status: "succeeded", fund_id: funds.Missions, campaign_id: null });
      expect(await raised(id)).toBe(8000);
      // A closed campaign stays visible with its final total but takes no gifts.
      const [pub] = (await publicList()).filter((c) => c.id === id);
      expect(pub).toMatchObject({ status: "closed", accepting_gifts: false, raised_cents: 8000 });
    });
  });

  describe("offline gifts and attribution rules", () => {
    let id: string;

    beforeAll(async () => {
      id = await save(financeAdmin, { title: "Offline", goal: 100000, fund: funds.Benevolence });
      await setStatus(id, "published");
    });

    const record = (token: string, cents: number, method = "check", campaignId = id) =>
      db.query<{ r: { payment_id: string; duplicate: boolean } }>(
        as(financeAdmin),
        "select public.finance_record_campaign_gift($1, $2, null, 'Envelope donor', current_date - 1, $3, $4, $5, null) r",
        [token, campaignId, cents, method, method === "check" ? "1001" : null],
      );

    it("records cash and check gifts once and breaks them out by source", async () => {
      const token = "11111111-1111-4111-8111-111111111111";
      const [{ r }] = await record(token, 2500, "check");
      const [{ r: again }] = await record(token, 2500, "check");
      expect(again).toEqual({ payment_id: r.payment_id, duplicate: true });
      await record("22222222-2222-4222-8222-222222222222", 1500, "cash");
      await give(id, 1000, funds.Benevolence);
      const c = await campaign(id);
      expect(Number(c.raised_cents)).toBe(5000);
      expect(c.by_source.map((s) => [s.source, Number(s.raised_cents), Number(s.count)])).toEqual([["stripe", 1000, 1], ["cash", 1500, 1], ["check", 2500, 1]]);
      const [p] = await db.raw("select fund_id, campaign_id, source from giving.payments where id = $1", [r.payment_id]);
      expect(p).toEqual({ fund_id: funds.Benevolence, campaign_id: id, source: "check" });
      const audit = await db.raw("select action from public.audit_log where target_id = $1", [r.payment_id]);
      expect(audit.map((a) => a.action)).toEqual(["finance.manual_recorded"]);
    });

    it("drops reversed gifts and keeps the campaign on corrections", async () => {
      const [{ r }] = await record("33333333-3333-4333-8333-333333333333", 4000, "cash");
      expect(await raised(id)).toBe(9000);
      await db.query(as(financeAdmin), "select public.finance_reverse_payment($1, 'Entered twice')", [r.payment_id]);
      expect(await raised(id)).toBe(5000);

      const [{ r: orig }] = await record("44444444-4444-4444-8444-444444444444", 1000, "cash");
      const [{ c }] = await db.query<{ c: { payment_id: string } }>(
        as(financeAdmin),
        "select public.finance_correct_manual($1, '55555555-5555-4555-8555-555555555555', null, 'Envelope donor', current_date - 1, 1200, $2, 'cash', null, null, 'Miscounted') c",
        [orig.payment_id, funds.Benevolence],
      );
      const [replacement] = await db.raw("select campaign_id, amount_cents from giving.payments where id = $1", [c.payment_id]);
      expect(replacement).toEqual({ campaign_id: id, amount_cents: 1200 });
      expect(await raised(id)).toBe(6200);
      // A correction can't move a campaign gift to another fund.
      await expect(db.query(
        as(financeAdmin),
        "select public.finance_correct_manual($1, '66666666-6666-4666-8666-666666666666', null, null, current_date - 1, 1200, $2, 'cash', null, null, 'Wrong fund')",
        [c.payment_id, funds.Youth],
      )).rejects.toThrow(/campaign's fund/);
    });

    it("refuses offline gifts for drafts and archived campaigns", async () => {
      const draft = await save(financeAdmin, { title: "Offline draft" });
      await expect(record("77777777-7777-4777-8777-777777777777", 100, "cash", draft)).rejects.toThrow(/published or closed/);
    });

    it("never backfills and never moves attribution", async () => {
      // A gift made to the fund before/without a campaign stays unattributed.
      const { intent_id } = await prepare({ fund: funds.Benevolence, cents: 3300 });
      const g = oneTime(intent_id, 3300);
      await handleEvent(deps, event("checkout.session.completed", g.s.id));
      const [plain] = await db.raw<{ id: string; campaign_id: string | null }>("select id, campaign_id from giving.payments where stripe_payment_intent_id = $1", [g.pi.id]);
      expect(plain.campaign_id).toBeNull();
      await expect(db.raw("update giving.payments set campaign_id = $2 where id = $1", [plain.id, id])).rejects.toThrow(/can't be changed/);
      await expect(db.raw("update giving.intents set campaign_id = $2 where id = $1", [intent_id, id])).rejects.toThrow(/can't be changed/);

      const [attributed] = await db.raw<{ id: string }>("select id from giving.payments where campaign_id = $1 limit 1", [id]);
      await expect(db.raw("update giving.payments set campaign_id = null where id = $1", [attributed.id])).rejects.toThrow(/can't be changed/);
      // Renaming the campaign doesn't affect attribution or totals.
      const before = await raised(id);
      await save(financeAdmin, { id, title: "Offline (renamed)", goal: 100000, fund: funds.Benevolence });
      expect(await raised(id)).toBe(before);
      // Other updates to an attributed payment still work (e.g. donor linking).
      await db.query(as(financeAdmin), "select public.finance_associate_donor($1, $2)", [attributed.id, member]);
    });
  });
});
