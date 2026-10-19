import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 5 community against a real database: forum and group isolation,
 * invitations, leader scope, group-restricted events, direct messages,
 * blocking, reports, moderation, notifications, digests, quiet hours,
 * Realtime authorization, and rate limits. Every person and post here is
 * synthetic.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
const TZ = "America/Chicago";
type Json = Record<string, unknown>;

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describeDb("community: forum, groups, messages, moderation, notifications", () => {
  let db: TestDb;
  let admin: string; // super administrator (membership + community capabilities, no finance)
  let moderator: string; // community moderator only
  let communityAdmin: string; // community administrator only
  let coordinator: string; // event coordinator only
  let leader: string; // ordinary member appointed group leader
  let m1: string;
  let m2: string;
  let m3: string;
  let optedOut: string; // eligible, but not listed in the directory
  let pending: string;
  let suspended: string;
  let openGroup: string; // discoverable
  let hiddenGroup: string;
  let category: string;
  let groupThread: string; // a discussion in openGroup

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message?: RegExp) => {
    const p = rpc(actor, fn, args);
    if (message) await expect(p).rejects.toThrow(message);
    else await expect(p).rejects.toThrow();
  };
  const ack = async (id: string) => {
    const g = await rpc<Json>(as(id), "community_guidelines");
    await rpc(as(id), "community_ack_guidelines", [g.version]);
  };
  const eligible = (id: string, on = true) => rpc(as(admin), "community_admin_set_dm_eligibility", [id, on, "Synthetic test"]);
  const unread = (id: string) => rpc<{ notifications: number; messages: number }>(as(id), "community_unread_counts");
  const notifs = async (id: string) => ((await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[]);
  const newThread = (id: string, opts: { category?: string | null; group?: string | null; title?: string; body?: string; key?: string } = {}) =>
    rpc<string>(as(id), "community_thread_create", [
      opts.group ? null : (opts.category ?? category),
      opts.group ?? null,
      opts.title ?? "A synthetic discussion",
      opts.body ?? "Synthetic body text.",
      opts.key ?? null,
    ]);

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    const mk = async (email: string, name: string, status: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (status !== "pending") await db.setStatus(id, status === "suspended" ? "approved" : status);
      if (status === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("c.admin@example.test", "Synthetic Admin");
    moderator = await mk("c.moderator@example.test", "Synthetic Moderator");
    communityAdmin = await mk("c.cadmin@example.test", "Synthetic Community Admin");
    coordinator = await mk("c.coordinator@example.test", "Synthetic Coordinator");
    leader = await mk("c.leader@example.test", "Synthetic Leader");
    m1 = await mk("c.m1@example.test", "Alpha Member");
    m2 = await mk("c.m2@example.test", "Bravo Member");
    m3 = await mk("c.m3@example.test", "Charlie Member");
    optedOut = await mk("c.hidden@example.test", "Delta Hidden");
    pending = await mk("c.pending@example.test", "Pending Person", "pending");
    suspended = await mk("c.suspended@example.test", "Suspended Person", "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(moderator, "community_moderator");
    await db.grantRole(communityAdmin, "community_admin");
    await db.grantRole(coordinator, "event_coordinator");
    await db.raw("update public.member_profile_details set directory_listed = false where profile_id = $1", [optedOut]);
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    for (const id of [leader, m1, m2, m3, optedOut, moderator]) await ack(id);
    openGroup = await rpc<string>(as(communityAdmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Open Group", summary: "Public summary", about: "Members-only details", visibility: "discoverable", leader_id: leader }),
    ]);
    hiddenGroup = await rpc<string>(as(communityAdmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Hidden Group", summary: "Secret summary", about: "Secret details", visibility: "hidden", leader_id: leader }),
    ]);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  // Rate limits are exercised on their own; other tests start from a clean window.
  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  describe("access", () => {
    it("keeps the community schema unreadable and functions closed to visitors", async () => {
      await expect(db.query(as(m1), "select * from community.threads")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.community_categories()")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.community_dm_conversations()")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(m1), "select community.is_member($1)", [m1])).rejects.toThrow(/permission denied/);
    });

    it("denies pending and suspended accounts", async () => {
      for (const id of [pending, suspended]) {
        await fails(as(id), "community_categories", [], /Only approved members/);
        await fails(as(id), "community_threads", [category, null, null, null, 20], /Only approved members/);
        await fails(as(id), "community_dm_conversations", [], /Only approved members/);
        await fails(as(id), "community_groups", [], /Only approved members/);
        expect(await unread(id)).toEqual({ notifications: 0, messages: 0 });
      }
    });

    it("requires the current guidelines before posting, and a re-acknowledgment after a new version", async () => {
      // Everyone else acknowledged in setup; use a fresh account.
      const fresh = await db.createAuthUser("c.fresh@example.test", { fullName: "Fresh Member" });
      await db.setStatus(fresh, "approved");
      await fails(as(fresh), "community_thread_create", [category, null, "Too early", "Body", null], /accept the community guidelines/);
      await ack(fresh);
      expect(await newThread(fresh)).toMatch(/[0-9a-f-]{36}/);
      await rpc(as(communityAdmin), "community_admin_save_guidelines", ["Be kind to one another. Updated synthetic guidelines.", true]);
      await fails(as(fresh), "community_thread_create", [category, null, "After update", "Body", null], /accept the community guidelines/);
      for (const id of [leader, m1, m2, m3, optedOut, moderator, fresh]) await ack(id);
    });
  });

  describe("discussions", () => {
    let thread: string;

    it("creates, lists, and shows a church-wide thread (idempotent with a client key)", async () => {
      const key = randomUUID();
      thread = await newThread(m1, { title: "Synthetic potluck plans", body: "Who is bringing **dessert**?", key });
      expect(await newThread(m1, { title: "Synthetic potluck plans", body: "Who is bringing **dessert**?", key })).toBe(thread);
      const list = await rpc<Json>(as(m2), "community_threads", [category, null, null, null, 20]);
      const card = (list.items as Json[]).find((t) => t.id === thread)!;
      expect(card.title).toBe("Synthetic potluck plans");
      expect(card.author).toBe("Alpha Member");
      const detail = await rpc<Json>(as(m2), "community_thread", [thread, null, null, 30]);
      expect(detail.body).toContain("dessert");
      expect(detail.audience).toBe("church");
    });

    it("notifies the author and followers, merging unread replies", async () => {
      await rpc(as(m3), "community_follow", [thread, true]);
      await rpc(as(m2), "community_reply", [thread, "I can bring pie.", randomUUID()]);
      await rpc(as(m2), "community_reply", [thread, "And napkins.", randomUUID()]);
      const mine = (await notifs(m1)).filter((n) => n.kind === "reply_mine");
      expect(mine).toHaveLength(1);
      expect(mine[0].count).toBe(2);
      expect(mine[0].title).toMatch(/2 new replies to your discussion/);
      const followed = (await notifs(m3)).filter((n) => n.kind === "reply_followed");
      expect(followed).toHaveLength(1);
      // The replier gets nothing about their own reply.
      expect((await notifs(m2)).filter((n) => n.kind?.toString().startsWith("reply"))).toHaveLength(0);
    });

    it("lets only the author edit; a retried reply is not duplicated", async () => {
      await fails(as(m2), "community_thread_edit", [thread, "Hijacked title", "Nope"], /wasn't found/);
      await rpc(as(m1), "community_thread_edit", [thread, "Synthetic potluck plans (updated)", "Updated body"]);
      const key = randomUUID();
      const a = await rpc<string>(as(m3), "community_reply", [thread, "Same reply", key]);
      const b = await rpc<string>(as(m3), "community_reply", [thread, "Same reply", key]);
      expect(a).toBe(b);
      expect((await db.raw("select count(*)::int n from community.posts where client_key = $1", [key]))[0].n).toBe(1);
    });

    it("reacts, toggling the member's own reaction", async () => {
      const r = await rpc<Json>(as(m2), "community_react", ["thread", thread, "heart", true]);
      expect(r.heart).toEqual({ count: 1, mine: true });
      const r2 = await rpc<Json>(as(m2), "community_react", ["thread", thread, "heart", false]);
      expect(r2.heart).toEqual({ count: 0, mine: false });
    });

    it("pins and locks for moderators only; locked threads refuse replies and edits", async () => {
      await fails(as(m2), "community_mod_thread", [thread, "lock", null, null], /permission to moderate/);
      await fails(as(leader), "community_mod_thread", [thread, "lock", null, null], /permission to moderate/);
      await rpc(as(moderator), "community_mod_thread", [thread, "pin", null, null]);
      await rpc(as(moderator), "community_mod_thread", [thread, "lock", "Cooling off", null]);
      await fails(as(m2), "community_reply", [thread, "Too late", null], /locked/);
      await fails(as(m1), "community_thread_edit", [thread, "Edited title", "x"], /locked/);
      const list = await rpc<Json>(as(m2), "community_threads", [category, null, null, null, 20]);
      expect((list.pinned as Json[]).map((t) => t.id)).toContain(thread);
      await rpc(as(moderator), "community_mod_thread", [thread, "unlock", null, null]);
    });

    it("deletes a thread with replies as an erased placeholder, and one without replies entirely", async () => {
      expect(await rpc(as(m1), "community_thread_delete", [thread])).toBe("placeholder");
      const row = (await db.raw<Json>("select title, body, status from community.threads where id = $1", [thread]))[0];
      expect(row).toEqual({ title: "", body: "", status: "deleted" });
      const shown = await rpc<Json>(as(m2), "community_thread", [thread, null, null, 30]);
      expect(shown.title).toBeNull();
      expect(shown.body).toBeNull();
      expect(shown.can_reply).toBe(false);
      expect((shown.posts as Json[]).length).toBeGreaterThan(0);
      const lonely = await newThread(m2, { title: "Lonely synthetic thread" });
      expect(await rpc(as(m2), "community_thread_delete", [lonely])).toBe("removed");
      expect(await rpc(as(m2), "community_thread", [lonely, null, null, 30])).toBeNull();
    });

    it("deletes a reply as a placeholder without its text", async () => {
      const t = await newThread(m1, { title: "Reply deletion test" });
      const p = await rpc<string>(as(m2), "community_reply", [t, "Delete me later", null]);
      await rpc(as(m2), "community_reply_delete", [p]);
      expect((await db.raw<Json>("select body, status from community.posts where id = $1", [p]))[0]).toEqual({ body: "", status: "deleted" });
      const shown = await rpc<Json>(as(m1), "community_thread", [t, null, null, 30]);
      const post = (shown.posts as Json[]).find((x) => x.id === p)!;
      expect(post.status).toBe("deleted");
      expect(post.body).toBeNull();
      expect(post.author).toBeNull();
    });

    it("pages threads with a cursor", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(await newThread(m3, { title: `Paging synthetic ${i}` }));
      const first = await rpc<Json>(as(m1), "community_threads", [category, null, null, null, 2]);
      const cursor = first.next_cursor as { at: string; id: string };
      expect(cursor).toBeTruthy();
      const second = await rpc<Json>(as(m1), "community_threads", [category, null, cursor.at, cursor.id, 2]);
      const seen = [...(first.items as Json[]), ...(second.items as Json[])].map((t) => t.id);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("rate-limits new threads on the server", async () => {
      const limited = await db.createAuthUser("c.rate@example.test", { fullName: "Rate Limited" });
      await db.setStatus(limited, "approved");
      await ack(limited);
      for (let i = 0; i < 6; i++) await newThread(limited, { title: `Rate synthetic ${i}` });
      await fails(as(limited), "community_thread_create", [category, null, "Seventh", "Body", null], /too often/);
    });
  });

  describe("groups", () => {
    let requestId: string;

    it("shows discoverable groups' public card only; hides hidden groups entirely", async () => {
      const g = await rpc<Json>(as(m1), "community_groups");
      expect((g.discover as Json[]).map((x) => x.id)).toContain(openGroup);
      expect(JSON.stringify(g)).not.toContain(hiddenGroup);
      const card = await rpc<Json>(as(m1), "community_group", [openGroup]);
      expect(card.summary).toBe("Public summary");
      expect(card.about).toBeNull();
      expect(card.leaders).toBeNull();
      expect(card.member_count).toBeNull();
      expect(await rpc(as(m1), "community_group", [hiddenGroup])).toBeNull();
      await fails(as(m1), "community_group_roster", [openGroup], /Only group members/);
      await fails(as(m1), "community_threads", [null, openGroup, null, null, 20], /only for its members/);
      // The community administrator can see the hidden group exists...
      expect(await rpc(as(communityAdmin), "community_group", [hiddenGroup])).not.toBeNull();
      // ...but not its discussions.
      await fails(as(communityAdmin), "community_threads", [null, hiddenGroup, null, null, 20], /only for its members/);
    });

    it("handles join requests: leader notified, approval grants membership", async () => {
      await rpc(as(m1), "community_group_request", [openGroup, "Synthetic hello"]);
      await rpc(as(m1), "community_group_request", [openGroup, "Again"]); // idempotent
      const roster = await rpc<Json>(as(leader), "community_group_roster", [openGroup]);
      const requests = roster.requests as Json[];
      expect(requests).toHaveLength(1);
      requestId = requests[0].id as string;
      expect((await notifs(leader)).some((n) => n.kind === "group_request")).toBe(true);
      await fails(as(m2), "community_group_decide", [requestId, true], /wasn't found/);
      await rpc(as(leader), "community_group_decide", [requestId, true]);
      await fails(as(leader), "community_group_decide", [requestId, true], /already answered/);
      expect((await rpc<Json>(as(m1), "community_group", [openGroup])).about).toBe("Members-only details");
      expect((await notifs(m1)).some((n) => n.kind === "group_request_approved")).toBe(true);
    });

    it("keeps group discussions to active members", async () => {
      groupThread = await newThread(m1, { group: openGroup, title: "Synthetic group-only thread" });
      expect((await rpc<Json>(as(m1), "community_thread", [groupThread, null, null, 30])).audience).toBe("group");
      expect(await rpc(as(m2), "community_thread", [groupThread, null, null, 30])).toBeNull();
      expect(await rpc(as(moderator), "community_thread", [groupThread, null, null, 30])).toBeNull();
      expect(JSON.stringify(await rpc(as(m2), "community_recent", [30]))).not.toContain(groupThread);
      await fails(as(m2), "community_reply", [groupThread, "Sneaky", null], /wasn't found/);
      await fails(as(m2), "community_react", ["thread", groupThread, "heart", true], /wasn't found/);
      await fails(as(m2), "community_report", ["thread", [groupThread], "spam", null], /wasn't found/);
    });

    it("invitations need acceptance, can't be replayed, revoked, or used after expiry", async () => {
      await rpc(as(leader), "community_group_invite", [hiddenGroup, m2]);
      const inv = ((await rpc<Json>(as(m2), "community_groups")).invitations as Json[])[0];
      expect((inv.group as Json).id).toBe(hiddenGroup);
      expect(await rpc(as(m2), "community_group", [hiddenGroup])).toBeNull(); // the invitation card is all they see until accepting
      await fails(as(m3), "community_group_respond", [inv.id, true], /no longer available/);
      await rpc(as(m2), "community_group_respond", [inv.id, true]);
      await fails(as(m2), "community_group_respond", [inv.id, true], /no longer available/);
      expect((await rpc<Json>(as(m2), "community_group", [hiddenGroup])).is_member).toBe(true);

      await rpc(as(leader), "community_group_invite", [hiddenGroup, m3]);
      const inv3 = ((await rpc<Json>(as(m3), "community_groups")).invitations as Json[])[0];
      await rpc(as(leader), "community_group_revoke_invitation", [inv3.id]);
      await fails(as(m3), "community_group_respond", [inv3.id, true], /no longer available/);

      await rpc(as(leader), "community_group_invite", [hiddenGroup, m3]);
      const inv3b = ((await rpc<Json>(as(m3), "community_groups")).invitations as Json[])[0];
      await db.raw("update community.group_invitations set expires_at = now() - interval '1 minute' where id = $1", [inv3b.id]);
      await fails(as(m3), "community_group_respond", [inv3b.id, true], /no longer available/);
      expect((await rpc<Json>(as(m3), "community_groups")).invitations).toEqual([]);
    });

    it("refuses invitations to pending, suspended, and unknown accounts with one message", async () => {
      for (const target of [pending, suspended, randomUUID()]) {
        await fails(as(leader), "community_group_invite", [hiddenGroup, target], /can't be invited right now/);
      }
      await fails(as(m1), "community_group_invite", [hiddenGroup, m3], /permission to manage/);
    });

    it("scopes leaders to their own groups with no global capability", async () => {
      const other = await rpc<string>(as(communityAdmin), "community_group_save", [
        JSON.stringify({ name: "Synthetic Other Group", visibility: "discoverable", leader_id: m3 }),
      ]);
      await fails(as(leader), "community_group_save", [JSON.stringify({ id: other, name: "Taken over" })], /wasn't found/);
      await fails(as(leader), "community_group_invite", [other, m2], /permission to manage/);
      await fails(as(leader), "community_admin_groups", [], /permission/);
      await fails(as(leader), "community_group_set_member", [openGroup, m1, "add_leader"], /Only community administrators/);
      await fails(as(leader), "community_group_save", [JSON.stringify({ name: "New group", leader_id: leader })], /Only community administrators/);
      await fails(as(leader), "community_mod_reports", ["open", null], /permission/);
      await fails(as(leader), "community_admin_set_dm_eligibility", [m1, true, null], /permission/);
      const caps = await db.query<{ c: string }>(as(leader), "select public.my_capabilities() as c");
      expect(caps).toEqual([]);
      // A leader can edit their own group's details but not its visibility.
      await rpc(as(leader), "community_group_save", [JSON.stringify({ id: openGroup, summary: "New public summary", visibility: "hidden" })]);
      const g = (await db.raw<Json>("select summary, visibility from community.groups where id = $1", [openGroup]))[0];
      expect(g).toEqual({ summary: "New public summary", visibility: "discoverable" });
    });

    it("protects the last leader until a replacement is appointed or the group is archived", async () => {
      await fails(as(leader), "community_group_leave", [hiddenGroup], /at least one leader/);
      await fails(as(communityAdmin), "community_group_set_member", [hiddenGroup, leader, "remove_leader_role"], /at least one leader/);
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, m2, "add_leader"]);
      await rpc(as(leader), "community_group_leave", [hiddenGroup]);
      expect((await rpc<Json>(as(leader), "community_groups")).mine as Json[]).not.toContainEqual(expect.objectContaining({ id: hiddenGroup }));
      // Archive path: a group whose only leader is m3.
      const solo = await rpc<string>(as(communityAdmin), "community_group_save", [JSON.stringify({ name: "Synthetic Solo Group", leader_id: m3 })]);
      await rpc(as(communityAdmin), "community_group_archive", [solo, true]);
      await rpc(as(m3), "community_group_leave", [solo]);
      await fails(as(communityAdmin), "community_group_archive", [solo, false], /Appoint a leader/);
    });

    it("never derives membership from households", async () => {
      const h = await rpc<string>(as(m1), "household_create", ["Synthetic Household"]);
      expect(h).toBeTruthy();
      await rpc(as(m1), "household_invite", [m3]);
      const invitation = (await db.raw<{ id: string }>("select id from public.household_invitations where invitee_id = $1 and status = 'pending'", [m3]))[0];
      await rpc(as(m3), "household_respond", [invitation.id, true]);
      expect(await rpc(as(m3), "community_thread", [groupThread, null, null, 30])).toBeNull();
      // Nor access to another adult's conversations or settings.
      const settings = await rpc<Json>(as(m3), "community_my_settings");
      expect(settings.dm_allow).toBe("members");
    });

    it("stores group images readable only by people who can see the group", async () => {
      const name = `${hiddenGroup}/abcdefgh12345678.webp`;
      await db.query(as(m2), "insert into storage.objects (bucket_id, name) values ('group-images', $1)", [name]); // m2 now leads it
      await expect(db.query(as(m1), "insert into storage.objects (bucket_id, name) values ('group-images', $1)", [`${hiddenGroup}/zzzzzzzz12345678.webp`])).rejects.toThrow();
      await rpc(as(m2), "community_group_save", [JSON.stringify({ id: hiddenGroup, image_path: name, image_alt: "Synthetic picture" })]);
      const visible = async (id: string) =>
        (await db.query<{ n: number }>(as(id), "select count(*)::int n from storage.objects where bucket_id = 'group-images' and name = $1", [name]))[0].n;
      expect(await visible(m2)).toBe(1);
      expect(await visible(m1)).toBe(0);
      expect(await visible(communityAdmin)).toBe(1);
    });
  });

  describe("group-restricted events", () => {
    let occ: string;
    let series: string;

    it("lets event coordinators target discoverable groups only (unless they administer the group)", async () => {
      const groups = await rpc<Json[]>(as(coordinator), "events_admin_groups");
      expect(groups.map((g) => g.id)).toContain(openGroup);
      expect(groups.map((g) => g.id)).not.toContain(hiddenGroup);
      const base = {
        title: "Synthetic Group Event", description: "Synthetic.", audience: "group", group_id: hiddenGroup, timezone: TZ,
        all_day: false, start_date: ymd(10), start_time: "18:00", duration_minutes: 60, rsvp_enabled: true, capacity: 1,
        waitlist_enabled: true, reminder_minutes: [1440],
      };
      await fails(as(coordinator), "events_admin_save", [JSON.stringify(base)], /Choose a group/);
      const saved = await rpc<Json>(as(coordinator), "events_admin_save", [JSON.stringify({ ...base, group_id: openGroup, cover_path: "synthetic-cover.webp", cover_alt: "Cover" })]);
      series = saved.id as string;
      await rpc(as(coordinator), "events_admin_status", [series, "publish", null, null]);
      occ = ((await rpc<Json>(as(coordinator), "events_admin_get", [series])).occurrences as Json[])[0].id as string;
    });

    it("shows the event, its image, and RSVP only to active group members", async () => {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 30 * 86400_000).toISOString();
      const ids = async (id: string) => ((await rpc<Json[]>(as(id), "events_list", [from, to, null, 200])).map((o) => o.id));
      expect(await ids(m1)).toContain(occ);
      expect(await ids(m2)).not.toContain(occ);
      expect(await rpc(as(m2), "events_occurrence", [occ])).toBeNull();
      expect(await rpc(anon, "events_occurrence", [occ])).toBeNull();
      expect(((await rpc<Json>(as(m1), "events_occurrence", [occ])).group as Json).name).toBe("Synthetic Open Group");
      await fails(as(m2), "events_rsvp", [occ], /wasn't found/);
      const img = async (id: string) => (await db.query<{ ok: boolean }>(as(id), "select public.can_view_event_image('synthetic-cover.webp') ok"))[0].ok;
      expect(await img(m1)).toBe(true);
      expect(await img(m2)).toBe(false);
      expect((await rpc<Json[]>(as(m1), "community_group_events", [openGroup])).map((o) => o.id)).toContain(occ);
    });

    it("removal cancels the registration, promotes the waitlist, and closes feeds and notifications", async () => {
      // Leader joins the waitlist behind m1.
      expect(((await rpc<Json>(as(m1), "events_rsvp", [occ])) as Json).status).toBe("confirmed");
      expect(((await rpc<Json>(as(leader), "events_rsvp", [occ])) as Json).status).toBe("waitlisted");
      const token = await rpc<string>(as(m1), "events_feed_token_rotate");
      expect(((await rpc<Json[]>(anon, "events_feed_private", [token])) ?? []).length).toBe(1);
      // A change notice reaches m1 in-app.
      await db.raw("select events.notify_registrants($1, 'changed', '{\"fields\":[\"time\"]}')", [occ]);
      expect((await notifs(m1)).some((n) => n.kind === "event")).toBe(true);

      await rpc(as(leader), "community_group_set_member", [openGroup, m1, "remove"]);
      const reg = (await db.raw<Json>("select status, cancel_reason from events.registrations where occurrence_id = $1 and profile_id = $2", [occ, m1]))[0];
      expect(reg).toEqual({ status: "canceled", cancel_reason: "ineligible" });
      const promoted = (await db.raw<Json>("select status from events.registrations where occurrence_id = $1 and profile_id = $2", [occ, leader]))[0];
      expect(promoted.status).toBe("confirmed");
      expect(await rpc(as(m1), "events_occurrence", [occ])).toBeNull();
      expect(await rpc<Json[]>(anon, "events_feed_private", [token])).toEqual([]);
      expect((await notifs(m1)).some((n) => n.kind === "event")).toBe(false);
      expect(JSON.stringify(await notifs(m1))).not.toContain("Synthetic Group Event");
      const queued = await db.raw<Json>("select status from events.outbox where occurrence_id = $1 and profile_id = $2 and status in ('pending','failed')", [occ, m1]);
      expect(queued).toEqual([]);
      // Their group discussion is gone for them too.
      expect(await rpc(as(m1), "community_thread", [groupThread, null, null, 30])).toBeNull();
    });
  });

  describe("direct messages", () => {
    let conv: string;

    it("fails closed without an explicit eligibility decision", async () => {
      await fails(as(m1), "community_dm_start", [m2], /isn't available for direct messages/);
      expect(await rpc(as(m1), "community_dm_recipients", ["Bravo"])).toEqual([]);
      await fails(as(m1), "community_admin_set_dm_eligibility", [m2, true, null], /permission/);
      await fails(as(admin), "community_admin_set_dm_eligibility", [admin, true, null], /your own/);
      await fails(as(admin), "community_admin_set_dm_eligibility", [pending, true, null], /approved adult/);
      for (const id of [m1, m2, m3, optedOut]) await eligible(id);
      const audit = await db.raw<Json>("select details from public.audit_log where action = 'messaging.eligibility_granted' and target_id = $1", [m1]);
      expect(audit).toEqual([{ details: {} }]);
    });

    it("searches only listed, reachable members", async () => {
      const found = await rpc<Json[]>(as(m1), "community_dm_recipients", ["Member"]);
      expect(found.map((f) => f.id).sort()).toEqual([m2, m3].sort());
      expect(await rpc(as(m1), "community_dm_recipients", ["Delta"])).toEqual([]); // opted out of the directory
      expect(await rpc(as(m1), "community_dm_recipients", ["Pending"])).toEqual([]);
      expect(await rpc(as(m1), "community_dm_recipients", ["a"])).toEqual([]); // too short
    });

    it("sends, deduplicates retries, counts unread, and marks read", async () => {
      conv = await rpc<string>(as(m1), "community_dm_start", [m2]);
      expect(await rpc(as(m2), "community_dm_start", [m1])).toBe(conv);
      const key = randomUUID();
      const sent = await rpc<Json>(as(m1), "community_dm_send", [conv, "Synthetic hello, Bravo", key]);
      const again = await rpc<Json>(as(m1), "community_dm_send", [conv, "Synthetic hello, Bravo", key]);
      expect(again.id).toBe(sent.id);
      expect(again.duplicate).toBe(true);
      expect((await unread(m2)).messages).toBe(1);
      const page = await rpc<Json>(as(m2), "community_dm_messages", [conv, null, null, 40]);
      expect((page.messages as Json[]).map((m) => m.body)).toEqual(["Synthetic hello, Bravo"]);
      const note = (await notifs(m2)).find((n) => n.kind === "message")!;
      expect(note.title).toBe("You have a new message");
      expect(JSON.stringify(note)).not.toContain("Synthetic hello");
      await rpc(as(m2), "community_dm_mark_read", [conv]);
      expect((await unread(m2)).messages).toBe(0);
      // No message text anywhere in the audit log.
      expect(JSON.stringify(await db.raw("select * from public.audit_log"))).not.toContain("Synthetic hello");
    });

    it("keeps conversations to their two participants", async () => {
      expect(await rpc(as(m3), "community_dm_messages", [conv, null, null, 40])).toBeNull();
      await fails(as(m3), "community_dm_send", [conv, "Intruding", randomUUID()], /wasn't found/);
      await fails(as(m3), "community_dm_mark_read", [conv], /wasn't found/);
      await fails(as(admin), "community_dm_send", [conv, "Admin reading", randomUUID()], /wasn't found/);
      expect(await rpc(as(admin), "community_dm_messages", [conv, null, null, 40])).toBeNull();
      expect(await rpc(as(moderator), "community_dm_messages", [conv, null, null, 40])).toBeNull();
      await fails(as(m3), "community_report", ["message", [((await db.raw<{ id: string }>("select id from community.messages limit 1"))[0].id)], "spam", null], /weren't found/);
    });

    it("honors recipient settings on every send, with the same refusal as a block", async () => {
      await rpc(as(m2), "community_set_dm_allow", ["none"]);
      await fails(as(m1), "community_dm_send", [conv, "Still there?", randomUUID()], /isn't available for direct messages/);
      await rpc(as(m2), "community_set_dm_allow", ["shared_groups"]);
      await fails(as(m1), "community_dm_send", [conv, "Still there?", randomUUID()], /isn't available for direct messages/); // m1 left the group
      await rpc(as(m2), "community_set_dm_allow", ["members"]);
      await rpc(as(m1), "community_dm_send", [conv, "Back again", randomUUID()]);
    });

    it("blocks both directions without revealing it, and suppresses notifications", async () => {
      await rpc(as(m2), "community_block", [m1, true]);
      const err = await rpc(as(m1), "community_dm_send", [conv, "Hello?", randomUUID()]).catch((e: Error) => e.message);
      expect(err).toBe("This member isn't available for direct messages.");
      await fails(as(m2), "community_dm_send", [conv, "Blocked sender", randomUUID()], /isn't available/);
      await fails(as(m1), "community_dm_start", [m2], /isn't available/);
      expect(await rpc(as(m1), "community_dm_recipients", ["Bravo"])).toEqual([]);
      // History stays readable to both.
      expect(((await rpc<Json>(as(m1), "community_dm_messages", [conv, null, null, 40])).messages as Json[]).length).toBeGreaterThan(0);
      expect((await notifs(m2)).filter((n) => n.kind === "message" && !n.read)).toEqual([]);
      // The block does not hide shared discussion posts.
      const t = await newThread(m1, { title: "Visible despite block" });
      expect(await rpc(as(m2), "community_thread", [t, null, null, 30])).not.toBeNull();
      await rpc(as(m2), "community_block", [m1, false]);
      await rpc(as(m1), "community_dm_send", [conv, "After unblock", randomUUID()]);
    });

    it("allows messaging from a shared group roster to directory opt-outs when their settings allow", async () => {
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, optedOut, "add_leader"]);
      const roster = await rpc<Json>(as(m2), "community_group_roster", [hiddenGroup]);
      const entry = (roster.members as Json[]).find((m) => m.id === optedOut)!;
      expect(entry.can_message).toBe(true);
      expect(JSON.stringify(roster)).not.toMatch(/example\.test/);
      await rpc(as(optedOut), "community_set_dm_allow", ["none"]);
      const roster2 = await rpc<Json>(as(m2), "community_group_roster", [hiddenGroup]);
      expect((roster2.members as Json[]).find((m) => m.id === optedOut)!.can_message).toBe(false);
      await fails(as(m2), "community_dm_start", [optedOut], /isn't available/);
    });

    it("stops messaging when eligibility is revoked or the member is suspended", async () => {
      await eligible(m3, false);
      await fails(as(m1), "community_dm_start", [m3], /isn't available/);
      await eligible(m3, true);
      const c13 = await rpc<string>(as(m1), "community_dm_start", [m3]);
      await db.setStatus(m3, "suspended");
      await fails(as(m1), "community_dm_send", [c13, "Are you there?", randomUUID()], /isn't available/);
      await fails(as(m3), "community_dm_messages", [c13, null, null, 40], /Only approved members/);
      await db.setStatus(m3, "approved");
    });

    it("rate-limits sends and pings only the participants' private channels without content", async () => {
      const pings = await db.raw<Json>("select topic, payload, private from realtime.messages where topic = $1", [`member:${m2}`]);
      expect(pings.length).toBeGreaterThan(0);
      expect(pings.every((p) => p.private === true)).toBe(true);
      expect(JSON.stringify(pings)).not.toMatch(/Synthetic hello|Back again|After unblock/);
    });
  });

  describe("realtime authorization", () => {
    const visibleTo = async (id: string, topic: string) => {
      await db.client.query("begin");
      try {
        await db.client.query("set local role authenticated");
        await db.client.query("select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)", [
          JSON.stringify({ sub: id, role: "authenticated" }),
          topic,
        ]);
        const r = await db.client.query("select count(*)::int n from realtime.messages");
        return r.rows[0].n as number;
      } finally {
        await db.client.query("rollback");
      }
    };

    it("lets members receive only their own topic, and only while approved", async () => {
      expect(await visibleTo(m2, `member:${m2}`)).toBeGreaterThan(0);
      expect(await visibleTo(m3, `member:${m2}`)).toBe(0);
      await db.setStatus(m2, "suspended");
      expect(await visibleTo(m2, `member:${m2}`)).toBe(0);
      await db.setStatus(m2, "approved");
    });

    it("never lets clients broadcast", async () => {
      await expect(
        db.query(as(m1), "insert into realtime.messages (topic, extension, payload, private) values ($1, 'broadcast', '{}', true)", [`member:${m2}`]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("reports and moderation", () => {
    let leaderThread: string;

    it("captures only the selected messages, visible to moderators only, with every view logged", async () => {
      const conv = await rpc<string>(as(m1), "community_dm_start", [m2]);
      const keep = await rpc<Json>(as(m1), "community_dm_send", [conv, "Synthetic unrelated message", randomUUID()]);
      const bad = await rpc<Json>(as(m1), "community_dm_send", [conv, "Synthetic reported message", randomUUID()]);
      const report = await rpc<string>(as(m2), "community_report", ["message", [bad.id], "harassment", "Synthetic details"]);
      expect(await rpc(as(m2), "community_report", ["message", [bad.id], "harassment", null])).toBe(report);
      await fails(as(leader), "community_mod_report", [report], /wasn't found/);
      await fails(as(m2), "community_mod_report", [report], /wasn't found/);
      const seen = await rpc<Json>(as(moderator), "community_mod_report", [report]);
      const evidence = JSON.stringify(seen.evidence);
      expect(evidence).toContain("Synthetic reported message");
      expect(evidence).not.toContain("Synthetic unrelated message");
      expect(keep.id).toBeTruthy();
      const log = await db.raw<Json>("select action, actor_id from community.moderation_log where report_id = $1", [report]);
      expect(log).toEqual([{ action: "report.viewed", actor_id: moderator }]);
      // Still no general access to the conversation.
      expect(await rpc(as(moderator), "community_dm_messages", [conv, null, null, 40])).toBeNull();
      await rpc(as(moderator), "community_mod_resolve", [report, "actioned", "Spoke with the sender (synthetic)."]);
      expect(JSON.stringify(await db.raw("select * from public.audit_log"))).not.toContain("Synthetic reported message");
    });

    it("sends reports about a group leader to moderators outside the group", async () => {
      leaderThread = await newThread(m2, { group: hiddenGroup, title: "Synthetic thread by a leader" }); // m2 leads hiddenGroup
      // optedOut also leads hiddenGroup; a plain member reports instead.
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, m3, "add_leader"]);
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, m3, "remove_leader_role"]);
      const report = await rpc<string>(as(m3), "community_report", ["thread", [leaderThread], "inappropriate", null]);
      await fails(as(optedOut), "community_mod_report", [report], /wasn't found/);
      expect((await rpc<Json[]>(as(optedOut), "community_mod_reports", ["open", hiddenGroup])).map((r) => r.id)).not.toContain(report);
      await fails(as(optedOut), "community_mod_thread", [leaderThread, "hide", "Leader hiding a leader", report], /community moderator must review/);
      expect((await rpc<Json>(as(moderator), "community_mod_report", [report])).involves_group_leader).toBe(true);
      await rpc(as(moderator), "community_mod_thread", [leaderThread, "hide", "Synthetic moderation reason", report]);
      expect(await rpc(as(m3), "community_thread", [leaderThread, null, null, 30])).toBeNull();
      expect((await notifs(m2)).some((n) => n.kind === "moderation" && n.reason === "Synthetic moderation reason")).toBe(true);
      await rpc(as(moderator), "community_mod_thread", [leaderThread, "restore", "Restored after review", report]);
      expect(await rpc(as(m3), "community_thread", [leaderThread, null, null, 30])).not.toBeNull();
    });

    it("lets leaders moderate ordinary members in their own group", async () => {
      const t = await newThread(m3, { group: hiddenGroup, title: "Synthetic member thread" });
      const p = await rpc<string>(as(optedOut), "community_reply", [t, "Synthetic reply to hide", null]);
      await fails(as(m2), "community_mod_post", [p, "hide", "Leader on leader"], /community moderator/); // optedOut is a leader
      const p2 = await rpc<string>(as(m3), "community_reply", [t, "Synthetic member reply", null]);
      await rpc(as(m2), "community_mod_post", [p2, "hide", "Off topic (synthetic)"]);
      const asMember = await rpc<Json>(as(optedOut), "community_thread", [t, null, null, 30]);
      // optedOut is a leader of this group, so it can see hidden text to restore it.
      expect((asMember.posts as Json[]).find((x) => x.id === p2)!.body).toBe("Synthetic member reply");
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, leader, "add_leader"]);
      await rpc(as(communityAdmin), "community_group_set_member", [hiddenGroup, leader, "remove_leader_role"]);
      const asPlain = await rpc<Json>(as(leader), "community_thread", [t, null, null, 30]);
      expect((asPlain.posts as Json[]).find((x) => x.id === p2)!.body).toBeNull();
    });

    it("applies community restrictions separately from church membership", async () => {
      await fails(as(leader), "community_mod_restrict", [m3, "posting", 7, "Synthetic", null], /permission/);
      const r = await rpc<string>(as(moderator), "community_mod_restrict", [m3, "posting", 7, "Synthetic cooling-off", null]);
      await fails(as(m3), "community_thread_create", [category, null, "Blocked post", "x", null], /posting is paused/);
      expect(await rpc(as(m3), "community_categories")).toBeTruthy(); // still reads
      expect((await db.raw<Json>("select membership_status from public.profiles where id = $1", [m3]))[0].membership_status).toBe("approved");
      await fails(as(moderator), "admin_set_membership_status", [m3, "suspended"], /permission|not allowed/i);
      await rpc(as(moderator), "community_mod_lift_restriction", [r, "Synthetic lift"]);
      expect(await newThread(m3, { title: "Allowed again" })).toBeTruthy();
    });
  });

  describe("notifications, email, digests, quiet hours, and the job", () => {
    const job = () =>
      createCommunityJob(SECRET, async (a) => {
        try {
          const rows = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
          return { data: rows[0].r, error: null };
        } catch (err) {
          return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } };
        }
      });

    const claimAll = async () => {
      const all: Json[] = [];
      for (let i = 0; i < 10; i++) {
        const batch = await job()<Json[]>("email_claim", { limit: 50 });
        all.push(...batch);
        if (batch.length < 50) break;
      }
      return all;
    };

    it("refuses forged job signatures", async () => {
      await expect(db.query(anon, "select public.community_job('tick', '{}', extract(epoch from now())::bigint, repeat('0', 64))")).rejects.toThrow(/Invalid signature/);
      const forged = createCommunityJob("x".repeat(48), async (a) => {
        try {
          const rows = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
          return { data: rows[0].r, error: null };
        } catch (err) {
          return { data: null, error: { message: (err as Error).message } };
        }
      });
      await expect(forged("tick", {})).rejects.toThrow(/Invalid signature/);
    });

    it("queues one immediate email per notification and drops it when access is lost before sending", async () => {
      await rpc(as(m1), "community_set_pref", ["forum", true, "immediate", false]);
      const t = await newThread(m1, { title: "Email test thread" });
      await rpc(as(leader), "community_group_invite", [openGroup, m1]);
      const inv = ((await rpc<Json>(as(m1), "community_groups")).invitations as Json[]).find((i) => (i.group as Json).id === openGroup)!;
      await rpc(as(m1), "community_group_respond", [inv.id, true]);
      const gt = await newThread(m1, { group: openGroup, title: "Synthetic private group title" });
      await rpc(as(leader), "community_reply", [gt, "Reply one", null]);
      await rpc(as(leader), "community_reply", [gt, "Reply two", null]);
      await rpc(as(leader), "community_reply", [t, "Church-wide reply", null]);
      const rows = await db.raw<Json>(
        `select e.dedupe_key from community.email_outbox e join community.notifications n on n.id = e.notification_id
          where e.profile_id = $1 and e.kind = 'immediate' and e.status = 'pending' and n.category = 'forum'`,
        [m1],
      );
      expect(rows).toHaveLength(2); // one per thread, merged replies don't re-email
      await rpc(as(leader), "community_group_set_member", [openGroup, m1, "remove"]);
      const claimed = await claimAll();
      const mine = claimed.filter((c) => c.to === "c.m1@example.test" && (c.items as Json[]).some((i) => i.category === "forum"));
      expect(mine).toHaveLength(1);
      expect(JSON.stringify(mine)).not.toContain("Synthetic private group title");
      expect(JSON.stringify(mine)).toContain("Email test thread");
      for (const c of claimed) await job()("email_result", { id: c.id, status: "sent", provider_id: "test" });
      const skipped = await db.raw<Json>(
        `select count(*)::int n from community.email_outbox e join community.notifications n on n.id = e.notification_id
          where e.profile_id = $1 and e.status = 'skipped' and n.category = 'forum'`,
        [m1],
      );
      expect(skipped[0].n).toBe(1);
      // And the in-app notification for the lost group thread is gone too.
      expect(JSON.stringify(await notifs(m1))).not.toContain("Synthetic private group title");
    });

    it("never puts message text in email", async () => {
      await rpc(as(m2), "community_set_pref", ["messages", true, "immediate", false]);
      const conv = await rpc<string>(as(m1), "community_dm_start", [m2]);
      await rpc(as(m2), "community_dm_mark_read", [conv]);
      await rpc(as(m1), "community_dm_send", [conv, "Synthetic secret words", randomUUID()]);
      const claimed = await claimAll();
      const mail = claimed.find((c) => c.to === "c.m2@example.test" && (c.items as Json[]).some((i) => i.category === "messages"))!;
      expect(JSON.stringify(mail)).not.toContain("Synthetic secret words");
      expect(JSON.stringify(mail)).not.toContain("Alpha");
      expect(JSON.stringify(mail.items)).toContain("You have a new message");
      for (const c of claimed) await job()("email_result", { id: c.id, status: "failed", error: "test" });
      // A failed send is retried later, not lost.
      const row = (await db.raw<Json>("select status, attempts from community.email_outbox where id = $1", [mail.id]))[0];
      expect(row).toEqual({ status: "failed", attempts: 1 });
    });

    it("delays email until quiet hours end, in the member's time zone", async () => {
      const at = await db.raw<{ quiet: Date; normal: Date }>(
        `select community.after_quiet($1, '2026-11-02 04:30:00+00') as quiet,
                community.after_quiet($1, '2026-11-02 18:00:00+00') as normal`,
        [m3],
      );
      expect(at[0].normal.toISOString()).toBe("2026-11-02T18:00:00.000Z"); // no quiet hours yet
      await rpc(as(m3), "community_set_quiet_hours", [true, "21:00", "07:00", "America/Chicago"]);
      const q = await db.raw<{ a: Date; b: Date; c: Date; d: Date }>(
        `select community.after_quiet($1, '2026-11-02 04:30:00+00') as a,  -- 22:30 CST: quiet until 07:00 CST next day
                community.after_quiet($1, '2026-11-02 12:59:00+00') as b,  -- 06:59 CST: still quiet
                community.after_quiet($1, '2026-11-02 13:00:00+00') as c,  -- 07:00 CST: end is exclusive
                community.after_quiet($1, '2026-11-02 02:59:00+00') as d`, // 20:59 CST: before start
        [m3],
      );
      expect(q[0].a.toISOString()).toBe("2026-11-02T13:00:00.000Z");
      expect(q[0].b.toISOString()).toBe("2026-11-02T13:00:00.000Z");
      expect(q[0].c.toISOString()).toBe("2026-11-02T13:00:00.000Z");
      expect(q[0].d.toISOString()).toBe("2026-11-02T02:59:00.000Z");
      // Church time zone is the fallback.
      await rpc(as(m3), "community_set_quiet_hours", [true, "21:00", "07:00", null]);
      expect((await rpc<Json>(as(m3), "community_my_settings")).effective_timezone).toBe("America/Chicago");
      await fails(as(m3), "community_set_quiet_hours", [true, "21:00", "07:00", "Mars/Olympus"], /valid time zone/);
    });

    it("builds one digest per local day with only digest categories, rechecked at send", async () => {
      await db.raw("update community.settings set digest_hour = 0 where id");
      await rpc(as(m3), "community_set_quiet_hours", [false, "21:00", "07:00", null]);
      await rpc(as(m3), "community_set_pref", ["forum", true, "daily", false]);
      const t = await newThread(m3, { title: "Digest synthetic thread" });
      await rpc(as(m1), "community_reply", [t, "Digest reply", null]);
      const first = await job()<Json>("tick", {});
      const second = await job()<Json>("tick", {});
      expect(first.digests).toBeGreaterThanOrEqual(1);
      expect(second.digests).toBe(0);
      const claimed = await claimAll();
      const digest = claimed.find((c) => c.to === "c.m3@example.test" && c.kind === "digest")!;
      expect(JSON.stringify(digest.items)).toContain("Digest synthetic thread");
      for (const c of claimed) await job()("email_result", { id: c.id, status: "sent" });
    });

    it("hides notifications for hidden content and marks all read", async () => {
      const t = await newThread(m1, { title: "Soon hidden synthetic" });
      await rpc(as(m2), "community_reply", [t, "Reply to soon hidden", null]);
      expect((await notifs(m1)).some((n) => String(n.title).includes("Soon hidden synthetic"))).toBe(true);
      await rpc(as(moderator), "community_mod_thread", [t, "hide", "Synthetic", null]);
      expect((await notifs(m1)).some((n) => String(n.title).includes("Soon hidden synthetic"))).toBe(false);
      await rpc(as(m1), "community_notification_read", [null]);
      expect((await unread(m1)).notifications).toBe(0);
    });

    it("mutes a thread's notifications", async () => {
      const t = await newThread(m2, { title: "Muted synthetic thread" });
      await rpc(as(m2), "community_set_mute", ["thread", t, true]);
      await rpc(as(m1), "community_reply", [t, "Nobody hears this", null]);
      expect((await notifs(m2)).some((n) => String(n.title).includes("Muted synthetic thread"))).toBe(false);
    });

    it("click-through returns nothing for content that is no longer available", async () => {
      const t = await newThread(m1, { title: "Click-through synthetic" });
      await rpc(as(m3), "community_reply", [t, "A reply", null]);
      const n = (await notifs(m1)).find((x) => String(x.title).includes("Click-through synthetic"))!;
      expect(await rpc(as(m1), "community_notification_open", [n.id])).toBe(`/community/t/${t}`);
      await rpc(as(m3), "community_reply", [t, "Another", null]);
      const n2 = (await notifs(m1)).find((x) => String(x.title).includes("Click-through synthetic") && !x.read)!;
      await rpc(as(moderator), "community_mod_thread", [t, "hide", "Synthetic", null]);
      expect(await rpc(as(m1), "community_notification_open", [n2.id])).toBeNull();
      expect(await rpc(as(m2), "community_notification_open", [n2.id])).toBeNull(); // not theirs
    });

    it("claims push only with generic text and removes gone subscriptions", async () => {
      await rpc(as(m2), "community_push_subscribe", ["https://push.example.test/sub/1", "p".repeat(40), "a".repeat(16), "Test phone"]);
      await rpc(as(m2), "community_set_pref", ["messages", true, "off", true]);
      const conv = await rpc<string>(as(m1), "community_dm_start", [m2]);
      await rpc(as(m2), "community_dm_mark_read", [conv]);
      await rpc(as(m1), "community_dm_send", [conv, "Synthetic push words", randomUUID()]);
      const claimed = await job()<Json[]>("push_claim", { limit: 10 });
      const push = claimed.find((c) => JSON.stringify(c).includes("push.example.test"))!;
      expect(push.body).toBe("You have a new message.");
      expect(JSON.stringify(push)).not.toContain("Synthetic push words");
      const sub = (push.subscriptions as Json[])[0];
      await job()("push_result", { id: push.id, status: "sent", gone: [sub.id] });
      expect(await db.raw("select * from community.push_subscriptions where profile_id = $1", [m2])).toEqual([]);
    });

    it("purges cleared conversations, old messages, and closed report evidence on schedule", async () => {
      const conv = await rpc<string>(as(m1), "community_dm_start", [m3]);
      await rpc(as(m1), "community_dm_send", [conv, "Synthetic purge me", randomUUID()]);
      await rpc(as(m1), "community_dm_clear", [conv]);
      await job()("tick", {});
      expect((await db.raw<Json>("select count(*)::int n from community.messages where conversation_id = $1", [conv]))[0].n).toBe(1); // m3 still has it
      await rpc(as(m3), "community_dm_clear", [conv]);
      expect(await rpc<Json>(as(m3), "community_dm_messages", [conv, null, null, 40])).toMatchObject({ messages: [] });
      await job()("tick", {});
      expect((await db.raw<Json>("select count(*)::int n from community.messages where conversation_id = $1", [conv]))[0].n).toBe(0);

      const old = await rpc<Json>(as(m1), "community_dm_send", [conv, "Synthetic ancient message", randomUUID()]);
      await db.raw("update community.messages set created_at = now() - interval '800 days' where id = $1", [old.id]);
      await job()("tick", {});
      expect(await db.raw("select 1 from community.messages where id = $1", [old.id])).toEqual([]);

      const closed = await db.raw<{ id: string }>("select id from community.reports where status in ('actioned','dismissed') and evidence is not null limit 1");
      await db.raw("update community.reports set resolved_at = now() - interval '400 days' where id = $1", [closed[0].id]);
      await job()("tick", {});
      const r = (await db.raw<Json>("select evidence, evidence_cleared_at is not null as cleared from community.reports where id = $1", [closed[0].id]))[0];
      expect(r).toEqual({ evidence: null, cleared: true });
    });

    it("rate-limits direct messages on the server", async () => {
      const conv = await rpc<string>(as(m1), "community_dm_start", [m2]);
      await db.raw(
        "insert into community.rate_events (profile_id, action) select $1, 'dm_send' from generate_series(1, 60)",
        [m1],
      );
      await fails(as(m1), "community_dm_send", [conv, "One too many", randomUUID()], /too often/);
    });

    it("hides a blocked sender's messages from unread counts", async () => {
      const conv = await rpc<string>(as(m3), "community_dm_start", [m2]);
      await rpc(as(m2), "community_dm_mark_read", [conv]);
      await rpc(as(m3), "community_dm_send", [conv, "Unread synthetic", randomUUID()]);
      const before = (await unread(m2)).messages;
      expect(before).toBeGreaterThan(0);
      await rpc(as(m2), "community_block", [m3, true]);
      expect((await unread(m2)).messages).toBe(before - 1);
      await rpc(as(m2), "community_block", [m3, false]);
    });

    it("withdraws a group-invitation notification when the invitation is revoked", async () => {
      await rpc(as(leader), "community_group_invite", [openGroup, m1]);
      expect((await notifs(m1)).some((n) => n.kind === "group_invitation")).toBe(true);
      const inv = ((await rpc<Json>(as(m1), "community_groups")).invitations as Json[]).find((i) => (i.group as Json).id === openGroup)!;
      await rpc(as(leader), "community_group_revoke_invitation", [inv.id]);
      expect((await notifs(m1)).some((n) => n.kind === "group_invitation")).toBe(false);
    });

    it("keeps household members out of each other's notification settings", async () => {
      await rpc(as(m1), "community_set_pref", ["groups", false, "off", false]);
      const m3view = await rpc<Json>(as(m3), "community_my_settings");
      expect(((m3view.prefs as Json).groups as Json).in_app).toBe(true);
    });
  });
});
