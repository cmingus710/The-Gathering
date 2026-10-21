import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import type { ClaimedApprovalAlert } from "@/lib/membership/alerts";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Membership approval alerts against a real database: when an alert is
 * queued (and when it isn't), one delivery per recipient, deduplication,
 * per-recipient retries, preview isolation, and who may see or change the
 * recipient list. Every person and address here is synthetic.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
type Json = Record<string, unknown>;

describeDb("membership approval alerts", () => {
  let db: TestDb;
  let settingsAdmin: string; // super administrator (settings.manage)
  let membershipAdmin: string; // members.view + members.manage, no settings.manage
  let member: string; // approved, no roles
  let waiting: string; // pending, verified before the feature was turned on

  const rpc = async <T = unknown>(actor: Actor, fn: string, args: unknown[] = []) => {
    const params = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<{ r: T }>(actor, `select public.${fn}(${params}) as r`, args);
    return rows[0].r;
  };

  const job = createCommunityJob(SECRET, async (a) => {
    try {
      const rows = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
      return { data: rows[0].r, error: null };
    } catch (err) {
      return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } };
    }
  });
  const claim = (test = false) => job<ClaimedApprovalAlert[]>("membership_alert_claim", { limit: 50, test });

  const deliveriesFor = (profile: string) =>
    db.raw<{ recipient_email: string; status: string; attempts: number; last_error: string | null }>(
      `select d.recipient_email, d.status, d.attempts, d.last_error from membership.alert_deliveries d
         join membership.approval_alerts a on a.id = d.alert_id where a.profile_id = $1 order by d.recipient_email`,
      [profile],
    );
  const alertFor = async (profile: string) =>
    (await db.raw<Json>("select * from membership.approval_alerts where profile_id = $1", [profile]))[0] ?? null;
  const verify = (id: string) => db.raw("update auth.users set email_confirmed_at = now() where id = $1", [id]);

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    settingsAdmin = await db.createAuthUser("settings-admin@example.test", { fullName: "Settings Admin" });
    membershipAdmin = await db.createAuthUser("membership-admin@example.test", { fullName: "Membership Admin" });
    member = await db.createAuthUser("member@example.test", { fullName: "Plain Member" });
    for (const id of [settingsAdmin, membershipAdmin, member]) await db.setStatus(id, "approved");
    await db.grantRole(settingsAdmin, "super_admin");
    await db.grantRole(membershipAdmin, "membership_admin");
    // Already waiting before anyone turned the alerts on.
    waiting = await db.createAuthUser("already-waiting@example.test", { fullName: "Already Waiting" });
  }, 120_000);
  afterAll(async () => db?.destroy());

  beforeEach(async () => {
    await db.raw("delete from membership.alert_recipients");
    await db.raw("update membership.alert_settings set enabled = false");
  });

  const configure = async (emails: string[], enabled = true) => {
    for (const e of emails) await rpc(as(settingsAdmin), "membership_alert_add_recipient", [e]);
    await rpc(as(settingsAdmin), "membership_alert_set_enabled", [enabled]);
  };

  describe("who can see and change the recipients", () => {
    it("lets a settings manager configure alerts, with validation", async () => {
      await configure(["First@Example.test", "second@example.test"]);
      const admin = await rpc<Json>(as(settingsAdmin), "membership_alert_admin");
      expect(admin.enabled).toBe(true);
      expect((admin.recipients as Json[]).map((r) => r.email)).toEqual(["first@example.test", "second@example.test"]);
      await expect(rpc(as(settingsAdmin), "membership_alert_add_recipient", ["FIRST@example.test"])).rejects.toThrow(/already on the list/);
      await expect(rpc(as(settingsAdmin), "membership_alert_add_recipient", ["a@example.test, b@example.test"])).rejects.toThrow(/one valid email/);
      await expect(rpc(as(settingsAdmin), "membership_alert_add_recipient", ["a@example.test;b@example.test"])).rejects.toThrow(/one valid email/);
      await expect(rpc(as(settingsAdmin), "membership_alert_add_recipient", ["not-an-address"])).rejects.toThrow(/one valid email/);
      const id = (admin.recipients as Json[])[0].id;
      await rpc(as(settingsAdmin), "membership_alert_remove_recipient", [id]);
      expect(((await rpc<Json>(as(settingsAdmin), "membership_alert_admin")).recipients as Json[]).map((r) => r.email)).toEqual(["second@example.test"]);
      const audit = await db.raw<{ action: string; details: Json }>("select action, details from public.audit_log where action like 'membership_alerts.%' order by id");
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["membership_alerts.recipient_added", "membership_alerts.recipient_removed", "membership_alerts.settings_changed"]));
      expect(JSON.stringify(audit)).not.toContain("example.test");
    });

    it("refuses everyone else, including membership administrators", async () => {
      await configure(["first@example.test"]);
      const pending = await db.createAuthUser("pending-probe@example.test");
      for (const actor of [anon, as(member), as(membershipAdmin), as(pending)]) {
        await expect(rpc(actor, "membership_alert_admin")).rejects.toThrow(/permission/);
        await expect(rpc(actor, "membership_alert_add_recipient", ["evil@example.test"])).rejects.toThrow(/permission/);
        await expect(rpc(actor, "membership_alert_set_enabled", [false])).rejects.toThrow(/permission/);
        await expect(db.query(actor, "select * from membership.alert_recipients")).rejects.toThrow(/permission denied/);
      }
      const [r] = await db.raw<{ id: string }>("select id from membership.alert_recipients");
      await expect(rpc(as(membershipAdmin), "membership_alert_remove_recipient", [r.id])).rejects.toThrow(/permission/);
      expect(await db.raw("select 1 from membership.alert_recipients")).toHaveLength(1);
      // The signed job can't be called without the secret.
      await expect(db.query(anon, "select public.community_job('membership_alert_claim', '{}', extract(epoch from now())::bigint, repeat('0', 64))")).rejects.toThrow(/Invalid signature/);
    });

    it("keeps the review link's member record behind members.view", async () => {
      const applicant = await db.createAuthUser("review-link@example.test");
      expect(await db.query(as(member), "select id from public.profiles where id = $1", [applicant])).toHaveLength(0);
      expect(await db.query(anon, "select id from public.profiles where id = $1", [applicant]).catch(() => [])).toHaveLength(0);
      expect(await db.query(as(membershipAdmin), "select id from public.profiles where id = $1", [applicant])).toHaveLength(1);
    });
  });

  describe("when an alert is queued", () => {
    it("queues one delivery per recipient after email verification, never before", async () => {
      await configure(["first@example.test", "second@example.test"]);
      const id = await db.createAuthUser("new-person@example.test", { fullName: "New Person", verified: false });
      expect(await alertFor(id)).toBeNull();
      expect(await deliveriesFor(id)).toHaveLength(0);

      await verify(id);
      const a = await alertFor(id);
      expect(a).toMatchObject({ source: "email_verified", test: false, applicant_name: "New Person", applicant_email: "new-person@example.test", recipients: 2 });
      expect((await deliveriesFor(id)).map((d) => [d.recipient_email, d.status])).toEqual([
        ["first@example.test", "pending"],
        ["second@example.test", "pending"],
      ]);
    });

    it("doesn't duplicate on repeated callbacks, sign-ins, profile edits, or provider linking", async () => {
      await configure(["first@example.test"]);
      const id = await db.createAuthUser("repeat@example.test", { verified: false });
      await verify(id);
      await verify(id); // the same link opened again
      await db.raw("update auth.users set email_confirmed_at = null where id = $1", [id]);
      await verify(id); // a confirmation reset and redone
      await db.raw("update auth.users set raw_user_meta_data = raw_user_meta_data || '{\"provider\":\"google\"}' where id = $1", [id]); // linking / sign-in metadata
      await db.raw("update public.profiles set full_name = 'Renamed', preferred_name = 'R' where id = $1", [id]); // profile edit
      expect(await deliveriesFor(id)).toHaveLength(1);
      expect(await db.raw("select 1 from membership.approval_alerts where profile_id = $1", [id])).toHaveLength(1);
    });

    it("queues once for an account created already verified (Google/Apple)", async () => {
      await configure(["first@example.test"]);
      const id = await db.createAuthUser("provider@example.test", { fullName: "Provider Person" });
      expect(await alertFor(id)).toMatchObject({ source: "verified_at_signup", recipients: 1 });
      await verify(id);
      expect(await deliveriesFor(id)).toHaveLength(1);
    });

    it("sends nothing when alerts are off or nobody is listed, and doesn't catch up later", async () => {
      await configure(["first@example.test"], false);
      const off = await db.createAuthUser("while-off@example.test", { verified: false });
      await verify(off);
      expect(await alertFor(off)).toMatchObject({ recipients: 0 });

      await db.raw("delete from membership.alert_recipients");
      await rpc(as(settingsAdmin), "membership_alert_set_enabled", [true]);
      const empty = await db.createAuthUser("nobody-listed@example.test", { verified: false });
      await verify(empty);
      expect(await alertFor(empty)).toMatchObject({ recipients: 0 });

      await rpc(as(settingsAdmin), "membership_alert_add_recipient", ["first@example.test"]);
      expect(await deliveriesFor(off)).toHaveLength(0);
      expect(await deliveriesFor(empty)).toHaveLength(0);
      expect(await deliveriesFor(waiting)).toHaveLength(0); // historical account
      expect((await claim()).map((c) => c.profile_id)).not.toEqual(expect.arrayContaining([off, empty, waiting]));
    });

    it("ignores approved accounts and invited youth", async () => {
      await configure(["first@example.test"]);
      const [policy] = await db.raw<{ id: string }>("insert into youth.policies (version, title) values (9001, 'Synthetic policy') returning id");
      const [child] = await db.raw<{ id: string }>("insert into youth.children (display_name) values ('Synthetic Youth') returning id");
      await db.raw("insert into youth.account_invitations (child_id, email, code_hash, policy_id) values ($1, 'invited-youth@example.test', repeat('a', 64), $2)", [child.id, policy.id]);
      const youth = await db.createAuthUser("invited-youth@example.test", { verified: false });
      await verify(youth);
      expect(await alertFor(youth)).toBeNull();

      const approved = await db.createAuthUser("pre-approved@example.test", { verified: false });
      await db.setStatus(approved, "approved");
      await verify(approved);
      expect(await alertFor(approved)).toBeNull();
    });

    it("never blocks registration or verification when queueing fails", async () => {
      await configure(["first@example.test"]);
      await db.raw("alter table membership.approval_alerts rename to approval_alerts_broken");
      try {
        const created = await db.createAuthUser("despite-failure@example.test");
        const later = await db.createAuthUser("verify-despite-failure@example.test", { verified: false });
        await verify(later);
        const rows = await db.raw<{ email: string; membership_status: string }>(
          "select p.email, p.membership_status from public.profiles p join auth.users u on u.id = p.id where p.id = any($1) and u.email_confirmed_at is not null",
          [[created, later]],
        );
        expect(rows.map((r) => r.membership_status)).toEqual(["pending", "pending"]);
      } finally {
        await db.raw("alter table membership.approval_alerts_broken rename to approval_alerts");
      }
    });
  });

  describe("delivery", () => {
    it("retries only the recipients that failed, and recovers stuck sends", async () => {
      await db.raw("update membership.alert_deliveries set status = 'skipped' where status in ('pending', 'failed', 'sending')");
      await configure(["first@example.test", "second@example.test", "third@example.test"]);
      const id = await db.createAuthUser("partial@example.test", { fullName: "Partial Person", verified: false });
      await verify(id);

      const first = await claim();
      expect(first.map((c) => c.to).sort()).toEqual(["first@example.test", "second@example.test", "third@example.test"]);
      expect(first[0]).toMatchObject({ profile_id: id, name: "Partial Person", email: "partial@example.test" });
      expect(await claim()).toEqual([]); // claimed rows aren't handed out twice
      const by = Object.fromEntries(first.map((c) => [c.to, c.id]));
      await job("membership_alert_result", { id: by["first@example.test"], status: "sent", provider_id: "re_1" });
      await job("membership_alert_result", { id: by["second@example.test"], status: "failed", error: "rate_limit_exceeded" });
      // third never reports back (timeout or crash)

      expect(await claim()).toEqual([]); // backoff, and the stuck send isn't stale yet
      await db.raw("update membership.alert_deliveries set next_attempt_at = now() - interval '1 minute' where status = 'failed'");
      await db.raw("update membership.alert_deliveries set updated_at = now() - interval '11 minutes' where status = 'sending'");
      expect(await db.raw<{ due: boolean }>("select membership.has_due_alerts() as due")).toEqual([{ due: true }]);
      const retry = await claim();
      expect(retry.map((c) => c.to).sort()).toEqual(["second@example.test", "third@example.test"]);
      // Same delivery ids, so the provider idempotency keys match the first attempt.
      expect(retry.map((c) => c.id).sort()).toEqual([by["second@example.test"], by["third@example.test"]].sort());
      for (const c of retry) await job("membership_alert_result", { id: c.id, status: "sent", provider_id: "re_x" });

      const rows = await deliveriesFor(id);
      expect(rows.map((r) => [r.recipient_email, r.status, r.attempts])).toEqual([
        ["first@example.test", "sent", 1],
        ["second@example.test", "sent", 2],
        ["third@example.test", "sent", 2],
      ]);
      expect(await db.raw<{ due: boolean }>("select membership.has_due_alerts() as due")).toEqual([{ due: false }]);
    });

    it("gives up after five attempts or on a permanent rejection, and records why", async () => {
      await db.raw("update membership.alert_deliveries set status = 'skipped' where status in ('pending', 'failed', 'sending')");
      await configure(["flaky@example.test", "invalid@example.test"]);
      const id = await db.createAuthUser("give-up@example.test", { verified: false });
      await verify(id);
      for (let i = 0; i < 6; i++) {
        await db.raw("update membership.alert_deliveries set next_attempt_at = now() - interval '1 minute' where status = 'failed'");
        for (const c of await claim()) {
          const permanent = c.to.startsWith("invalid");
          await job("membership_alert_result", { id: c.id, status: "failed", error: permanent ? "validation_error" : "internal_server_error", retry: !permanent });
        }
      }
      const rows = await deliveriesFor(id);
      expect(rows.map((r) => [r.recipient_email, r.status, r.attempts, r.last_error])).toEqual([
        ["flaky@example.test", "failed", 5, "internal_server_error"],
        ["invalid@example.test", "failed", 5, "validation_error"],
      ]);
      const recent = (await rpc<Json>(as(settingsAdmin), "membership_alert_admin")).recent as Json[];
      expect(recent.some((r) => r.last_error === "internal_server_error")).toBe(true);
    });

    it("skips recipients removed, alerts turned off, or accounts no longer pending before sending", async () => {
      await db.raw("update membership.alert_deliveries set status = 'skipped' where status in ('pending', 'failed', 'sending')");
      await configure(["stays@example.test", "removed@example.test"]);
      const a = await db.createAuthUser("decided@example.test", { verified: false });
      const b = await db.createAuthUser("still-waiting@example.test", { verified: false });
      await verify(a);
      await verify(b);
      await db.setStatus(a, "approved");
      const [removed] = await db.raw<{ id: string }>("select id from membership.alert_recipients where email = 'removed@example.test'");
      await rpc(as(settingsAdmin), "membership_alert_remove_recipient", [removed.id]);
      const claimed = await claim();
      expect(claimed.map((c) => [c.profile_id, c.to])).toEqual([[b, "stays@example.test"]]);
      expect((await deliveriesFor(a)).map((d) => d.last_error)).toEqual(["No longer awaiting approval", "No longer awaiting approval"]);
      expect((await deliveriesFor(b)).find((d) => d.recipient_email === "removed@example.test")?.last_error).toBe("Recipient was removed");

      const c = await db.createAuthUser("after-off@example.test", { verified: false });
      await verify(c);
      await rpc(as(settingsAdmin), "membership_alert_set_enabled", [false]);
      expect(await claim()).toEqual([]);
      expect((await deliveriesFor(c)).map((d) => d.last_error)).toEqual(["Alerts were turned off"]);
    });

    it("keeps preview registrations away from production delivery", async () => {
      await db.raw("update membership.alert_deliveries set status = 'skipped' where status in ('pending', 'failed', 'sending')");
      await configure(["first@example.test"]);
      const id = await db.createAuthUser("preview-signup@example.test", { verified: false, metadata: { registration_environment: "preview" } });
      await verify(id);
      expect(await alertFor(id)).toMatchObject({ test: true, recipients: 1 });
      expect(await db.raw<{ due: boolean }>("select community.has_due_work() as due")).toEqual([{ due: false }]);
      expect(await claim(false)).toEqual([]); // production never sends it
      expect((await claim(true)).map((c) => c.profile_id)).toEqual([id]); // a preview may (to its allowlist only)

      const prod = await db.createAuthUser("production-signup@example.test", { verified: false, metadata: { registration_environment: "production" } });
      await verify(prod);
      expect(await db.raw<{ due: boolean }>("select community.has_due_work() as due")).toEqual([{ due: true }]);
      expect(await claim(true)).toEqual([]); // previews never send real alerts
      expect((await claim(false)).map((c) => c.profile_id)).toEqual([prod]);
    });
  });

  describe("Google/Apple sign-ups", () => {
    // What Supabase Auth inserts for a new provider account (simulated row).
    const socialUser = async (email: string, provider: "google" | "apple", meta: object = {}) =>
      (
        await db.raw<{ id: string }>(
          "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values ($1, $2, $3, now()) returning id",
          [email, JSON.stringify(meta), JSON.stringify({ provider, providers: [provider] })],
        )
      )[0].id;
    const settle = (id: string, test: boolean) => rpc<boolean>(as(id), "membership_alert_settle_own", [test]);
    const held = async (id: string) =>
      (await db.raw<{ held: boolean }>(
        `select bool_and(d.next_attempt_at > now()) as held from membership.alert_deliveries d
           join membership.approval_alerts a on a.id = d.alert_id where a.profile_id = $1`,
        [id],
      ))[0].held;

    beforeEach(async () => {
      await db.raw("update membership.alert_deliveries set status = 'skipped' where status in ('pending', 'failed', 'sending')");
      await configure(["first@example.test"]);
    });

    it("holds the alert until the app settles it, then sends it with the name", async () => {
      const id = await socialUser("ruth@gmail.example", "google", { full_name: "Ruth Example" });
      expect(await alertFor(id)).toMatchObject({ source: "verified_at_signup", test: false, recipients: 1 });
      expect(await held(id)).toBe(true);
      expect(await db.raw<{ due: boolean }>("select community.has_due_work() as due")).toEqual([{ due: false }]);
      expect(await claim(false)).toEqual([]);

      expect(await settle(id, false)).toBe(true);
      const sent = await claim(false);
      expect(sent.map((c) => [c.profile_id, c.name])).toEqual([[id, "Ruth Example"]]);
      expect(await settle(id, true)).toBe(false); // too late once a send started: can't hide it now
      expect(await alertFor(id)).toMatchObject({ test: false });
    });

    it("picks up the name an Apple account gives after sign-in", async () => {
      const id = await socialUser("x7k2q9@privaterelay.appleid.com", "apple");
      expect(await alertFor(id)).toMatchObject({ applicant_name: "" });
      await db.query(as(id), "update public.profiles set full_name = 'Boaz Example' where id = $1", [id]);
      expect(await settle(id, false)).toBe(true);
      expect((await claim(false)).map((c) => c.name)).toEqual(["Boaz Example"]);
    });

    it("turns a preview sign-up into a test alert that production never sends", async () => {
      const id = await socialUser("preview.google@gmail.example", "google", { full_name: "Preview Person" });
      expect(await settle(id, true)).toBe(true);
      expect(await alertFor(id)).toMatchObject({ test: true });
      expect(await claim(false)).toEqual([]);
      expect(await settle(id, false)).toBe(true); // a later call can't make it real again
      expect(await alertFor(id)).toMatchObject({ test: true });
      expect((await claim(true)).map((c) => c.profile_id)).toEqual([id]);
    });

    it("only ever touches the caller's own alert", async () => {
      const victim = await socialUser("victim@gmail.example", "google", { full_name: "Victim" });
      const other = await socialUser("other@gmail.example", "google", { full_name: "Other" });
      expect(await settle(other, true)).toBe(true); // its own
      expect(await alertFor(victim)).toMatchObject({ test: false });
      expect(await held(victim)).toBe(true);
      await expect(rpc(anon, "membership_alert_settle_own", [true])).rejects.toThrow(/permission denied/);
      expect(await settle(member, true)).toBe(false); // an approved member has nothing to settle
    });

    it("sends anyway when the hold runs out (the app never called back)", async () => {
      const id = await socialUser("abandoned@privaterelay.appleid.com", "apple");
      await db.raw(
        `update membership.alert_deliveries set next_attempt_at = now() - interval '1 second'
          where alert_id = (select id from membership.approval_alerts where profile_id = $1)`,
        [id],
      );
      expect((await claim(false)).map((c) => [c.profile_id, c.name])).toEqual([[id, ""]]);
    });

    it("doesn't hold email registrations or accounts that carry a registration environment", async () => {
      const email = await db.createAuthUser("plain@example.test", { verified: false });
      await verify(email);
      expect(await held(email)).toBe(false);
      const tagged = await socialUser("tagged@gmail.example", "google", { registration_environment: "production", full_name: "T" });
      expect(await held(tagged)).toBe(false);
    });
  });
});
