import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A member's own "All push notifications" / "All email notifications"
 * (20261113000100), against a real database: each combination, preservation of
 * the per-category choices, categories added later, and everything that still
 * applies (in-app off, devices, quiet hours, mutes, church settings,
 * suspension). Every person and address here is synthetic; nothing is sent.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
type Prefs = Record<string, { in_app: boolean; email: string; push: boolean }>;

describeDb("member notification All overrides", () => {
  let db: TestDb;
  let ann: string; // has a push device
  let ben: string; // no push device

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
  const setAll = (actor: Actor, push: boolean | null, email: boolean | null) => rpc(actor, "community_set_channel_all", [push, email]);
  const notify = async (profile: string, kind: "group_removed" | "moderation" | "youth_family") =>
    (await db.raw<{ id: string }>("select community.notify($1, $2, null, '{}'::jsonb) as id", [profile, kind]))[0].id;
  const queued = async (id: string | null) => ({
    email: id ? ((await db.raw<{ status: string }>("select status from community.email_outbox where notification_id = $1", [id]))[0]?.status ?? null) : null,
    push: id ? ((await db.raw<{ status: string }>("select status from community.push_outbox where notification_id = $1", [id]))[0]?.status ?? null) : null,
  });
  const prefs = async (actor: Actor) => (await rpc<{ prefs: Prefs }>(actor, "community_my_settings")).prefs;

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    ann = await db.createAuthUser("all-ann@example.test", { fullName: "Ann Sample" });
    ben = await db.createAuthUser("all-ben@example.test", { fullName: "Ben Sample" });
    for (const id of [ann, ben]) await db.setStatus(id, "approved");
    await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-all-ann', $2, $3)", [ann, "p".repeat(40), "a".repeat(16)]);
  }, 120_000);
  afterAll(async () => db?.destroy());

  beforeEach(async () => {
    await db.raw("update community.channel_policy set all_types = false, disabled_types = '{}'");
    await db.raw("delete from community.member_settings; delete from community.mutes");
    await db.raw("delete from community.email_outbox; delete from community.push_outbox; update community.notifications set read_at = now() where read_at is null");
    // Individual choices: groups email off / push off; moderation email daily / push on; youth email off / push off.
    for (const id of [ann, ben]) {
      await rpc(as(id), "community_set_pref", ["groups", true, "off", false]);
      await rpc(as(id), "community_set_pref", ["moderation", true, "daily", true]);
      await rpc(as(id), "community_set_pref", ["youth", true, "off", false]);
    }
  });

  it("starts off for every member, existing settings rows included", async () => {
    await rpc(as(ann), "community_set_quiet_hours", [false, "21:00", "07:00", null]);
    expect(await db.raw("select push_all, email_all from community.member_settings where profile_id = $1", [ann])).toEqual([{ push_all: false, email_all: false }]);
    expect(await rpc(as(ben), "community_my_channel_all")).toEqual({ push_all: false, email_all: false });
    expect(await queued(await notify(ann, "group_removed"))).toEqual({ email: null, push: null });
  });

  it("push All on, email All off: push for every category, email by the individual choices", async () => {
    await setAll(as(ann), true, false);
    expect(await queued(await notify(ann, "group_removed"))).toEqual({ email: null, push: "pending" });
    expect(await queued(await notify(ann, "youth_family"))).toEqual({ email: null, push: "pending" });
  });

  it("email All on, push All off: email for every category, push by the individual choices", async () => {
    await setAll(as(ann), false, true);
    expect(await queued(await notify(ann, "group_removed"))).toEqual({ email: "pending", push: null });
    // Push stays on where the member chose it; a summary category keeps its summary (no extra immediate email).
    expect(await queued(await notify(ann, "moderation"))).toEqual({ email: null, push: "pending" });
    expect((await db.raw<{ email: string }>("select email from community.delivery_pref($1, 'moderation')", [ann]))[0].email).toBe("daily");
  });

  it("both on, and both off", async () => {
    await setAll(as(ann), true, true);
    expect(await queued(await notify(ann, "youth_family"))).toEqual({ email: "pending", push: "pending" });
    await setAll(as(ann), false, false);
    expect(await queued(await notify(ann, "youth_family"))).toEqual({ email: null, push: null });
    expect(await queued(await notify(ann, "moderation"))).toEqual({ email: null, push: "pending" });
  });

  it("keeps the individual choices while All is on and restores them when it's off; channels are independent", async () => {
    const before = await prefs(as(ann));
    await setAll(as(ann), true, true);
    expect(await prefs(as(ann))).toEqual(before);
    await setAll(as(ann), false, null); // email left as it is
    expect(await rpc(as(ann), "community_my_channel_all")).toEqual({ push_all: false, email_all: true });
    await setAll(as(ann), null, false);
    expect(await prefs(as(ann))).toEqual(before);
    expect(await queued(await notify(ann, "group_removed"))).toEqual({ email: null, push: null });
  });

  it("stops queued deliveries when All is turned off and the category is off", async () => {
    await setAll(as(ann), true, true);
    const n = await notify(ann, "group_removed");
    await setAll(as(ann), false, false);
    await job("email_claim", { limit: 50 });
    await job("push_claim", { limit: 50 });
    expect(await queued(n)).toEqual({ email: "skipped", push: "skipped" });
  });

  it("covers categories added later", async () => {
    await setAll(as(ann), true, true);
    expect(await db.raw("select email, push from community.delivery_pref($1, 'future_category')", [ann])).toEqual([{ email: "immediate", push: true }]);
    await setAll(as(ann), false, false);
    expect(await db.raw("select email, push from community.delivery_pref($1, 'future_category')", [ann])).toEqual([{ email: "immediate", push: false }]);
  });

  it("still respects devices, in-app off, mutes, quiet hours, church settings, and suspension", async () => {
    await setAll(as(ann), true, true);
    await setAll(as(ben), true, true);
    // No registered device: no push.
    expect(await queued(await notify(ben, "group_removed"))).toEqual({ email: "pending", push: null });
    // Events never email.
    expect((await db.raw<{ email: string }>("select email from community.delivery_pref($1, 'events')", [ann]))[0].email).toBe("off");
    // Church setting switched off for a category still wins.
    await db.raw("update community.channel_policy set disabled_types = '{groups}'");
    expect(await queued(await notify(ann, "group_removed"))).toEqual({ email: null, push: null });
    await db.raw("update community.channel_policy set disabled_types = '{}'");
    // A muted group: no notification at all.
    const [{ id: group }] = await db.raw<{ id: string }>("insert into community.groups (name, summary, created_by) values ('Synthetic group', 'x', $1) returning id", [ann]);
    await db.raw("insert into community.mutes (profile_id, target_type, target_id) values ($1, 'group', $2)", [ann, group]);
    expect((await db.raw<{ id: string | null }>("select community.notify($1, 'group_removed', null, $2::jsonb) id", [ann, JSON.stringify({ group_id: group })]))[0].id).toBeNull();
    // Quiet hours hold email and push.
    await db.raw("delete from community.email_outbox; delete from community.push_outbox");
    await db.raw(
      `update community.member_settings set quiet_enabled = true, timezone = 'UTC',
         quiet_start = (now() at time zone 'UTC' - interval '1 hour')::time, quiet_end = (now() at time zone 'UTC' + interval '2 hours')::time
       where profile_id = $1`,
      [ann],
    );
    const held = await notify(ann, "youth_family");
    expect(await job<unknown[]>("email_claim", { limit: 50 })).toEqual([]);
    expect(await job<unknown[]>("push_claim", { limit: 50 })).toEqual([]);
    expect(await queued(held)).toEqual({ email: "pending", push: "pending" });
    await db.raw("update community.member_settings set quiet_enabled = false where profile_id = $1", [ann]);
    // In the app off still hides the category, and so its email and push.
    await rpc(as(ann), "community_set_pref", ["youth", false, "off", false]);
    await db.raw("update community.email_outbox set send_after = now(); update community.push_outbox set send_after = now()");
    await job("email_claim", { limit: 50 });
    await job("push_claim", { limit: 50 });
    expect(await queued(held)).toEqual({ email: "skipped", push: "skipped" });
    // Suspended: nothing.
    await db.setStatus(ann, "suspended");
    expect((await db.raw<{ id: string | null }>("select community.notify($1, 'group_removed', null, '{}'::jsonb) id", [ann]))[0].id).toBeNull();
    await db.setStatus(ann, "approved");
  });

  it("only lets an approved member change their own setting", async () => {
    const pending = await db.createAuthUser("all-pending@example.test");
    for (const actor of [anon, as(pending)]) {
      await expect(setAll(actor, true, true)).rejects.toThrow(/approved members|permission denied/);
      await expect(rpc(actor, "community_my_channel_all")).rejects.toThrow(/approved members|permission denied/);
      await expect(db.query(actor, "update community.member_settings set push_all = true")).rejects.toThrow(/permission denied/);
    }
    await setAll(as(ann), true, true);
    expect(await rpc(as(ben), "community_my_channel_all")).toEqual({ push_all: false, email_all: false });
  });
});
