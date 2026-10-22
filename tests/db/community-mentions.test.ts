import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCommunityJob } from "@/lib/community/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * @mentions in Community posts and comments (20261107000100): who can be
 * suggested and saved (directory listing, group audience, pending,
 * suspended, youth, blocked, forged ids), the mention records kept by the
 * save triggers, notifications (once per post or comment, never for the
 * author, retries, edits, remove/re-add, reply overlap), the rechecks on
 * read and delivery (hidden, deleted, removed from the group, blocked), and
 * the generic email and push wording. Every person, post, and notification
 * destination is synthetic; email and push are only claimed, never sent.
 */
type Json = Record<string, unknown>;
const SECRET = "test-events-job-secret-0123456789abcdef012345";
const tag = (name: string, id: string) => `@[${name}](mention:${id})`;

describeDb("community mentions", () => {
  let db: TestDb;
  let rob: string; // author
  let ann: string;
  let ben: string;
  let ann2: string; // same name as ann, different city
  let optedOut: string;
  let pending: string;
  let suspended: string;
  let youth: string;
  let blocker: string; // blocks rob
  let outsider: string; // not in the group
  let leader: string;
  let moderator: string;
  let category: string;
  let group: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const ack = async (id: string) => {
    const g = await rpc<Json>(as(id), "community_guidelines");
    await rpc(as(id), "community_ack_guidelines", [g.version]);
  };
  const fresh = () => db.raw("delete from community.rate_events");
  const post = async (author: string, body: string, opts: { group?: string } = {}) => {
    await fresh();
    return rpc<string>(as(author), "community_thread_create", [opts.group ? null : category, opts.group ?? null, "Synthetic mention post", body, randomUUID()]);
  };
  const comment = async (author: string, thread: string, body: string, key: string = randomUUID()) => {
    await fresh();
    return rpc<string>(as(author), "community_reply", [thread, body, key]);
  };
  const search = (who: string, q: string, place: { thread?: string; category?: string; group?: string }) =>
    rpc<Array<Json>>(as(who), "community_mention_search", [q, place.thread ?? null, place.category ?? null, place.group ?? null]);
  const notifs = async (id: string) => (await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[];
  const mentionNotices = async (id: string) => (await notifs(id)).filter((n) => n.kind === "mention");
  const rows = (thread: string, post: string | null = null) =>
    db.raw<Json>("select profile_id, removed_at, notified_at from community.mentions where target_id = $1 order by created_at, profile_id", [post ?? thread]);
  const threadBody = async (id: string) => (await db.raw<{ body: string }>("select body from community.threads where id = $1", [id]))[0].body;

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1) on conflict (name) do update set value = excluded.value", [SECRET]);
    const mk = async (email: string, name: string, status: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (status !== "pending") await db.setStatus(id, status);
      return id;
    };
    rob = await mk("m.rob@example.test", "Rob Webb");
    ann = await mk("m.ann@example.test", "Ann Rivers");
    ann2 = await mk("m.ann2@example.test", "Ann Rivers");
    ben = await mk("m.ben@example.test", "Ben Rowe");
    optedOut = await mk("m.optout@example.test", "Rory Hidden");
    pending = await mk("m.pending@example.test", "Robin Pending", "pending");
    suspended = await mk("m.suspended@example.test", "Roberta Suspended");
    youth = await mk("m.youth@example.test", "Robbie Youth");
    blocker = await mk("m.blocker@example.test", "Rosa Blocker");
    outsider = await mk("m.outsider@example.test", "Ronan Outsider");
    leader = await mk("m.leader@example.test", "Lena Leader");
    moderator = await mk("m.mod@example.test", "Mona Moderator");
    const cadmin = await mk("m.cadmin@example.test", "Cal Admin");
    await db.grantRole(moderator, "community_moderator");
    await db.grantRole(cadmin, "community_admin");
    await db.raw("update public.member_profile_details set city = 'Springfield', state_region = 'IL' where profile_id = $1", [ann]);
    await db.raw("update public.member_profile_details set city = 'Shelbyville', state_region = 'IL' where profile_id = $1", [ann2]);
    await db.raw("update public.member_profile_details set directory_listed = false where profile_id = $1", [optedOut]);
    await db.raw("update public.profiles set phone = '555-0100' where id = $1", [ann]);
    await db.setStatus(suspended, "suspended");
    // Youth accounts can only be marked inside the youth functions' context.
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youth]);
    await db.raw("select set_config('youth.context', '', false)");
    for (const id of [rob, ann, ann2, ben, optedOut, blocker, outsider, leader, moderator]) await ack(id);
    await rpc(as(blocker), "community_block", [rob, true]).catch(async () => {
      // DM eligibility isn't needed to block; fall back to a direct row if the function asks for more.
      await db.raw("insert into community.blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [blocker, rob]);
    });
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    group = await rpc<string>(as(cadmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Mention Group", summary: "Summary", about: "About", visibility: "hidden", leader_id: leader }),
    ]);
    for (const id of [rob, ann]) {
      await db.raw("insert into community.group_members (group_id, profile_id, role) values ($1, $2, 'member') on conflict do nothing", [group, id]);
    }
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("suggestions", () => {
    it("lists only listed, approved adults the author may mention, never contact details", async () => {
      const names = (await search(rob, "ro", { category })).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(["Ben Rowe", "Ronan Outsider"]));
      // Not the author, pending, suspended, youth, opted out, or someone who blocked them.
      for (const hidden of ["Rob Webb", "Robin Pending", "Roberta Suspended", "Robbie Youth", "Rory Hidden", "Rosa Blocker"]) {
        expect(names).not.toContain(hidden);
      }
      const [first] = await search(rob, "ann", { category });
      expect(Object.keys(first).sort()).toEqual(["detail", "id", "name", "photo_path"]);
      expect(JSON.stringify(await search(rob, "ann", { category }))).not.toMatch(/example\.test|555-0100/);
      // The blocked person can't find the blocker either.
      expect((await search(blocker, "rob", { category })).map((r) => r.name)).not.toContain("Rob Webb");
    });

    it("tells people with the same name apart only by what they share in the directory", async () => {
      const anns = await search(rob, "Ann R", { category });
      expect(anns.map((a) => a.name)).toEqual(["Ann Rivers", "Ann Rivers"]);
      expect(anns.map((a) => a.detail).sort()).toEqual(["Shelbyville, IL", "Springfield, IL"]);
      await db.raw("update public.member_profile_details set show_city_state = false where profile_id = $1", [ann2]);
      expect((await search(rob, "Ann R", { category })).map((a) => a.detail).sort()).toEqual(["Springfield, IL", null]);
      await db.raw("update public.member_profile_details set show_city_state = true where profile_id = $1", [ann2]);
    });

    it("limits a group post to that group's members, and only for members of it", async () => {
      expect((await search(rob, "r", { group })).map((r) => r.name)).toEqual(["Ann Rivers", "Lena Leader"]);
      const t = await post(rob, "Group post", { group });
      expect((await search(rob, "ann", { thread: t })).map((r) => r.id)).toEqual([ann]);
      expect(await search(outsider, "ann", { group })).toEqual([]);
      expect(await search(outsider, "ann", { thread: t })).toEqual([]);
      await expect(rpc(anon, "community_mention_search", ["ann", null, category, null])).rejects.toThrow();
      await expect(rpc(as(pending), "community_mention_search", ["ann", null, category, null])).rejects.toThrow(/approved members/);
    });

    it("returns a bounded list and nothing without a place or a query", async () => {
      for (let i = 0; i < 10; i++) await db.createAuthUser(`m.bulk${i}@example.test`, { fullName: `Bulk Person ${i}` }).then((id) => db.setStatus(id, "approved"));
      expect(await search(rob, "Bulk", { category })).toHaveLength(8);
      expect(await search(rob, "", { category })).toEqual([]);
      expect(await search(rob, "ann", {})).toEqual([]);
    });
  });

  describe("saving and notifying", () => {
    it("records a post mention by id and notifies the member once", async () => {
      const t = await post(rob, `Thanks ${tag("Ann Rivers", ann)} and ${tag("Ben Rowe", ben)}! Write to rob@example.test.`);
      expect((await rows(t)).map((r) => r.profile_id).sort()).toEqual([ann, ben].sort());
      const [n] = await mentionNotices(ann);
      expect(n).toMatchObject({ category: "mentions", title: "Rob Webb mentioned you in Community", url: `/community/t/${t}` });
      expect(await rpc(as(ann), "community_notification_open", [n.id])).toBe(`/community/t/${t}`);
      // The email address stays plain text: nobody else was recorded.
      expect(await rows(t)).toHaveLength(2);
      expect(await mentionNotices(rob)).toEqual([]);
    });

    it("keeps duplicate names apart by id", async () => {
      const t = await post(rob, `${tag("Ann Rivers", ann2)} only`);
      expect((await rows(t)).map((r) => r.profile_id)).toEqual([ann2]);
      expect((await mentionNotices(ann2)).map((n) => n.url)).toContain(`/community/t/${t}`);
      expect((await mentionNotices(ann)).map((n) => n.url)).not.toContain(`/community/t/${t}`);
    });

    it("turns forged or ineligible mentions into plain text and never notifies them", async () => {
      const forged = randomUUID();
      const body = [ann, optedOut, pending, suspended, youth, blocker, forged, rob].map((id) => tag("Someone Else", id)).join(" ");
      const t = await post(rob, body);
      const saved = await threadBody(t);
      // Only Ann (eligible) and Rob himself (self-mention, never notified) stay mentions.
      expect(saved.match(/\(mention:/g)).toHaveLength(2);
      expect(saved).toContain(`(mention:${ann})`);
      expect(saved).toContain(`(mention:${rob})`);
      expect(saved).toContain("@Someone Else");
      expect((await rows(t)).map((r) => r.profile_id).sort()).toEqual([ann, rob].sort());
      for (const id of [optedOut, blocker]) expect(await mentionNotices(id)).toEqual([]);
      expect((await db.raw("select 1 from community.notifications where kind = 'mention' and profile_id = any ($1)", [[pending, suspended, youth, forged]]))).toEqual([]);
      expect((await db.raw<Json>("select notified_at from community.mentions where target_id = $1 and profile_id = $2", [t, rob]))[0].notified_at).toBeNull();
    });

    it("never lets a mention reach outside a group", async () => {
      const t = await post(rob, `${tag("Ann Rivers", ann)} ${tag("Ben Rowe", ben)}`, { group });
      expect((await rows(t)).map((r) => r.profile_id)).toEqual([ann]);
      expect(await threadBody(t)).toContain("@Ben Rowe");
      expect((await mentionNotices(ben)).map((n) => n.url)).not.toContain(`/community/t/${t}`);
      expect(await rpc(as(ben), "community_feed_post", [t])).toBeNull();
      const [n] = (await mentionNotices(ann)).filter((x) => x.url === `/community/t/${t}`);
      expect(n.title).toBe("Rob Webb mentioned you in Synthetic Mention Group");
    });

    it("caps mentions per post or comment and has no mass mentions", async () => {
      const many = Array.from({ length: 11 }, () => tag("X", randomUUID())).join(" ");
      await fresh();
      await fails(as(rob), "community_thread_create", [category, null, "Too many", many, null], /up to 10 people/);
      const t = await post(rob, "@everyone @all hello");
      expect(await rows(t)).toEqual([]);
    });

    it("notifies a comment mention with a link that reveals the comment, without a duplicate reply notice", async () => {
      const t = await post(ann, "Ann's post");
      await rpc(as(ben), "community_follow", [t, true]);
      const before = (await notifs(ann)).filter((n) => String(n.url).startsWith(`/community/t/${t}`));
      expect(before).toEqual([]);
      const c = await comment(rob, t, `Agree, ${tag("Ann Rivers", ann)} and ${tag("Ben Rowe", ben)}`);
      for (const who of [ann, ben]) {
        const mine = (await notifs(who)).filter((n) => String(n.url).startsWith(`/community/t/${t}`));
        expect(mine.map((n) => n.kind)).toEqual(["mention"]);
        expect(mine[0].title).toBe("Rob Webb mentioned you in a comment in Community");
        expect(await rpc(as(who), "community_notification_open", [mine[0].id])).toBe(`/community/t/${t}?comment=${c}`);
      }
      // A later reply without a mention still notifies as a reply.
      await comment(rob, t, "Another thought");
      expect((await notifs(ann)).filter((n) => n.kind === "reply_mine" && String(n.url).startsWith(`/community/t/${t}`))).toHaveLength(1);
    });

    it("doesn't notify twice when a submit is retried", async () => {
      const t = await post(ben, "Retry post");
      const key = randomUUID();
      const a = await comment(rob, t, `Hi ${tag("Ann Rivers", ann)}`, key);
      const b = await comment(rob, t, `Hi ${tag("Ann Rivers", ann)}`, key);
      expect(b).toBe(a);
      expect((await mentionNotices(ann)).filter((n) => String(n.url).startsWith(`/community/t/${t}`))).toHaveLength(1);
    });

    it("notifies only newly added people on edit, once, and hides the notice when the mention is removed", async () => {
      const t = await post(rob, `Hello ${tag("Ann Rivers", ann)}`);
      const forT = async (id: string) => (await mentionNotices(id)).filter((n) => n.url === `/community/t/${t}`);
      expect(await forT(ann)).toHaveLength(1);
      await fresh();
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ann Rivers", ann)}, edited`]);
      expect(await forT(ann)).toHaveLength(1);
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ann Rivers", ann)} and ${tag("Ben Rowe", ben)}`]);
      expect(await forT(ben)).toHaveLength(1);
      // Removed: the notice disappears and Ann is no longer recorded.
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ben Rowe", ben)}`]);
      expect(await forT(ann)).toEqual([]);
      expect((await rows(t)).find((r) => r.profile_id === ann)?.removed_at).not.toBeNull();
      // Re-added: no second notification row, ever.
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ann Rivers", ann)} ${tag("Ben Rowe", ben)}`]);
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ben Rowe", ben)}`]);
      await rpc(as(rob), "community_thread_edit", [t, "Synthetic mention post", `Hello ${tag("Ann Rivers", ann)} ${tag("Ben Rowe", ben)}`]);
      const all = await db.raw("select 1 from community.notifications where kind = 'mention' and profile_id = $1 and thread_id = $2", [ann, t]);
      expect(all).toHaveLength(1);
      // Comment edits work the same way.
      const c = await comment(rob, t, "No mention yet");
      await rpc(as(rob), "community_reply_edit", [c, `Now ${tag("Ann Rivers", ann)}`]);
      expect((await mentionNotices(ann)).filter((n) => n.url === `/community/t/${t}` && n.title === "Rob Webb mentioned you in a comment in Community")).toHaveLength(1);
      await rpc(as(rob), "community_reply_edit", [c, "Never mind"]);
      expect((await mentionNotices(ann)).filter((n) => n.title === "Rob Webb mentioned you in a comment in Community" && n.url === `/community/t/${t}`)).toEqual([]);
    });

    it("keeps mention records consistent with a failed save", async () => {
      const t = await post(rob, "Locked soon");
      await rpc(as(moderator), "community_mod_thread", [t, "lock", "Synthetic", null]);
      await fails(as(rob), "community_reply", [t, `Hi ${tag("Ann Rivers", ann)}`, randomUUID()], /locked/);
      expect(await db.raw("select 1 from community.mentions where thread_id = $1", [t])).toEqual([]);
      expect((await mentionNotices(ann)).filter((n) => String(n.url).startsWith(`/community/t/${t}`))).toEqual([]);
    });

    it("works with formatting and photos or videos in the same save", async () => {
      const batch = randomUUID();
      const b = await rpc<Json>(as(rob), "community_attachment_begin", [batch, randomUUID(), "video", "video/mp4", 2_000_000, null, null, 12.5]);
      await db.query(as(rob), "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)", [
        b.bucket, b.path, rob, JSON.stringify({ size: 2_000_000, mimetype: "video/mp4" }),
      ]);
      await rpc(as(rob), "community_attachment_processing", [b.id]);
      await rpc(as(rob), "community_attachment_ready", [b.id, null, null, 1280, 720, null, null]);
      await fresh();
      const body = `**Bold** and _italic_ for ${tag("Ann Rivers", ann)}\n\n- a list\n> a quote`;
      const t = await rpc<string>(as(rob), "community_thread_create_with_media", [category, null, "With media", body, randomUUID(), [b.id], [""]]);
      const card = await rpc<Json>(as(ann), "community_feed_post", [t]);
      expect(card.body).toBe(body);
      expect((card.attachments as Json[]).map((a) => a.id)).toEqual([b.id]);
      expect(card.mentions).toEqual([{ id: ann, name: "Ann Rivers", listed: true }]);
      expect((await mentionNotices(ann)).map((n) => n.url)).toContain(`/community/t/${t}`);
    });
  });

  describe("reading and delivery rechecks", () => {
    it("shows current names, links only listed members, and leaves excerpts readable", async () => {
      const t = await post(rob, `Hi ${tag("Ann Rivers", ann)} and ${tag("Ben Rowe", ben)}`);
      await db.raw("update public.profiles set preferred_name = 'Annie' where id = $1", [ann]);
      await db.raw("update public.member_profile_details set directory_listed = false where profile_id = $1", [ben]);
      const card = await rpc<Json>(as(ann2), "community_feed_post", [t]);
      expect(card.mentions).toHaveLength(2);
      expect(card.mentions).toEqual(expect.arrayContaining([
        { id: ann, name: "Annie", listed: true },
        { id: ben, name: "Ben Rowe", listed: false },
      ]));
      expect(card.excerpt).toBe("Hi @Ann Rivers and @Ben Rowe");
      await db.setStatus(ben, "suspended");
      expect(((await rpc<Json>(as(ann2), "community_feed_post", [t])).mentions as Json[]).find((m) => m.id === ben)).toEqual({ id: ben, name: null, listed: false });
      await db.setStatus(ben, "approved");
      await db.raw("update public.profiles set preferred_name = null where id = $1", [ann]);
      await db.raw("update public.member_profile_details set directory_listed = true where profile_id = $1", [ben]);
      // Comments carry their own mentions.
      const c = await comment(rob, t, `Also ${tag("Ann Rivers", ann)}`);
      const page = await rpc<Json>(as(ben), "community_comments", [t, null, null, 10, null]);
      expect((page.items as Json[]).find((x) => x.id === c)?.mentions).toEqual([{ id: ann, name: "Ann Rivers", listed: true }]);
    });

    it("drops the notice and queued email and push when content is hidden or deleted", async () => {
      await rpc(as(ann), "community_set_pref", ["mentions", true, "immediate", true]);
      await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-ann', $2, $3)", [ann, "p".repeat(40), "a".repeat(16)]);
      const t = await post(ben, "Hidden later");
      const c = await comment(rob, t, `Hey ${tag("Ann Rivers", ann)}`);
      const n = (await mentionNotices(ann)).find((x) => x.url === `/community/t/${t}`)!;
      expect((await db.raw("select 1 from community.email_outbox where notification_id = $1 and status = 'pending'", [n.id]))).toHaveLength(1);
      expect((await db.raw("select 1 from community.push_outbox where notification_id = $1 and status = 'pending'", [n.id]))).toHaveLength(1);
      await rpc(as(moderator), "community_mod_post", [c, "hide", "Synthetic", null]);
      expect((await mentionNotices(ann)).find((x) => x.id === n.id)).toBeUndefined();
      expect(await rpc(as(ann), "community_notification_open", [n.id])).toBeNull();
      const job = createCommunityJob(SECRET, async (a) => {
        const r = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
        return { data: r[0].r, error: null };
      });
      const mails = await job<Json[]>("email_claim", { limit: 50 });
      const pushes = await job<Json[]>("push_claim", { limit: 50 });
      expect(JSON.stringify(mails)).not.toContain(n.id as string);
      expect(JSON.stringify(pushes)).not.toContain(n.id as string);
      expect((await db.raw<Json>("select status from community.email_outbox where notification_id = $1", [n.id]))[0].status).toBe("skipped");
      expect((await db.raw<Json>("select status from community.push_outbox where notification_id = $1", [n.id]))[0].status).toBe("skipped");
      // Deleted by its author: gone as well.
      const c2 = await comment(rob, t, `Again ${tag("Ann Rivers", ann)}`);
      expect((await mentionNotices(ann)).filter((x) => x.url === `/community/t/${t}`)).toHaveLength(1);
      await rpc(as(rob), "community_reply_delete", [c2]);
      expect((await mentionNotices(ann)).filter((x) => x.url === `/community/t/${t}`)).toEqual([]);
      await db.raw("delete from community.push_subscriptions where profile_id = $1", [ann]);
    });

    it("sends generic push text and keeps group names out of the sender line in email", async () => {
      await rpc(as(ann), "community_set_pref", ["mentions", true, "immediate", true]);
      await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic-ann-2', $2, $3)", [ann, "p".repeat(40), "a".repeat(16)]);
      const job = createCommunityJob(SECRET, async (a) => {
        const r = await db.query<{ r: unknown }>(anon, "select public.community_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
        return { data: r[0].r, error: null };
      });
      await job("email_claim", { limit: 50 });
      await job("push_claim", { limit: 50 });
      await post(rob, `Church-wide ${tag("Ann Rivers", ann)}`);
      await post(rob, `Group ${tag("Ann Rivers", ann)}`, { group });
      const mails = (await job<Json[]>("email_claim", { limit: 50 })).filter((m) => m.to === "m.ann@example.test");
      const titles = mails.flatMap((m) => (m.items as Json[]).map((i) => i.title));
      expect(titles).toEqual(expect.arrayContaining(["Rob Webb mentioned you in Community", "You were mentioned in a Synthetic Mention Group group discussion"]));
      for (const m of mails) for (const i of m.items as Json[]) expect(i.url).toMatch(/^\/notifications\/open\/[0-9a-f-]{36}$/);
      const pushes = (await job<Json[]>("push_claim", { limit: 50 })).filter((p) => JSON.stringify(p.subscriptions).includes("synthetic-ann-2"));
      expect(pushes.length).toBeGreaterThanOrEqual(2);
      for (const p of pushes) expect(p.body).toBe("Someone mentioned you in Community.");
      await rpc(as(ann), "community_set_pref", ["mentions", true, "off", false]);
      await db.raw("delete from community.push_subscriptions where profile_id = $1", [ann]);
    });

    it("hides the notice when the member loses access or blocks the author", async () => {
      const t = await post(rob, `Group news ${tag("Ann Rivers", ann)}`, { group });
      const n = (await mentionNotices(ann)).find((x) => x.url === `/community/t/${t}`)!;
      await db.raw("update community.group_members set state = 'removed', ended_at = now() where group_id = $1 and profile_id = $2", [group, ann]);
      expect((await mentionNotices(ann)).find((x) => x.id === n.id)).toBeUndefined();
      expect(await rpc(as(ann), "community_notification_open", [n.id])).toBeNull();
      await db.raw("insert into community.group_members (group_id, profile_id, role) values ($1, $2, 'member') on conflict (group_id, profile_id) do update set state = 'active', ended_at = null", [group, ann]);

      const t2 = await post(rob, `Church news ${tag("Ann Rivers", ann)}`);
      const n2 = (await mentionNotices(ann)).find((x) => x.url === `/community/t/${t2}`)!;
      await db.raw("insert into community.blocks (blocker_id, blocked_id) values ($1, $2)", [ann, rob]);
      expect((await mentionNotices(ann)).find((x) => x.id === n2.id)).toBeUndefined();
      await db.raw("delete from community.blocks where blocker_id = $1 and blocked_id = $2", [ann, rob]);
      // Suspended members see nothing at all.
      await db.setStatus(ann, "suspended");
      await expect(notifs(ann)).rejects.toThrow(/approved members/);
      await db.setStatus(ann, "approved");
    });

    it("adds 'Someone mentions me' to the existing notification settings", async () => {
      const s = await rpc<Json>(as(ben), "community_my_settings");
      expect((s.prefs as Json).mentions).toEqual({ in_app: true, email: "off", push: false });
      await fails(as(ben), "community_set_pref", ["mentions", true, "daily", false], /valid email option/);
      await rpc(as(ben), "community_set_pref", ["mentions", false, "off", false]);
      const t = await post(rob, `Quiet ${tag("Ben Rowe", ben)}`);
      expect((await mentionNotices(ben)).filter((n) => n.url === `/community/t/${t}`)).toEqual([]);
      await rpc(as(ben), "community_set_pref", ["mentions", true, "off", false]);
      const panel = await rpc<Json>(as(ann), "community_notification_panel", [["mentions"], false, null, null, 15]);
      expect((panel.items as Json[]).every((n) => n.category === "mentions")).toBe(true);
      expect((panel.items as Json[]).length).toBeGreaterThan(0);
    });
  });
});
