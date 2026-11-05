import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Members start their own Prayer Library collections (20261129000100)
 * against a real database: an approved adult member creates one and chooses
 * it for a prayer; the new collection is theirs alone to see until a prayer
 * is published in it, then everyone sees it with the published count;
 * duplicate names (whatever the case or spacing, archived collections
 * included), youth, signed-out, and paused accounts are refused; at most 3
 * collections may wait without a published prayer and at most 5 are created
 * an hour; members still can't rename, reorder, cover, archive, or reassign
 * anything; creations are audited as members'; settings managers see who
 * started each collection; nothing is notified. Every person and prayer here
 * is synthetic.
 */
type Json = Record<string, unknown>;
type Shelf = { id: string; name: string; description: string; count: number; is_general: boolean; mine: boolean; cover: { path: string; alt: string } | null };
type AdminShelf = Shelf & { archived: boolean; started_by: string | null; counts: { published: number } };

describeDb("prayer library member collections", () => {
  let db: TestDb;
  let admin: string; // super administrator (settings.manage)
  let alice: string;
  let bob: string;
  let kid: string;
  let paused: string;
  let general: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message: RegExp) => {
    await expect(rpc(actor, fn, args)).rejects.toThrow(message);
  };
  /** A member starts a collection; returns it as members read it. */
  const add = (who: string, name: string, description = "") => rpc<Shelf>(as(who), "prayer_library_collection_add", [name, description]);
  const publish = (who: string, title: string, collection: string) =>
    rpc<string>(as(who), "prayer_library_save", [null, title, "Synthetic words of prayer.", "original", null, null, [], [], true, null, collection]);
  const shelves = async (who: string) => (await rpc<{ total: number; collections: Shelf[] }>(as(who), "prayer_library_collections")).collections;
  const adminShelf = async (id: string) => (await rpc<AdminShelf[]>(as(admin), "prayer_library_admin_collections")).find((c) => c.id === id)!;

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("m.admin@example.test", "Synthetic Admin");
    alice = await mk("m.alice@example.test", "Alice Contributor");
    bob = await mk("m.bob@example.test", "Bob Reader");
    kid = await mk("m.kid@example.test", "Kit Young");
    paused = await mk("m.paused@example.test", "Pat Paused");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [kid]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.raw("insert into community.restrictions (profile_id, scope, reason, created_by) values ($1, 'posting', 'Synthetic', $2)", [paused, admin]);
    const meta = await rpc<{ collections: Array<{ id: string; is_general: boolean }> }>(as(bob), "prayer_library_meta");
    general = meta.collections.find((c) => c.is_general)!.id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  it("starts a collection the member can choose and see, while nobody else can", async () => {
    const made = await add(alice, "  Morning   Prayers  ", "  To begin the day.  ");
    expect(made).toEqual({
      id: expect.any(String),
      name: "Morning Prayers",
      description: "To begin the day.",
      is_general: false,
      count: 0,
      mine: true,
      cover: null,
    });
    // It goes last among the active collections, before General prayers.
    const rows = await db.raw<{ sort_order: number; is_general: boolean }>("select sort_order, is_general from prayer.library_collections order by sort_order");
    expect(rows[rows.length - 1].is_general).toBe(true);

    // Only Alice sees it, and only she can open it, while it is empty.
    expect((await shelves(alice)).map((c) => c.id)).toContain(made.id);
    expect((await shelves(bob)).map((c) => c.id)).not.toContain(made.id);
    expect(await rpc<Shelf>(as(alice), "prayer_library_collection", [made.id])).toEqual(expect.objectContaining({ id: made.id, count: 0, mine: true }));
    await fails(as(bob), "prayer_library_collection", [made.id], /wasn't found/);
    // Anyone may choose it in the editor, as with any active collection.
    const metaFor = async (who: string) => (await rpc<{ collections: Array<{ id: string }> }>(as(who), "prayer_library_meta")).collections.map((c) => c.id);
    expect(await metaFor(bob)).toContain(made.id);

    // A published prayer makes it everyone's, counted and still marked as Alice's to her alone.
    const prayer = await publish(bob, "A synthetic morning prayer", made.id);
    expect(prayer).toEqual(expect.any(String));
    expect((await shelves(bob)).find((c) => c.id === made.id)).toEqual(expect.objectContaining({ count: 1, mine: false }));
    expect((await shelves(alice)).find((c) => c.id === made.id)).toEqual(expect.objectContaining({ count: 1, mine: true }));
    expect(await rpc<Shelf>(as(bob), "prayer_library_collection", [made.id])).toEqual(expect.objectContaining({ count: 1 }));
  });

  it("refuses a name another collection already has, however it's spaced or capitalized", async () => {
    const made = await add(alice, "Evening Prayers");
    await fails(as(bob), "prayer_library_collection_add", ["evening   prayers"], /already exists/);
    await fails(as(alice), "prayer_library_collection_add", ["General prayers"], /already exists/);
    // Archived collections keep their names too.
    await rpc(as(admin), "prayer_library_collection_archive", [made.id, true, general]);
    await fails(as(bob), "prayer_library_collection_add", ["Evening Prayers"], /already exists/);
    // Short, empty, and over-long names are refused by the same text rules.
    await fails(as(alice), "prayer_library_collection_add", ["x"], /too short/);
    await fails(as(alice), "prayer_library_collection_add", ["  "], /too short/);
    await fails(as(alice), "prayer_library_collection_add", ["N".repeat(81)], /81 characters|80 characters or fewer/);
    await fails(as(alice), "prayer_library_collection_add", ["Fine name", "D".repeat(301)], /300 characters or fewer/);
  });

  it("keeps youth, signed-out, and paused accounts out, and grants no management", async () => {
    await fails(as(kid), "prayer_library_collection_add", ["Youth shelf"], /approved members/);
    await fails(anon, "prayer_library_collection_add", ["Anon shelf"], /permission denied/);
    await fails(as(paused), "prayer_library_collection_add", ["Paused shelf"], /posting is paused/);
    // Starting one gives a member nothing else: the management functions still refuse.
    const made = await add(alice, "Nothing Else Granted");
    await fails(as(alice), "prayer_library_collection_save", [made.id, "Renamed", "", null], /permission/);
    await fails(as(alice), "prayer_library_collection_move", [made.id, "up"], /permission/);
    await fails(as(alice), "prayer_library_collection_cover", [made.id, null, null], /permission/);
    await fails(as(alice), "prayer_library_collection_archive", [made.id, true, null], /permission/);
    await fails(as(alice), "prayer_library_reassign", [[randomUUID()], made.id], /permission/);
    await fails(as(alice), "prayer_library_admin_collection", [made.id], /permission/);
  });

  it("lets three collections wait for a first prayer, and no more", async () => {
    const mine = await db.raw<{ id: string }>("select id from prayer.library_collections where created_by = $1 and archived_at is null", [bob]);
    expect(mine).toEqual([]);
    const waiting = [await add(bob, "Bob Waiting One"), await add(bob, "Bob Waiting Two"), await add(bob, "Bob Waiting Three")];
    await fails(as(bob), "prayer_library_collection_add", ["Bob Waiting Four"], /without a published prayer/);
    // Alice's own waiting collections are counted separately.
    const alices = await add(alice, "Alice Still Waiting");
    expect(alices.mine).toBe(true);
    // Publishing into one frees a place.
    await publish(bob, "A synthetic prayer for Bob's shelf", waiting[0].id);
    const fourth = await add(bob, "Bob Waiting Four");
    expect(fourth.name).toBe("Bob Waiting Four");
  });

  it("allows five new collections an hour", async () => {
    // Nothing of Carol's is waiting: each new one is published into at once.
    const carol = await db.createAuthUser("m.carol@example.test", { fullName: "Carol Contributor" });
    await db.setStatus(carol, "approved");
    for (let i = 1; i <= 5; i++) {
      const made = await add(carol, `Carol Shelf ${i}`);
      await publish(carol, `A synthetic prayer ${i}`, made.id);
    }
    await fails(as(carol), "prayer_library_collection_add", ["Carol Shelf 6"], /too often/);
    await db.raw("delete from community.rate_events where profile_id = $1", [carol]);
    expect((await add(carol, "Carol Shelf 6")).name).toBe("Carol Shelf 6");
  });

  it("records who started each collection, in the audit log and for settings managers", async () => {
    const made = await add(alice, "Audited Shelf", "Started by a member.");
    const entries = await db.raw<{ actor_id: string; details: Json }>(
      "select actor_id, details from public.audit_log where action = 'prayer.library_collection_created' and target_id = $1",
      [made.id],
    );
    expect(entries).toEqual([{ actor_id: alice, details: { by: "member" } }]);
    // The admin list says who started it (and nothing for the seeded collection).
    expect(await adminShelf(made.id)).toEqual(expect.objectContaining({ started_by: "Alice Contributor", counts: expect.objectContaining({ published: 0 }) }));
    expect((await adminShelf(general)).started_by).toBeNull();
    // A settings manager's own collection records them, not a member.
    const theirs = await rpc<string>(as(admin), "prayer_library_collection_save", [null, "Admin Shelf", "", null]);
    expect((await adminShelf(theirs)).started_by).toBe("Synthetic Admin");
  });

  it("sends no notifications and leaves other prayers alone", async () => {
    const dave = await db.createAuthUser("m.dave@example.test", { fullName: "Dave Contributor" });
    await db.setStatus(dave, "approved");
    const before = await db.raw("select id, collection_id, updated_at from prayer.library_prayers order by id");
    await add(dave, "Quiet Shelf");
    expect(await db.raw("select 1 from community.notifications")).toEqual([]);
    expect(await db.raw("select id, collection_id, updated_at from prayer.library_prayers order by id")).toEqual(before);
  });
});
