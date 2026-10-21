import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The bell panel's list (20261101000100) against a real database: category
 * and unread filters, keyset paging, "Clear read" dismissal with Undo, and
 * that every action touches only the caller's own notifications. Every
 * person and discussion here is synthetic.
 */
type Json = Record<string, unknown>;
type Item = { id: string; category: string; kind: string; read: boolean; title: string; created_at: string };
type Panel = { items: Item[]; has_more: boolean; timezone: string; has_read: boolean };

describeDb("notification panel", () => {
  let db: TestDb;
  let m1: string;
  let m2: string;
  let m3: string;
  let category: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const panel = (id: string, opts: { categories?: string[] | null; unread?: boolean; before?: string | null; beforeId?: string | null; limit?: number } = {}) =>
    rpc<Panel>(as(id), "community_notification_panel", [opts.categories ?? null, opts.unread ?? false, opts.before ?? null, opts.beforeId ?? null, opts.limit ?? 15]);
  const unread = (id: string) => rpc<{ notifications: number; messages: number }>(as(id), "community_unread_counts");
  const ack = async (id: string) => {
    const g = await rpc<Json>(as(id), "community_guidelines");
    await rpc(as(id), "community_ack_guidelines", [g.version]);
  };
  const thread = (id: string, title: string) => rpc<string>(as(id), "community_thread_create", [category, null, title, "Synthetic body.", null]);
  const reply = (id: string, t: string) => rpc(as(id), "community_reply", [t, "Synthetic reply.", null]);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      await ack(id);
      return id;
    };
    m1 = await mk("np.m1@example.test", "Panel One");
    m2 = await mk("np.m2@example.test", "Panel Two");
    m3 = await mk("np.m3@example.test", "Panel Three");
    category = (await db.raw<{ id: string }>("select id from community.categories where name = 'General Discussion'"))[0].id;
    // Five discussions by m1, each with a reply from m2: five forum notices.
    for (let i = 1; i <= 5; i++) await reply(m2, await thread(m1, `Panel synthetic ${i}`));
    // And one moderator notice.
    await db.raw(
      `insert into community.notifications (profile_id, kind, category, actor_id, detail)
       values ($1, 'moderation', 'moderation', null, '{"action":"restriction_lifted"}')`,
      [m1],
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it("is closed to visitors and requires an approved member", async () => {
    await expect(db.query(anon, "select public.community_notification_panel()")).rejects.toThrow(/permission denied/);
    await expect(db.query(anon, "select public.community_notifications_clear_read()")).rejects.toThrow(/permission denied/);
    await expect(db.query(anon, "select public.community_notifications_restore(now())")).rejects.toThrow(/permission denied/);
    const pending = await db.createAuthUser("np.pending@example.test");
    await expect(panel(pending)).rejects.toThrow(/approved members/);
    await expect(rpc(as(pending), "community_notifications_clear_read")).rejects.toThrow(/approved members/);
  });

  it("lists only the caller's notifications, newest first, with the member's time zone, and never marks read", async () => {
    const before = (await unread(m1)).notifications;
    const p = await panel(m1);
    expect(p.items).toHaveLength(6);
    expect(p.has_more).toBe(false);
    expect(p.timezone).toBe("America/Chicago");
    const times = p.items.map((i) => Date.parse(i.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect((await unread(m1)).notifications).toBe(before);
    expect((await panel(m3)).items).toHaveLength(0);
  });

  it("filters by category and validates categories", async () => {
    expect((await panel(m1, { categories: ["forum"] })).items.every((i) => i.category === "forum")).toBe(true);
    expect((await panel(m1, { categories: ["forum"] })).items).toHaveLength(5);
    expect((await panel(m1, { categories: ["forum", "groups", "messages", "moderation"] })).items).toHaveLength(6);
    expect((await panel(m1, { categories: ["events"] })).items).toHaveLength(0);
    await expect(panel(m1, { categories: ["giving"] })).rejects.toThrow(/Unknown notification category/);
  });

  it("pages by (time, id) without gaps or repeats, including ties", async () => {
    // Force a tie on the timestamp for every row.
    await db.raw("update community.notifications set updated_at = '2026-10-20T12:00:00Z' where profile_id = $1", [m1]);
    const seen: string[] = [];
    let cursor: Item | null = null;
    for (let page = 0; page < 10; page++) {
      const p: Panel = await panel(m1, { limit: 2, before: cursor?.created_at ?? null, beforeId: cursor?.id ?? null });
      seen.push(...p.items.map((i) => i.id));
      if (!p.has_more) break;
      cursor = p.items[p.items.length - 1];
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    await expect(panel(m1, { beforeId: seen[0] })).rejects.toThrow(/cursor/);
  });

  it("unread matches the bell badge, which leaves direct-message notices to the Messages badge", async () => {
    // A direct-message notice in a real conversation between m1 and m2.
    const [conv] = await db.raw<{ id: string }>(
      "insert into community.conversations (member_a, member_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)) returning id",
      [m1, m2],
    );
    await db.raw(
      "insert into community.notifications (profile_id, kind, category, actor_id, conversation_id) values ($1, 'message', 'messages', $2, $3)",
      [m1, m2, conv.id],
    );
    expect((await panel(m1)).items.some((i) => i.kind === "message" && !i.read)).toBe(true);
    const badge = (await unread(m1)).notifications;
    const list = await panel(m1, { unread: true });
    expect(list.items.every((i) => !i.read && i.kind !== "message")).toBe(true);
    expect(list.items).toHaveLength(badge);
    await db.raw("delete from community.conversations where id = $1", [conv.id]);
  });

  it("clears only the caller's read notifications, keeps unread ones, and can undo", async () => {
    const forum = (await panel(m1, { categories: ["forum"] })).items;
    // Read two of m1's; m2 can't mark m1's read.
    await rpc(as(m1), "community_notification_read", [forum[0].id]);
    await rpc(as(m1), "community_notification_read", [forum[1].id]);
    await rpc(as(m2), "community_notification_read", [forum[2].id]);
    // m2 has a read notification of their own that must survive m1's clear.
    await reply(m1, await thread(m2, "Panel synthetic for m2"));
    await rpc(as(m2), "community_notification_read", [null]);
    const m2Before = (await panel(m2)).items.length;
    expect((await panel(m1)).has_read).toBe(true);

    const cleared = await rpc<{ cleared: number; at: string }>(as(m1), "community_notifications_clear_read");
    expect(cleared.cleared).toBe(2);
    const after = await panel(m1);
    expect(after.items.map((i) => i.id)).not.toContain(forum[0].id);
    expect(after.items.map((i) => i.id)).not.toContain(forum[1].id);
    expect(after.items.every((i) => !i.read)).toBe(true);
    expect(after.has_read).toBe(false);
    // The full page agrees; the rows still exist (only dismissed).
    const page = await rpc<{ items: Item[] }>(as(m1), "community_notifications", [null, 50]);
    expect(page.items.map((i) => i.id)).not.toContain(forum[0].id);
    const [row] = await db.raw<{ dismissed_at: string | null }>("select dismissed_at from community.notifications where id = $1", [forum[0].id]);
    expect(row.dismissed_at).not.toBeNull();
    // Nobody else's list changed.
    expect((await panel(m2)).items.length).toBe(m2Before);
    // A second clear has nothing to do.
    expect((await rpc<{ cleared: number }>(as(m1), "community_notifications_clear_read")).cleared).toBe(0);

    // Undo by someone else restores nothing; by the owner restores the batch.
    expect(await rpc<number>(as(m2), "community_notifications_restore", [cleared.at])).toBe(0);
    expect(await rpc<number>(as(m1), "community_notifications_restore", [cleared.at])).toBe(2);
    expect((await panel(m1)).items.map((i) => i.id)).toContain(forum[0].id);
  });

  it("never dismisses an unread notification, and opening still works after a clear", async () => {
    await expect(
      db.raw("update community.notifications set dismissed_at = now() where profile_id = $1 and read_at is null", [m1]),
    ).rejects.toThrow(/notifications_dismissed_read/);
    const target = (await panel(m1, { categories: ["forum"] })).items.find((i) => i.read)!;
    await rpc(as(m1), "community_notifications_clear_read");
    expect(await rpc<string | null>(as(m1), "community_notification_open", [target.id])).toMatch(/^\/community\//);
  });

  it("keeps new activity after a clear as a fresh unread notification", async () => {
    const t = await thread(m1, "Panel synthetic merge");
    await reply(m2, t);
    await rpc(as(m1), "community_notification_read", [null]);
    await rpc(as(m1), "community_notifications_clear_read");
    await reply(m3, t);
    const p = await panel(m1, { unread: true });
    expect(p.items.some((i) => i.title.includes("Panel synthetic merge"))).toBe(true);
  });
});
