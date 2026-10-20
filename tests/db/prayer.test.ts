import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 6 prayer and care against a real database: audience isolation
 * (church, group, team, private draft), anonymous display, audience changes
 * and the earlier-comments rule, losing access, prayer acknowledgments,
 * comment locking and moderation scope, identity lookup, care roles,
 * volunteer consent, notifications (access rechecks, generic external
 * wording, reminders), deletion, archive, and retention. Every person and
 * request here is synthetic.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
type Json = Record<string, unknown>;

describeDb("prayer and care", () => {
  let db: TestDb;
  let admin: string; // super administrator: no prayer/care capabilities without a prayer role
  let communityMod: string; // community moderator only
  let leader: string; // group leader (no capability)
  let team: string; // prayer team member
  let prayerMod: string; // prayer moderator without confidential access
  let lead: string; // prayer and care lead (confidential + moderate + identity)
  let coord: string; // care coordinator
  let coord2: string; // second care coordinator
  let careLead: string; // care team lead (assign + all notes)
  let m1: string; // author
  let m2: string; // group member
  let m3: string; // ordinary member outside the group
  let pending: string;
  let suspended: string;
  let group: string;

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
  const create = (author: string, opts: { audience?: string; group?: string | null; title?: string; body?: string; anonymous?: boolean; confirm?: string | null } = {}) => {
    const audience = opts.audience ?? "church";
    return rpc<string>(as(author), "prayer_request_save", [
      null,
      opts.title ?? "Synthetic prayer title",
      opts.body ?? "Synthetic prayer body.",
      audience,
      opts.group ?? null,
      opts.anonymous ?? false,
      true,
      opts.confirm === undefined ? audience : opts.confirm,
      null,
    ]);
  };
  const feed = async (id: string, args: unknown[] = ["feed", "active", "any", null, null, null, 50]) =>
    ((await rpc<Json>(as(id), "prayer_requests", args)).items as Json[]);
  const detail = (id: string, req: string) => rpc<Json>(as(id), "prayer_request", [req, 50]);
  const readable = async (id: string, req: string) => {
    try {
      await detail(id, req);
      return true;
    } catch {
      return false;
    }
  };
  const notifs = async (id: string) => ((await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[]);
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
    for (const c of all) await job()("email_result", { id: c.id, status: "sent", provider_id: "test" });
    return all;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    const mk = async (email: string, name: string, status: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (status !== "pending") await db.setStatus(id, "approved");
      if (status === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("p.admin@example.test", "Synthetic Admin");
    communityMod = await mk("p.cmod@example.test", "Synthetic Community Moderator");
    leader = await mk("p.leader@example.test", "Synthetic Leader");
    team = await mk("p.team@example.test", "Synthetic Team");
    prayerMod = await mk("p.pmod@example.test", "Synthetic Prayer Moderator");
    lead = await mk("p.lead@example.test", "Synthetic Prayer Lead");
    coord = await mk("p.coord@example.test", "Synthetic Coordinator");
    coord2 = await mk("p.coord2@example.test", "Synthetic Coordinator Two");
    careLead = await mk("p.carelead@example.test", "Synthetic Care Lead");
    m1 = await mk("p.m1@example.test", "Alpha Author");
    m2 = await mk("p.m2@example.test", "Bravo Groupmember");
    m3 = await mk("p.m3@example.test", "Charlie Outsider");
    pending = await mk("p.pending@example.test", "Pending Person", "pending");
    suspended = await mk("p.suspended@example.test", "Suspended Person", "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(communityMod, "community_moderator");
    await db.grantRole(team, "prayer_team");
    await db.grantRole(prayerMod, "prayer_moderator");
    await db.grantRole(lead, "prayer_lead");
    await db.grantRole(coord, "care_coordinator");
    await db.grantRole(coord2, "care_coordinator");
    await db.grantRole(careLead, "care_lead");
    await db.raw("update public.profiles set phone = '555-0100' where id = $1", [m1]);
    group = await rpc<string>(as(admin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Prayer Group", summary: "s", about: "a", visibility: "hidden", leader_id: leader }),
    ]);
    for (const id of [m1, m2]) {
      await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    }
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  describe("access", () => {
    it("keeps the prayer schema unreadable and functions closed to visitors, pending, and suspended accounts", async () => {
      await expect(db.query(as(m1), "select * from prayer.requests")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(m1), "select prayer.can_read_id($1, $2)", [randomUUID(), m1])).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.prayer_requests()")).rejects.toThrow(/permission denied/);
      await fails(as(pending), "prayer_requests", [], /approved members/);
      await fails(as(suspended), "prayer_requests", [], /approved members/);
      await fails(as(pending), "care_my_requests", [], /approved members/);
      await fails(as(suspended), "care_request_create", ["meal", "Need a meal", "", null, null, "app", null, false, null], /approved members/);
    });

    it("gives super administrators no implicit prayer or care capabilities", async () => {
      const caps = (await db.query<{ c: string }>(as(admin), "select public.my_capabilities() as c")).map((r) => r.c);
      expect(caps).toContain("community.moderate");
      expect(caps.filter((c) => c.startsWith("prayer.") || c.startsWith("care."))).toEqual([]);
      const leadCaps = (await db.query<{ c: string }>(as(lead), "select public.my_capabilities() as c")).map((r) => r.c);
      expect(leadCaps).toEqual(expect.arrayContaining(["prayer.confidential", "prayer.moderate", "prayer.identity"]));
      expect(leadCaps).not.toContain("care.coordinate");
    });

    it("refuses suspended authors their own requests until reinstated", async () => {
      const id = await create(m3, { title: "Suspension check" });
      await db.setStatus(m3, "suspended");
      await fails(as(m3), "prayer_request", [id, 50], /approved members/);
      await db.setStatus(m3, "approved");
      expect(await readable(m3, id)).toBe(true);
      await rpc(as(m3), "prayer_request_delete", [id]);
    });
  });

  describe("creating, editing, and audiences", () => {
    it("requires confirming the audience before sharing, and keeps drafts private", async () => {
      await fails(as(m1), "prayer_request_save", [null, "Needs confirm", "Body", "church", null, false, true, null, null], /confirm/);
      const draft = await create(m1, { audience: "private", title: "Synthetic private draft", confirm: null });
      expect(await readable(m1, draft)).toBe(true);
      for (const other of [m2, m3, team, lead, admin]) expect(await readable(other, draft)).toBe(false);
      expect((await feed(m1)).some((r) => r.id === draft)).toBe(false);
      expect((await feed(m1, ["mine", "all", "any", null, null, null, 50])).some((r) => r.id === draft)).toBe(true);
      // Publishing is a broadening: it needs confirmation.
      await fails(as(m1), "prayer_request_save", [draft, "Synthetic private draft", "Body", "church", null, false, true, null, null], /confirm/);
      await rpc(as(m1), "prayer_request_save", [draft, "Synthetic private draft", "Body", "church", null, false, true, "church", null]);
      expect(await readable(m3, draft)).toBe(true);
      await rpc(as(m1), "prayer_request_delete", [draft]);
    });

    it("is idempotent for retried submissions and refuses edits by anyone but the author", async () => {
      const key = randomUUID();
      const args = [null, "Retry title", "Retry body", "church", null, false, true, "church", key];
      const a = await rpc<string>(as(m1), "prayer_request_save", args);
      const b = await rpc<string>(as(m1), "prayer_request_save", args);
      expect(a).toBe(b);
      await fails(as(m2), "prayer_request_save", [a, "Hijack", "Body", "church", null, false, true, "church", null], /wasn't found/);
      await fails(as(m2), "prayer_request_delete", [a], /wasn't found/);
      await fails(as(m2), "prayer_request_status", [a, "closed", null], /wasn't found/);
      await rpc(as(m1), "prayer_request_save", [a, "Retry title edited", "Retry body", "church", null, false, true, null, null]);
      expect((await detail(m3, a)).title).toBe("Retry title edited");
      await rpc(as(m1), "prayer_request_delete", [a]);
    });

    it("isolates church, group, team, and private requests across details, lists, counts, and search", async () => {
      const church = await create(m1, { title: "Zebra church request" });
      const grp = await create(m1, { audience: "group", group, title: "Zebra group request" });
      const tm = await create(m1, { audience: "team", title: "Zebra team request" });
      // Group: members only (not the community moderator, super admin, prayer team, or prayer moderator).
      expect(await readable(m2, grp)).toBe(true);
      expect(await readable(leader, grp)).toBe(true); // an active member of the group
      for (const other of [m3, communityMod, admin, team, prayerMod, coord]) expect(await readable(other, grp)).toBe(false);
      // Team: prayer.confidential holders only.
      expect(await readable(team, tm)).toBe(true);
      expect(await readable(lead, tm)).toBe(true);
      for (const other of [m2, m3, admin, communityMod, prayerMod, coord, careLead, leader]) expect(await readable(other, tm)).toBe(false);
      // Lists and search apply the same rule; nothing hidden is returned.
      const search = async (id: string) => (await feed(id, ["feed", "active", "any", "zebra", null, null, 50])).map((r) => r.id);
      expect(await search(m3)).toEqual([church]);
      expect((await search(m2)).sort()).toEqual([church, grp].sort());
      expect((await search(team)).sort()).toEqual([church, tm].sort());
      expect((await search(admin)).sort()).toEqual([church]);
      const teamOnly = (await feed(m3, ["feed", "active", "team", null, null, null, 50])).length;
      expect(teamOnly).toBe(0);
      // Wildcards in search are literal.
      expect(await feed(m3, ["feed", "active", "any", "%", null, null, 50])).toEqual([]);
      for (const id of [church, grp, tm]) await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("only lets members share with active groups they belong to", async () => {
      await fails(as(m3), "prayer_request_save", [null, "Not my group", "Body", "group", group, false, true, "group", null], /your active groups/);
    });

    it("narrows immediately and requires confirmation to widen, withholding earlier comments from the wider audience", async () => {
      const id = await create(m1, { audience: "group", group, title: "Narrow and widen" });
      await rpc(as(m2), "prayer_follow", [id, true]);
      await rpc(as(m2), "prayer_comment_add", [id, "Synthetic group-only encouragement", false, null]);
      await rpc(as(m1), "prayer_update_add", [id, "Synthetic group-only update", false]);
      // Widen group → church: needs confirmation.
      await fails(as(m1), "prayer_request_save", [id, "Narrow and widen", "Body", "church", null, false, true, null, null], /confirm/);
      await rpc(as(m1), "prayer_request_save", [id, "Narrow and widen", "Body", "church", null, false, true, "church", null]);
      const outsider = await detail(m3, id);
      expect(JSON.stringify(outsider)).not.toContain("group-only");
      expect(outsider.withheld).toBe(true);
      expect(outsider.comment_count).toBe(0);
      const insider = await detail(m2, id);
      expect(JSON.stringify(insider)).toContain("Synthetic group-only encouragement");
      expect(JSON.stringify(insider)).toContain("Synthetic group-only update");
      // New comments under the wider audience are visible to everyone in it.
      await rpc(as(m3), "prayer_comment_add", [id, "Church-wide encouragement", false, null]);
      expect(JSON.stringify(await detail(m2, id))).toContain("Church-wide encouragement");
      // Narrow church → private: immediate, no confirmation, follows cleaned.
      await rpc(as(m3), "prayer_follow", [id, true]);
      await rpc(as(m1), "prayer_request_save", [id, "Narrow and widen", "Body", "private", null, false, true, null, null]);
      expect(await readable(m3, id)).toBe(false);
      expect(await readable(m2, id)).toBe(false);
      const follows = await db.raw<{ n: number }>("select count(*)::int n from prayer.follows where request_id = $1 and profile_id <> $2", [id, m1]);
      expect(follows[0].n).toBe(0);
      // Audit records the change without content.
      const audit = await db.raw<Json>("select details from public.audit_log where target_id = $1 and action = 'prayer.audience_changed'", [id]);
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit)).not.toContain("Narrow and widen");
      await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("ends access when a member leaves the group or loses the prayer team role", async () => {
      const grp = await create(m1, { audience: "group", group, title: "Leaving check" });
      await rpc(as(m2), "prayer_follow", [grp, true]);
      await rpc(as(leader), "community_group_set_member", [group, m2, "remove"]);
      expect(await readable(m2, grp)).toBe(false);
      expect((await db.raw<{ n: number }>("select count(*)::int n from prayer.follows where request_id = $1 and profile_id = $2", [grp, m2]))[0].n).toBe(0);
      await db.raw("update community.group_members set state = 'active', ended_at = null, ended_by = null where group_id = $1 and profile_id = $2", [group, m2]);
      expect(await readable(m2, grp)).toBe(true);

      const tm = await create(m1, { audience: "team", title: "Role loss check" });
      const extra = await db.createAuthUser("p.temp@example.test", { fullName: "Temporary Team" });
      await db.setStatus(extra, "approved");
      await db.grantRole(extra, "prayer_team");
      expect(await readable(extra, tm)).toBe(true);
      await rpc(as(extra), "prayer_follow", [tm, true]);
      await db.raw("delete from public.user_roles where user_id = $1 and role_key = 'prayer_team'", [extra]);
      expect(await readable(extra, tm)).toBe(false);
      expect((await db.raw<{ n: number }>("select count(*)::int n from prayer.follows where profile_id = $1", [extra]))[0].n).toBe(0);
      for (const id of [grp, tm]) await rpc(as(m1), "prayer_request_delete", [id]);
    });
  });

  describe("anonymous display", () => {
    it("never returns the author's identity to readers, in responses, notifications, or realtime payloads", async () => {
      await db.raw("delete from realtime.messages");
      const id = await create(m1, { title: "Synthetic anonymous request", anonymous: true });
      await rpc(as(m2), "prayer_follow", [id, true]);
      await rpc(as(m1), "prayer_comment_add", [id, "Requester speaking anonymously", false, null]);
      await rpc(as(m1), "prayer_update_add", [id, "Requester update", false]);
      const view = await detail(m2, id);
      const text = JSON.stringify(view);
      expect(view.author).toBe("Anonymous");
      expect(text).not.toContain("Alpha");
      expect(text).not.toContain(m1);
      const comment = (view.comments as Json[])[0];
      expect(comment.author).toBe("The requester");
      expect(comment.is_requester).toBe(true);
      expect(((view.updates as Json[])[0]).author).toBe("The requester");
      const list = JSON.stringify(await feed(m2));
      expect(list).not.toContain("Alpha");
      expect(list).not.toContain(m1);
      expect(JSON.stringify(await notifs(m2))).not.toContain("Alpha");
      const rt = await db.raw<Json>("select payload from realtime.messages");
      expect(rt.length).toBeGreaterThan(0);
      for (const r of rt) expect(Object.keys(r.payload as Json)).toEqual(["kind"]);
      expect(JSON.stringify(rt)).not.toContain(m1);
      // A named comment by the requester shows the name but isn't labelled as the requester.
      await rpc(as(m1), "prayer_comment_add", [id, "Requester speaking by name", true, null]);
      const named = ((await detail(m2, id)).comments as Json[]).find((c) => c.body === "Requester speaking by name")!;
      expect(named.author).toBe("Alpha Author");
      expect(named.is_requester).toBe(false);
      // Reports don't reveal the anonymous author to reviewers.
      const rep = await rpc<string>(as(m2), "prayer_report", ["request", id, "privacy", "Synthetic note"]);
      const seen = await rpc<Json>(as(prayerMod), "prayer_mod_report", [rep]);
      expect(seen.reported).toBe("Anonymous");
      expect(JSON.stringify(seen)).not.toContain("Alpha");
      await rpc(as(prayerMod), "prayer_mod_resolve", [rep, "dismissed", "Synthetic resolution"]);
      await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("lets only identity-lookup holders reveal the author, with a recorded reason and no content in the logs", async () => {
      const id = await create(m1, { title: "Synthetic lookup request", anonymous: true });
      await fails(as(prayerMod), "prayer_identity_lookup", [id, "Need to follow up on safety"], /permission/);
      await fails(as(team), "prayer_identity_lookup", [id, "Need to follow up on safety"], /permission/);
      await fails(as(admin), "prayer_identity_lookup", [id, "Need to follow up on safety"], /permission/);
      await fails(as(lead), "prayer_identity_lookup", [id, "short"], /at least 10/);
      const found = await rpc<Json>(as(lead), "prayer_identity_lookup", [id, "Safety follow-up requested by pastor"]);
      expect(found).toEqual({ name: "Alpha Author" });
      const access = await db.raw<Json>("select action, reason from prayer.access_log where target_id = $1 and action = 'identity_lookup'", [id]);
      expect(access).toHaveLength(1);
      const audit = await db.raw<Json>("select * from public.audit_log where target_id = $1 and action = 'prayer.identity_lookup'", [id]);
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("Synthetic lookup request");
      // Not for named requests, and not outside the lead's scope (a group they aren't in).
      const named = await create(m1, { title: "Named" });
      await fails(as(lead), "prayer_identity_lookup", [named, "Safety follow-up requested by pastor"], /wasn't found/);
      const grp = await create(m1, { audience: "group", group, title: "Group anon", anonymous: true });
      await fails(as(lead), "prayer_identity_lookup", [grp, "Safety follow-up requested by pastor"], /wasn't found/);
      for (const r of [id, named, grp]) await rpc(as(m1), "prayer_request_delete", [r]);
    });
  });

  describe("prayers, comments, locking, and moderation", () => {
    it("counts one prayer per member, removable, with no names", async () => {
      const id = await create(m1, { title: "Prayer count" });
      await rpc(as(m2), "prayer_pray", [id, true]);
      const again = await rpc<Json>(as(m2), "prayer_pray", [id, true]);
      expect(again).toEqual({ count: 1, praying: true });
      await rpc(as(m3), "prayer_pray", [id, true]);
      expect((await detail(m1, id)).prayer_count).toBe(2);
      expect(await rpc<Json>(as(m3), "prayer_pray", [id, false])).toEqual({ count: 1, praying: false });
      expect(JSON.stringify(await detail(m1, id))).not.toContain("Bravo");
      await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("lets authors lock comments, edit and delete their own comments, and leaves deleted placeholders", async () => {
      const id = await create(m1, { title: "Comment rules" });
      const c = await rpc<string>(as(m2), "prayer_comment_add", [id, "First encouragement", false, null]);
      await fails(as(m3), "prayer_comment_edit", [c, "Hijacked"], /wasn't found/);
      await fails(as(m3), "prayer_comment_delete", [c], /wasn't found/);
      await rpc(as(m2), "prayer_comment_edit", [c, "Edited encouragement"]);
      await rpc(as(m1), "prayer_set_comments", [id, false]);
      await fails(as(m3), "prayer_comment_add", [id, "Blocked", false, null], /closed/);
      await rpc(as(m1), "prayer_set_comments", [id, true]);
      await rpc(as(m2), "prayer_comment_delete", [c]);
      const comments = (await detail(m3, id)).comments as Json[];
      expect(comments[0]).toMatchObject({ status: "deleted", body: null, author: null });
      const row = await db.raw<{ body: string }>("select body from prayer.comments where id = $1", [c]);
      expect(row[0].body).toBe("");
      await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("scopes moderation: reports only, team reports need confidential access, community moderators see nothing", async () => {
      const church = await create(m1, { title: "Moderation church" });
      const bad = await rpc<string>(as(m3), "prayer_comment_add", [church, "Synthetic unkind comment", false, null]);
      const rep = await rpc<string>(as(m2), "prayer_report", ["comment", bad, "inappropriate", null]);
      expect((await rpc<Json[]>(as(prayerMod), "prayer_mod_reports", ["open"])).map((r) => r.id)).toContain(rep);
      await fails(as(communityMod), "prayer_mod_reports", ["open"], /permission/);
      await fails(as(admin), "prayer_mod_report", [rep], /permission/);
      const seen = await rpc<Json>(as(prayerMod), "prayer_mod_report", [rep]);
      expect((seen.evidence as Json).body).toBe("Synthetic unkind comment");
      expect(JSON.stringify(seen.evidence)).not.toContain("Moderation church"); // only the reported item
      await fails(as(prayerMod), "prayer_mod_action", ["comment", bad, "hide", "", rep], /reason/);
      await rpc(as(prayerMod), "prayer_mod_action", ["comment", bad, "hide", "Unkind", rep]);
      expect(JSON.stringify(await detail(m2, church))).not.toContain("Synthetic unkind comment");
      await rpc(as(prayerMod), "prayer_mod_action", ["request", church, "lock", "Cooling off", rep]);
      await fails(as(m2), "prayer_comment_add", [church, "After lock", false, null], /closed/);
      await rpc(as(prayerMod), "prayer_mod_resolve", [rep, "actioned", "Hidden and locked"]);
      expect((await notifs(m3)).some((n) => n.kind === "prayer_moderation")).toBe(true);

      // A group request: the prayer moderator can act only through a report about it.
      const grp = await create(m1, { audience: "group", group, title: "Moderation group" });
      await fails(as(prayerMod), "prayer_mod_action", ["request", grp, "lock", "No report", null], /permission/);
      const grpRep = await rpc<string>(as(m2), "prayer_report", ["request", grp, "spam", null]);
      await rpc(as(prayerMod), "prayer_mod_action", ["request", grp, "hide", "Spam", grpRep]);
      expect(await readable(m2, grp)).toBe(false);
      expect(await readable(m1, grp)).toBe(true); // the author keeps access, with a notice
      expect((await detail(m1, grp)).hidden).toBe(true);
      // The report never opens other group requests.
      const other = await create(m1, { audience: "group", group, title: "Other group request" });
      await fails(as(prayerMod), "prayer_mod_action", ["request", other, "hide", "Spam", grpRep], /permission/);
      expect(await readable(prayerMod, other)).toBe(false);

      // A team request: only moderators with confidential access can review.
      const tm = await create(m1, { audience: "team", title: "Moderation team" });
      const tmRep = await rpc<string>(as(team), "prayer_report", ["request", tm, "privacy", null]);
      expect((await rpc<Json[]>(as(prayerMod), "prayer_mod_reports", ["open"])).map((r) => r.id)).not.toContain(tmRep);
      await fails(as(prayerMod), "prayer_mod_report", [tmRep], /wasn't found/);
      expect((await rpc<Json>(as(lead), "prayer_mod_report", [tmRep])).audience).toBe("team");
      for (const id of [church, grp, other, tm]) await rpc(as(m1), "prayer_request_delete", [id]);
    });

    it("rate-limits comments", async () => {
      const id = await create(m1, { title: "Rate limit" });
      for (let i = 0; i < 20; i++) await rpc(as(m2), "prayer_comment_add", [id, `Comment ${i}`, false, null]);
      await fails(as(m2), "prayer_comment_add", [id, "One too many", false, null], /too often/);
      await rpc(as(m1), "prayer_request_delete", [id]);
    });
  });

  describe("status, archive, and deletion", () => {
    it("archives to author-only, requires confirmation to restore, and deletes everything on author deletion", async () => {
      const id = await create(m1, { title: "Archive me" });
      await rpc(as(m2), "prayer_follow", [id, true]);
      await rpc(as(m2), "prayer_comment_add", [id, "Comment before archive", false, null]);
      await rpc(as(m1), "prayer_request_status", [id, "answered", null]);
      expect((await feed(m3, ["answered", "active", "any", null, null, null, 50])).some((r) => r.id === id)).toBe(true);
      await rpc(as(m1), "prayer_request_status", [id, "archived", null]);
      expect(await readable(m2, id)).toBe(false);
      expect(await readable(m1, id)).toBe(true);
      await fails(as(m1), "prayer_request_status", [id, "open", null], /confirm/);
      await rpc(as(m1), "prayer_request_status", [id, "open", "church"]);
      expect(await readable(m2, id)).toBe(true);
      const rep = await rpc<string>(as(m2), "prayer_report", ["request", id, "other", null]);
      await rpc(as(prayerMod), "prayer_mod_resolve", [rep, "dismissed", "Nothing wrong"]);
      await rpc(as(m1), "prayer_request_delete", [id]);
      const left = await db.raw<{ n: number }>(
        `select (select count(*) from prayer.comments where request_id = $1) + (select count(*) from prayer.follows where request_id = $1)
              + (select count(*) from community.notifications where prayer_request_id = $1) as n`,
        [id],
      );
      expect(Number(left[0].n)).toBe(0);
      const report = await db.raw<Json>("select evidence, evidence_cleared_at from prayer.reports where id = $1", [rep]);
      expect(report[0].evidence).toBeNull();
      expect(report[0].evidence_cleared_at).not.toBeNull();
    });

    it("keeps retention off until the church enables it", async () => {
      const id = await create(m1, { title: "Retention" });
      await rpc(as(m1), "prayer_request_status", [id, "closed", null]);
      await db.raw("update prayer.requests set closed_at = now() - interval '400 days' where id = $1", [id]);
      await job()("tick", {});
      expect((await db.raw<Json>("select status from prayer.requests where id = $1", [id]))[0].status).toBe("closed");
      await fails(as(m1), "prayer_admin_save_settings", ["x", true, 90, 365, 365, 90], /permission/);
      const s = await rpc<Json>(as(admin), "prayer_admin_settings");
      expect(s.retention_enabled).toBe(false);
      await rpc(as(admin), "prayer_admin_save_settings", [s.guidance, true, 90, 365, 365, 90]);
      await job()("tick", {});
      expect((await db.raw<Json>("select status from prayer.requests where id = $1", [id]))[0].status).toBe("archived");
      await rpc(as(admin), "prayer_admin_save_settings", [s.guidance, false, 90, 365, 365, 90]);
      await rpc(as(m1), "prayer_request_delete", [id]);
    });
  });

  describe("notifications", () => {
    it("notifies followers in the app, rechecks access before delivery, and keeps email generic", async () => {
      await rpc(as(m2), "community_set_pref", ["prayer", true, "immediate", false]);
      const id = await create(m1, { audience: "group", group, title: "Synthetic secret title" });
      await rpc(as(m2), "prayer_follow", [id, true]);
      await rpc(as(leader), "prayer_comment_add", [id, "Synthetic secret comment", false, null]);
      await rpc(as(leader), "prayer_comment_add", [id, "Another", false, null]);
      const inApp = (await notifs(m2)).filter((n) => n.kind === "prayer_comment");
      expect(inApp).toHaveLength(1); // merged
      expect(inApp[0].title).toContain("Synthetic secret title");
      const prayerMail = (c: Json) => (c.items as Json[]).some((i) => i.category === "prayer");
      const mail = (await claimAll()).filter((c) => c.to === "p.m2@example.test" && prayerMail(c));
      expect(mail).toHaveLength(1);
      const text = JSON.stringify(mail);
      expect(text).not.toContain("Synthetic secret");
      expect(text).not.toContain("Leader");
      expect(text).toContain("/notifications/open/");

      // Lose access before the next send: the queued email is skipped and the notice disappears.
      await rpc(as(m1), "prayer_update_add", [id, "Synthetic secret update", false]);
      await rpc(as(leader), "community_group_set_member", [group, m2, "remove"]);
      const after = (await claimAll()).filter((c) => c.to === "p.m2@example.test" && prayerMail(c));
      expect(after).toHaveLength(0);
      const skipped = await db.raw<{ n: number }>(
        `select count(*)::int n from community.email_outbox e join community.notifications n on n.id = e.notification_id
          where e.profile_id = $1 and e.status = 'skipped' and n.kind = 'prayer_update'`,
        [m2],
      );
      expect(skipped[0].n).toBe(1); // queued, then dropped at claim time
      expect((await notifs(m2)).some((n) => n.kind === "prayer_update")).toBe(false);
      await db.raw("update community.group_members set state = 'active', ended_at = null, ended_by = null where group_id = $1 and profile_id = $2", [group, m2]);
      await rpc(as(m1), "prayer_request_delete", [id]);
      await rpc(as(m2), "community_set_pref", ["prayer", true, "off", false]);
    });

    it("drops queued notices when a request narrows", async () => {
      await rpc(as(m3), "community_set_pref", ["prayer", true, "immediate", false]);
      const id = await create(m1, { title: "Narrow notices" });
      await rpc(as(m3), "prayer_follow", [id, true]);
      await rpc(as(m2), "prayer_comment_add", [id, "Hello", false, null]);
      expect((await notifs(m3)).some((n) => n.kind === "prayer_comment")).toBe(true);
      await rpc(as(m1), "prayer_request_save", [id, "Narrow notices", "Body", "group", group, false, true, null, null]);
      expect((await notifs(m3)).some((n) => n.kind === "prayer_comment")).toBe(false);
      const queued = await db.raw<{ n: number }>(
        "select count(*)::int n from community.email_outbox where profile_id = $1 and status = 'pending'",
        [m3],
      );
      expect(queued[0].n).toBe(0);
      await rpc(as(m1), "prayer_request_delete", [id]);
      await rpc(as(m3), "community_set_pref", ["prayer", true, "off", false]);
    });
  });

  describe("practical care", () => {
    let care: string;

    it("keeps care requests between the requester and the care team", async () => {
      await fails(as(m1), "care_request_create", ["meal", "Meals", "", null, null, "fax", null, false, null], /contact/);
      care = await rpc<string>(as(m1), "care_request_create", [
        "meal", "Synthetic meal need", "Synthetic care details", "2026-11-01", "2026-11-03", "phone", "Evenings", false, null,
      ]);
      expect((await rpc<Json>(as(m1), "care_request", [care])).summary).toBe("Synthetic meal need");
      for (const other of [m2, team, lead, admin, communityMod]) {
        await fails(as(other), "care_request", [care], /wasn't found/);
        await fails(as(other), "care_team_request", [care], /permission/);
      }
      const seen = await rpc<Json>(as(coord), "care_team_request", [care]);
      expect(seen.contact).toBe("555-0100"); // the requester chose phone
      expect(seen.notes).toBeNull(); // not assigned: no internal notes
      expect((await rpc<Json>(as(coord), "care_team_queue", ["unassigned"])).items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: care })]),
      );
      // Not a prayer request, never in the feed.
      expect(JSON.stringify(await feed(m2))).not.toContain("Synthetic meal need");
    });

    it("assigns, keeps internal notes from the requester and unassigned coordinators, and records activity without text", async () => {
      await fails(as(coord), "care_team_assign", [care, coord], /permission/);
      await rpc(as(careLead), "care_team_assign", [care, coord]);
      expect((await notifs(coord)).some((n) => n.kind === "care_assigned")).toBe(true);
      await rpc(as(coord), "care_team_note", [care, "Synthetic internal note"]);
      await fails(as(coord2), "care_team_note", [care, "Not assigned"], /assigned coordinator/);
      expect((await rpc<Json>(as(coord2), "care_team_request", [care])).notes).toBeNull();
      expect(JSON.stringify(await rpc<Json>(as(careLead), "care_team_request", [care]))).toContain("Synthetic internal note");
      expect(JSON.stringify(await rpc<Json>(as(m1), "care_request", [care]))).not.toContain("Synthetic internal note");
      await fails(as(coord2), "care_team_update", [care, "coordinating", null, null], /assigned to you/);
      await rpc(as(coord), "care_message", [care, "Synthetic coordinator response"]);
      await rpc(as(coord), "care_team_update", [care, "coordinating", "2020-01-01", null]);
      const mine = await rpc<Json>(as(m1), "care_request", [care]);
      expect(mine.status).toBe("coordinating");
      expect(JSON.stringify(mine.messages)).toContain("Synthetic coordinator response");
      expect((await notifs(m1)).some((n) => n.kind === "care_response")).toBe(true);
      const activity = await db.raw<Json>("select action, detail from prayer.care_activity where care_id = $1", [care]);
      expect(activity.map((a) => a.action)).toEqual(expect.arrayContaining(["assigned", "note_added", "team_responded", "status_changed"]));
      expect(JSON.stringify(activity)).not.toContain("Synthetic");
    });

    it("sends one follow-up reminder per date through the existing scheduler tick", async () => {
      await job()("tick", {});
      await job()("tick", {});
      const reminders = (await notifs(coord)).filter((n) => n.kind === "care_follow_up");
      expect(reminders).toHaveLength(1);
      const mail = (await claimAll()).filter((c) => c.to === "p.coord@example.test");
      expect(JSON.stringify(mail)).not.toContain("Synthetic meal need");
    });

    it("needs requester consent before sharing logistics with accepted volunteers", async () => {
      const opp = await rpc<string>(as(coord), "care_opportunity_save", [
        JSON.stringify({
          care_id: care, title: "Deliver a meal", details: "One dinner", starts_at: "2026-11-01T23:00:00Z",
          helpers_needed: 1, audience: "church", logistics: "Synthetic 12 Example Street", share_name: true,
        }),
      ]);
      const preview = await rpc<Json>(as(coord), "care_opportunity_preview", [opp]);
      expect(preview.blocked).toBe(true);
      expect(JSON.stringify(preview.listing)).not.toContain("Example Street");
      await fails(as(coord), "care_opportunity_publish", [opp, true], /hasn't agreed/);
      await rpc(as(m1), "care_set_consent", [care, true]);
      await fails(as(coord), "care_opportunity_publish", [opp, false], /confirm/);
      await rpc(as(coord), "care_opportunity_publish", [opp, true]);
      // Members see a generic listing: no request text, notes, phone, or address.
      const list = JSON.stringify(await rpc<Json[]>(as(m2), "care_opportunities"));
      expect(list).toContain("Deliver a meal");
      for (const secret of ["Synthetic meal need", "Synthetic care details", "Synthetic internal note", "555-0100", "Example Street", "Alpha"]) {
        expect(list).not.toContain(secret);
      }
      await rpc(as(m2), "care_volunteer", [opp, true, "Happy to help"]);
      expect(JSON.stringify(await rpc<Json>(as(m2), "care_opportunity", [opp]))).not.toContain("Example Street");
      await fails(as(m2), "care_signup_decide", [opp, m2, "accept"], /permission/);
      await rpc(as(coord), "care_signup_decide", [opp, m2, "accept"]);
      expect((await notifs(m2)).some((n) => n.kind === "care_volunteer")).toBe(true);
      const accepted = await rpc<Json>(as(m2), "care_opportunity", [opp]);
      expect((accepted.private as Json).logistics).toBe("Synthetic 12 Example Street");
      expect((accepted.private as Json).requester_first_name).toBe("Alpha");
      // Withdrawing consent hides them at once.
      await rpc(as(m1), "care_set_consent", [care, false]);
      const withdrawn = await rpc<Json>(as(m2), "care_opportunity", [opp]);
      expect((withdrawn.private as Json).logistics).toBeNull();
      expect((withdrawn.private as Json).requester_first_name).toBeNull();
      // Other members never see the private part.
      expect(JSON.stringify(await rpc<Json[]>(as(m3), "care_opportunities"))).not.toContain("Example Street");
      await rpc(as(coord), "care_signup_decide", [opp, m2, "complete"]);
    });

    it("unassigns a coordinator who loses the role, and lets the requester withdraw", async () => {
      await db.raw("delete from public.user_roles where user_id = $1 and role_key = 'care_coordinator'", [coord]);
      expect((await db.raw<Json>("select assigned_to from prayer.care_requests where id = $1", [care]))[0].assigned_to).toBeNull();
      await fails(as(coord), "care_team_request", [care], /permission/);
      await db.grantRole(coord, "care_coordinator");
      await rpc(as(m1), "care_request_withdraw", [care]);
      const mine = await rpc<Json>(as(m1), "care_request", [care]);
      expect(mine).toMatchObject({ status: "closed", closed_reason: "withdrawn" });
      await fails(as(m1), "care_message", [care, "After close"], /closed/);
    });
  });

  it("never copies request, comment, care, or note text into audit, access, moderation, or activity logs", async () => {
    const logs = await db.raw<Json>(
      `select (select coalesce(jsonb_agg(a), '[]') from public.audit_log a) as audit,
              (select coalesce(jsonb_agg(l), '[]') from prayer.access_log l) as access,
              (select coalesce(jsonb_agg(m), '[]') from prayer.moderation_log m) as moderation,
              (select coalesce(jsonb_agg(c), '[]') from prayer.care_activity c) as activity`,
    );
    const text = JSON.stringify(logs);
    for (const secret of ["Synthetic secret", "Synthetic prayer body", "Synthetic care details", "Synthetic internal note", "Synthetic unkind comment"]) {
      expect(text).not.toContain(secret);
    }
  });
});
