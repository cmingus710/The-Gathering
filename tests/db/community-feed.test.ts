import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The Community feed (community_feed, community_feed_newer,
 * community_comments): newest-first ordering by creation time that replies,
 * reactions, and edits never change; stable cursors across equal
 * timestamps; group isolation; hidden and deleted content; comment counts
 * that match what the viewer may see; and comment links. Every person and
 * post here is synthetic.
 */
type Json = Record<string, unknown>;
type Feed = { items: Json[]; pinned: Json[]; can_post: boolean; next_cursor: { at: string; id: string } | null };
type Comments = { items: Json[]; count: number; target_found: boolean; can_reply: boolean; next_cursor: { at: string; id: string } | null };

describeDb("community feed", () => {
  let db: TestDb;
  let moderator: string;
  let leader: string;
  let m1: string;
  let m2: string;
  let outsider: string;
  let pending: string;
  let suspended: string;
  let category: string;
  let group: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const feed = (id: string, opts: { category?: string | null; group?: string | null; at?: string | null; after?: string | null; limit?: number } = {}) =>
    rpc<Feed>(as(id), "community_feed", [opts.category ?? null, opts.group ?? null, opts.at ?? null, opts.after ?? null, opts.limit ?? 10]);
  const comments = (id: string, thread: string, opts: { at?: string | null; after?: string | null; limit?: number; through?: string | null } = {}) =>
    rpc<Comments>(as(id), "community_comments", [thread, opts.at ?? null, opts.after ?? null, opts.limit ?? 10, opts.through ?? null]);
  const post = async (id: string, opts: { group?: string; title?: string } = {}) => {
    // Many posts per test: start each from a clean rate-limit window.
    await db.raw("delete from community.rate_events where profile_id is not null");
    return rpc<string>(as(id), "community_thread_create", [opts.group ? null : category, opts.group ?? null, opts.title ?? "Synthetic feed post", "Synthetic body.", null]);
  };
  const reply = (id: string, thread: string, body = "Synthetic comment") => rpc<string>(as(id), "community_reply", [thread, body, randomUUID()]);
  const ack = async (id: string) => {
    const g = await rpc<Json>(as(id), "community_guidelines");
    await rpc(as(id), "community_ack_guidelines", [g.version]);
  };
  const ids = (f: { items: Json[] }) => f.items.map((x) => x.id as string);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    moderator = await mk("f.moderator@example.test", "Feed Moderator");
    const cadmin = await mk("f.cadmin@example.test", "Feed Community Admin");
    leader = await mk("f.leader@example.test", "Feed Leader");
    m1 = await mk("f.m1@example.test", "Feed Alpha");
    m2 = await mk("f.m2@example.test", "Feed Bravo");
    outsider = await mk("f.out@example.test", "Feed Outsider");
    pending = await db.createAuthUser("f.pending@example.test", { fullName: "Feed Pending" });
    suspended = await mk("f.suspended@example.test", "Feed Suspended");
    await db.setStatus(suspended, "suspended");
    await db.grantRole(moderator, "community_moderator");
    await db.grantRole(cadmin, "community_admin");
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    for (const id of [moderator, leader, m1, m2, outsider]) await ack(id);
    group = await rpc<string>(as(cadmin), "community_group_save", [
      JSON.stringify({ name: "Synthetic Feed Group", summary: "Summary", about: "About", visibility: "hidden", leader_id: leader }),
    ]);
    await db.raw("insert into community.group_members (group_id, profile_id, role) values ($1, $2, 'member') on conflict do nothing", [group, m1]);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  it("denies pending and suspended accounts", async () => {
    for (const id of [pending, suspended]) {
      await expect(feed(id)).rejects.toThrow(/Only approved members/);
    }
  });

  it("lists original posts newest first by creation time; comments, reactions, and edits never move them", async () => {
    const older = await post(m1, { title: "Feed older post" });
    const newer = await post(m2, { title: "Feed newer post" });
    await db.raw("update community.threads set created_at = now() - interval '2 hours', last_activity_at = now() - interval '2 hours' where id = $1", [older]);
    await db.raw("update community.threads set created_at = now() - interval '1 hour', last_activity_at = now() - interval '1 hour' where id = $1", [newer]);
    await reply(m2, older, "Bumping the older post");
    await rpc(as(m2), "community_react", ["thread", older, "heart", true]);
    await rpc(as(m1), "community_thread_edit", [older, "Feed older post (edited)", "Edited body"]);
    const f = await feed(m2);
    const list = ids(f);
    expect(list.indexOf(newer)).toBeGreaterThanOrEqual(0);
    expect(list.indexOf(newer)).toBeLessThan(list.indexOf(older));
    const card = f.items.find((x) => x.id === older)!;
    expect(card.comment_count).toBe(1);
    expect(card.body).toBe("Edited body");
    expect((card.reactions as Json).heart).toEqual({ count: 1, mine: true });
    // Original posts only: no comment bodies ride along with the feed.
    expect(card).not.toHaveProperty("posts");
    expect(f.can_post).toBe(true);
  });

  it("pages with a stable cursor across equal timestamps and concurrent new posts", async () => {
    const at = "2026-01-01T12:00:00Z";
    const same: string[] = [];
    for (let i = 0; i < 7; i++) same.push(await post(m1, { title: `Feed tie ${i}` }));
    await db.raw("update community.threads set created_at = $2 where id = any($1)", [same, at]);
    const seen: string[] = [];
    let cursor: { at: string; id: string } | null = null;
    let pages = 0;
    do {
      const page: Feed = await feed(m2, { category, at: cursor?.at, after: cursor?.id, limit: 3 });
      seen.push(...ids(page));
      cursor = page.next_cursor;
      // A post made mid-scroll is newer than the cursor and never appears in later pages.
      if (pages === 0) await post(m2, { title: "Feed concurrent post" });
      pages++;
    } while (cursor && pages < 50);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of same) expect(seen).toContain(id);
    const tieOrder = seen.filter((id) => same.includes(id));
    expect(tieOrder).toEqual([...same].sort().reverse());
  });

  it("keeps group posts inside the group and filters by group or category", async () => {
    const g = await post(leader, { group, title: "Feed group-only post" });
    expect(ids(await feed(m1))).toContain(g);
    expect(ids(await feed(m1, { group }))).toEqual(expect.arrayContaining([g]));
    expect(ids(await feed(m1, { category }))).not.toContain(g);
    expect(ids(await feed(outsider))).not.toContain(g);
    await expect(feed(outsider, { group })).rejects.toThrow(/only for its members/);
    expect(await rpc(as(outsider), "community_feed_post", [g])).toBeNull();
    expect(await comments(outsider, g)).toBeNull();
    expect(await rpc(as(outsider), "community_feed_newer", [null, group, "2000-01-01T00:00:00Z", randomUUID()])).toBe(0);
  });

  it("shows hidden posts only to moderators and leaves deleted posts out", async () => {
    const hidden = await post(m1, { title: "Feed hidden post" });
    const deleted = await post(m1, { title: "Feed deleted post" });
    await rpc(as(moderator), "community_mod_thread", [hidden, "hide", "Synthetic", null]);
    await rpc(as(m1), "community_thread_delete", [deleted]);
    expect(ids(await feed(m2))).not.toContain(hidden);
    expect(ids(await feed(m2))).not.toContain(deleted);
    const mod = await feed(moderator);
    expect(mod.items.find((x) => x.id === hidden)?.status).toBe("hidden");
    expect(ids(mod)).not.toContain(deleted);
    expect(await comments(m2, hidden)).toBeNull();
    expect(await rpc(as(m2), "community_feed_post", [hidden])).toBeNull();
    expect(((await rpc<Json>(as(moderator), "community_feed_post", [hidden])) as Json).status).toBe("hidden");
    const gone = await rpc<Json>(as(m2), "community_feed_post", [deleted]);
    expect(gone === null || (gone.status === "deleted" && gone.body === null)).toBe(true);
  });

  it("returns comments newest first with counts that match what the viewer may see", async () => {
    const t = await post(m1, { title: "Feed comments post" });
    const made: string[] = [];
    for (let i = 0; i < 12; i++) made.push(await reply(m2, t, `Comment ${i}`));
    // Equal timestamps for a few: the id breaks the tie.
    await db.raw("update community.posts set created_at = '2026-02-01T00:00:00Z' where id = any($1)", [made.slice(0, 4)]);
    const hiddenComment = made[11];
    const deletedComment = made[10];
    await rpc(as(moderator), "community_mod_post", [hiddenComment, "hide", "Synthetic", null]);
    await rpc(as(m2), "community_reply_delete", [deletedComment]);

    const first = await comments(m1, t, { limit: 5 });
    expect(first.count).toBe(10);
    expect(ids(first)).not.toContain(hiddenComment);
    expect(ids(first)).not.toContain(deletedComment);
    expect(ids(first)[0]).toBe(made[9]);
    const all = [...ids(first)];
    let cursor = first.next_cursor;
    while (cursor) {
      const page: Comments = await comments(m1, t, { at: cursor.at, after: cursor.id, limit: 5 });
      all.push(...ids(page));
      cursor = page.next_cursor;
    }
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
    expect(all.slice(-4)).toEqual([...made.slice(0, 4)].sort().reverse());

    const card = (await feed(m1, { category })).items.find((x) => x.id === t)!;
    expect(card.comment_count).toBe(10);
    const modCard = (await feed(moderator, { category })).items.find((x) => x.id === t)!;
    expect(modCard.comment_count).toBe(11);
    expect((await comments(moderator, t, { limit: 50 })).items.find((x) => x.id === hiddenComment)?.status).toBe("hidden");
  });

  it("extends the first page through a linked comment, even an old one", async () => {
    const t = await post(m1, { title: "Feed deep link post" });
    const made: string[] = [];
    for (let i = 0; i < 15; i++) made.push(await reply(m2, t, `Linked ${i}`));
    await db.raw("update community.posts set created_at = now() - make_interval(mins => 100 - $2::int) where id = $1", [made[0], 0]);
    const page = await comments(m1, t, { limit: 5, through: made[0] });
    expect(page.target_found).toBe(true);
    expect(ids(page)).toContain(made[0]);
    expect(ids(page)).toHaveLength(15);
    const gone = await comments(m1, t, { limit: 5, through: randomUUID() });
    expect(gone.target_found).toBe(false);
    expect(ids(gone)).toHaveLength(5);
  });

  it("offers a count of newer posts without moving the reader", async () => {
    const top = (await feed(m2, { limit: 1 })).items[0];
    expect(await rpc(as(m2), "community_feed_newer", [null, null, top.created_at, top.id])).toBe(0);
    await post(m1, { title: "Feed brand-new post" });
    expect(await rpc(as(m2), "community_feed_newer", [null, null, top.created_at, top.id])).toBe(1);
  });

  it("lists pinned posts apart while they keep their place in the feed", async () => {
    const p = await post(m1, { title: "Feed pinned post" });
    await db.raw("update community.threads set created_at = now() - interval '30 days' where id = $1", [p]);
    await rpc(as(moderator), "community_mod_thread", [p, "pin", null, null]);
    const f = await feed(m2, { limit: 3 });
    expect(f.pinned.map((x) => x.id)).toContain(p);
    expect(ids(f)).not.toContain(p);
  });

  it("links reply notifications to the comment", async () => {
    const t = await post(m1, { title: "Feed notification post" });
    const c = await reply(m2, t, "Notify the author");
    const list = (await rpc<Json>(as(m1), "community_notifications", [null, 50])).items as Json[];
    const n = list.find((x) => String(x.title).includes("Feed notification post"))!;
    expect(await rpc(as(m1), "community_notification_open", [n.id])).toBe(`/community/t/${t}?comment=${c}`);
  });

  it("keeps the new functions closed to visitors", async () => {
    await expect(db.query({ role: "anon" }, "select public.community_feed()")).rejects.toThrow(/permission denied/);
    await expect(db.query({ role: "anon" }, "select public.community_comments($1)", [randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(db.query(as(m1), "select community.feed_card(t, $1, false, true) from community.threads t limit 1", [m1])).rejects.toThrow(/permission denied/);
  });
});
