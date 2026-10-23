import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Church settings → Notifications (20261112000100): the church-wide push and
 * email switches per notification type and their "All" overrides, against a
 * real database. Covers each override combination, preservation of the
 * individual selections, types added later, member preferences and access
 * still applying, and who may change the settings. Every person and address
 * here is synthetic; nothing is sent.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
type Json = Record<string, unknown>;
type Channels = { push: { all: boolean; disabled: string[]; types: string[] }; email: { all: boolean; disabled: string[]; types: string[] }; membership_alerts_enabled: boolean };

describeDb("church notification channel settings", () => {
  let db: TestDb;
  let admin: string; // super administrator (settings.manage)
  let membershipAdmin: string; // no settings.manage
  let member: string; // approved member: push device, email + push on for groups/moderation/youth
  let quiet: string; // approved member who left push and email off

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

  const set = (channel: string, all: boolean, disabled: string[] | null = null, actor: Actor = as(admin)) =>
    rpc<Json>(actor, "notification_channel_set", [channel, all, disabled]);
  const channels = () => rpc<Channels>(as(admin), "notification_channels_admin");

  /** Queues one notification (kinds that need no other records to stay visible). */
  const notify = async (profile: string, kind: "group_removed" | "moderation" | "youth_family") => {
    const [{ id }] = await db.raw<{ id: string }>("select community.notify($1, $2, null, '{}'::jsonb) as id", [profile, kind]);
    return id;
  };
  const queued = async (id: string) => ({
    email: (await db.raw<{ status: string }>("select status from community.email_outbox where notification_id = $1", [id]))[0]?.status ?? null,
    push: (await db.raw<{ status: string }>("select status from community.push_outbox where notification_id = $1", [id]))[0]?.status ?? null,
  });
  /** Claims everything due and reports what each queued delivery became; marks claimed rows sent. */
  const claimAll = async () => {
    const emails = await job<Json[]>("email_claim", { limit: 50 });
    const pushes = await job<Json[]>("push_claim", { limit: 50 });
    for (const e of emails) await job("email_result", { id: e.id, status: "sent", provider_id: "test" });
    for (const p of pushes) await job("push_result", { id: p.id, status: "sent" });
    return { emails, pushes };
  };

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    admin = await db.createAuthUser("channel-admin@example.test", { fullName: "Channel Admin" });
    membershipAdmin = await db.createAuthUser("channel-membership-admin@example.test", { fullName: "Membership Admin" });
    member = await db.createAuthUser("channel-member@example.test", { fullName: "Channel Member" });
    quiet = await db.createAuthUser("channel-quiet@example.test", { fullName: "Quiet Member" });
    for (const id of [admin, membershipAdmin, member, quiet]) await db.setStatus(id, "approved");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(membershipAdmin, "membership_admin");
    for (const c of ["groups", "moderation", "youth"]) await rpc(as(member), "community_set_pref", [c, true, "immediate", true]);
    for (const c of ["groups", "moderation", "youth"]) await rpc(as(quiet), "community_set_pref", [c, true, "off", false]);
    await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-channel', $2, $3)", [member, "p".repeat(40), "a".repeat(16)]);
  }, 120_000);
  afterAll(async () => db?.destroy());

  beforeEach(async () => {
    await db.raw("update community.channel_policy set all_types = false, disabled_types = '{}'");
    await db.raw("delete from community.email_outbox; delete from community.push_outbox; update community.notifications set read_at = now() where read_at is null");
  });

  it("starts with both overrides off and every type allowed, so delivery is unchanged", async () => {
    // Fresh database (as on an existing installation after the migration).
    const rows = await db.raw<Json>("select channel, all_types, disabled_types from community.channel_policy order by channel");
    expect(rows).toEqual([
      { channel: "email", all_types: false, disabled_types: [] },
      { channel: "push", all_types: false, disabled_types: [] },
    ]);
    const c = await channels();
    expect(c.push.types).toContain("events");
    expect(c.email.types).not.toContain("events");
    expect(c.email.types).toContain("membership_approval");
    const n = await notify(member, "group_removed");
    expect(await queued(n)).toEqual({ email: "pending", push: "pending" });
  });

  it("push All on, email All off: every push type delivers; email follows the individual settings", async () => {
    await set("push", false, ["groups", "moderation"]);
    await set("email", false, ["groups"]);
    await set("push", true);
    const g = await notify(member, "group_removed");
    const m = await notify(member, "moderation");
    const y = await notify(member, "youth_family");
    expect(await queued(g)).toEqual({ email: null, push: "pending" });
    expect(await queued(m)).toEqual({ email: "pending", push: "pending" });
    expect(await queued(y)).toEqual({ email: "pending", push: "pending" });
    const { emails, pushes } = await claimAll();
    expect(pushes).toHaveLength(3);
    expect(emails).toHaveLength(2);
  });

  it("email All on, push All off: every email type delivers; push follows the individual settings", async () => {
    await set("push", false, ["youth"]);
    await set("email", false, ["groups", "youth"]);
    await set("email", true);
    const g = await notify(member, "group_removed");
    const y = await notify(member, "youth_family");
    expect(await queued(g)).toEqual({ email: "pending", push: "pending" });
    expect(await queued(y)).toEqual({ email: "pending", push: null });
  });

  it("both on: everything the member chose is delivered; both off: individual settings for each channel", async () => {
    await set("push", false, ["groups"]);
    await set("email", false, ["moderation"]);
    await set("push", true);
    await set("email", true);
    expect(await queued(await notify(member, "group_removed"))).toEqual({ email: "pending", push: "pending" });
    expect(await queued(await notify(member, "moderation"))).toEqual({ email: "pending", push: "pending" });
    await set("push", false);
    await set("email", false);
    expect(await queued(await notify(member, "group_removed"))).toEqual({ email: "pending", push: null });
    expect(await queued(await notify(member, "moderation"))).toEqual({ email: null, push: "pending" });
  });

  it("keeps the individual selections while All is on, and restores them exactly when it's turned off", async () => {
    await set("push", false, ["youth", "groups", "groups"]);
    expect((await channels()).push).toMatchObject({ all: false, disabled: ["groups", "youth"] });
    // The page sends no individual selections while All is on.
    await set("push", true);
    expect((await channels()).push).toMatchObject({ all: true, disabled: ["groups", "youth"] });
    await set("push", true, null);
    await set("push", false);
    expect((await channels()).push).toMatchObject({ all: false, disabled: ["groups", "youth"] });
    // Push changes leave email alone.
    expect((await channels()).email).toMatchObject({ all: false, disabled: [] });
    // Saving an empty list clears them.
    await set("push", false, []);
    expect((await channels()).push.disabled).toEqual([]);
  });

  it("stops already-queued deliveries when a type is switched off, and lets them through again under All", async () => {
    const g = await notify(member, "group_removed");
    await set("email", false, ["groups"]);
    await set("push", false, ["groups"]);
    await claimAll();
    expect(await queued(g)).toEqual({ email: "skipped", push: "skipped" });
    // Queued while switched off, then released by All before the send.
    await set("email", false, ["moderation"]);
    const m = await notify(member, "moderation");
    expect((await queued(m)).email).toBeNull();
    const m2 = await notify(member, "youth_family");
    await set("email", false, ["youth"]);
    await set("email", true);
    const { emails } = await claimAll();
    expect(emails.map((e) => e.id)).toHaveLength(1);
    expect(await queued(m2)).toEqual({ email: "sent", push: "sent" });
  });

  it("applies All to notification types added later", async () => {
    const pref = async () =>
      (await db.raw<{ email: string; push: boolean }>("select email, push from community.delivery_pref($1, 'future_category')", [member]))[0];
    await db.raw("insert into community.notification_prefs (profile_id, category, in_app, email, push) values ($1, 'groups', true, 'immediate', true) on conflict do nothing", [member]);
    // A type no admin has ever seen: allowed individually by default…
    expect(await db.raw("select community.channel_allows('push', 'future_category') ok")).toEqual([{ ok: true }]);
    // …and covered by All even if it had been switched off.
    await db.raw("update community.channel_policy set disabled_types = '{future_category}'");
    expect(await db.raw("select community.channel_allows('push', 'future_category') a, community.channel_allows('email', 'future_category') b")).toEqual([{ a: false, b: false }]);
    await set("push", true);
    await set("email", true);
    expect(await db.raw("select community.channel_allows('push', 'future_category') a, community.channel_allows('email', 'future_category') b")).toEqual([{ a: true, b: true }]);
    // The member's own default (email immediate, push off) still decides.
    expect(await pref()).toEqual({ email: "immediate", push: false });
  });

  it("never overrides the member's preferences, devices, mutes, access, or quiet hours", async () => {
    await set("push", true);
    await set("email", true);
    // Member chose email and push off.
    expect(await queued(await notify(quiet, "group_removed"))).toEqual({ email: null, push: null });
    // No push device: no push, whatever the church setting.
    await rpc(as(quiet), "community_set_pref", ["groups", true, "off", true]);
    expect(await queued(await notify(quiet, "group_removed"))).toEqual({ email: null, push: null });
    // The member's stored preferences aren't changed by the church setting.
    const mine = await rpc<{ prefs: Record<string, { email: string; push: boolean }> }>(as(member), "community_my_settings");
    await set("push", false, ["groups"]);
    const after = await rpc<{ prefs: Record<string, { email: string; push: boolean }> }>(as(member), "community_my_settings");
    expect(after.prefs.groups).toEqual(mine.prefs.groups);
    expect(after.prefs.groups.push).toBe(true);
    await set("push", true);
    // Quiet hours still hold email and push.
    await db.raw(
      `insert into community.member_settings (profile_id, quiet_enabled, quiet_start, quiet_end, timezone)
       values ($1, true, (now() at time zone 'UTC' - interval '1 hour')::time, (now() at time zone 'UTC' + interval '2 hours')::time, 'UTC')
       on conflict (profile_id) do update set quiet_enabled = true, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, timezone = 'UTC'`,
      [member],
    );
    const held = await notify(member, "moderation");
    const { emails, pushes } = await claimAll();
    expect(emails.concat(pushes)).toHaveLength(0);
    expect(await queued(held)).toEqual({ email: "pending", push: "pending" });
    await db.raw("update community.member_settings set quiet_enabled = false where profile_id = $1", [member]);
    // A suspended member gets nothing, even with All on.
    await db.raw("update community.email_outbox set send_after = now(); update community.push_outbox set send_after = now()");
    await db.setStatus(member, "suspended");
    const claimed = await claimAll();
    expect(claimed.emails.concat(claimed.pushes)).toHaveLength(0);
    expect(await queued(held)).toEqual({ email: "skipped", push: "skipped" });
    await db.setStatus(member, "approved");
    // A suspended recipient isn't notified at all.
    await db.setStatus(quiet, "suspended");
    expect(await db.raw("select community.notify($1, 'group_removed', null, '{}'::jsonb) id", [quiet])).toEqual([{ id: null }]);
    await db.setStatus(quiet, "approved");
  });

  it("uses Email All for membership approval alerts without changing the recipient list", async () => {
    await db.raw("update membership.alert_settings set enabled = false");
    await db.raw("delete from membership.alert_recipients");
    await rpc(as(admin), "membership_alert_add_recipient", ["approvals@example.test"]);
    const first = await db.createAuthUser("channel-applicant-1@example.test", { verified: true });
    expect(await db.raw("select recipients from membership.approval_alerts where profile_id = $1", [first])).toEqual([{ recipients: 0 }]);
    await set("email", true);
    const second = await db.createAuthUser("channel-applicant-2@example.test", { verified: true });
    const deliveries = await db.raw<{ recipient_email: string }>(
      "select d.recipient_email from membership.alert_deliveries d join membership.approval_alerts a on a.id = d.alert_id where a.profile_id = $1",
      [second],
    );
    expect(deliveries).toEqual([{ recipient_email: "approvals@example.test" }]);
    // The alert's own switch is preserved underneath.
    expect((await channels()).membership_alerts_enabled).toBe(false);
    expect((await rpc<Json>(as(admin), "membership_alert_admin")).enabled).toBe(false);
    // Push All doesn't touch it.
    await set("email", false);
    await set("push", true);
    const claimed = await job<Json[]>("membership_alert_claim", { limit: 50, test: false });
    expect(claimed).toHaveLength(0);
    expect(await db.raw("select d.status, d.last_error from membership.alert_deliveries d join membership.approval_alerts a on a.id = d.alert_id where a.profile_id = $1", [second])).toEqual([
      { status: "skipped", last_error: "Alerts were turned off" },
    ]);
  });

  it("validates input and records each change in the audit log", async () => {
    await expect(set("sms", true)).rejects.toThrow(/Unknown notification channel/);
    await expect(set("email", false, ["events"])).rejects.toThrow(/Unknown notification type/);
    await expect(set("email", false, ["membership_approval"])).rejects.toThrow(/Unknown notification type/);
    await expect(set("push", false, ["not_a_type"])).rejects.toThrow(/Unknown notification type/);
    await expect(rpc(as(admin), "notification_channel_set", ["push", null, null])).rejects.toThrow(/Choose whether/);
    await db.raw("delete from public.audit_log where action = 'notifications.channel_changed'");
    await set("push", true);
    await set("push", true); // no change, no entry
    await set("email", false, ["forum"]);
    const audit = await db.raw<{ actor_id: string; target_id: string; details: Json }>(
      "select actor_id, target_id, details from public.audit_log where action = 'notifications.channel_changed' order by id",
    );
    expect(audit).toEqual([
      { actor_id: admin, target_id: "notifications_push", details: { channel: "push", all: true, disabled: [], previous_all: false, previous_disabled: [] } },
      { actor_id: admin, target_id: "notifications_email", details: { channel: "email", all: false, disabled: ["forum"], previous_all: false, previous_disabled: [] } },
    ]);
  });

  it("refuses everyone without settings.manage", async () => {
    const pending = await db.createAuthUser("channel-pending@example.test");
    for (const actor of [anon, as(member), as(membershipAdmin), as(pending)]) {
      await expect(rpc(actor, "notification_channels_admin")).rejects.toThrow(/permission/);
      await expect(set("push", true, null, actor)).rejects.toThrow(/permission/);
      await expect(db.query(actor, "select * from community.channel_policy")).rejects.toThrow(/permission denied/);
      await expect(db.query(actor, "update community.channel_policy set all_types = true")).rejects.toThrow(/permission denied/);
      await expect(db.query(actor, "select community.channel_allows('push', 'groups')")).rejects.toThrow(/permission denied/);
    }
    expect(await db.raw("select bool_or(all_types) a from community.channel_policy")).toEqual([{ a: false }]);
  });
});
