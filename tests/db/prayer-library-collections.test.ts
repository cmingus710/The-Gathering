import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const MIGRATION = "20261124000100_prayer_library_collections.sql";

/**
 * Prayer Library collections (20261124000100) against a real database:
 * existing prayers moved into General prayers with nothing else changed;
 * publishing needs a collection (drafts don't); members browse only active
 * collections with published, unhidden prayers (counts, covers, and direct
 * links alike); search across and within collections, including collection
 * names; settings managers create, rename, reorder, cover, reassign, and
 * archive, while members and moderators can't; drafts stay private; no
 * notifications. Every person and prayer here is synthetic.
 */
type Json = Record<string, unknown>;
type Card = Json & { id: string; title: string; excerpt: string; collection: { id: string; name: string } | null };
type Page = { items: Card[]; has_more: boolean };
type Shelf = { id: string; name: string; description: string; count: number; is_general: boolean; cover: { path: string; alt: string } | null };

describeDb("prayer library collections", () => {
  let db: TestDb;
  let admin: string; // super administrator (settings.manage)
  let mod: string; // prayer moderator, no settings.manage
  let alice: string;
  let bob: string;
  let kid: string;
  let general: string;
  let legacy: { published: string; draft: string; archived: string; hidden: string };
  let before: Record<string, Json>;

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
  const save = (who: string, opts: { id?: string; title?: string; body?: string; publish?: boolean; collection?: string | null } = {}) =>
    rpc<string>(as(who), "prayer_library_save", [
      opts.id ?? null,
      opts.title ?? "A synthetic prayer",
      opts.body ?? "Synthetic words of prayer.",
      "original",
      null,
      null,
      [],
      [],
      opts.publish ?? true,
      null,
      opts.collection === undefined ? general : opts.collection,
    ]);
  const list = (who: string, opts: { view?: string; q?: string | null; collection?: string | null } = {}) =>
    rpc<Page>(as(who), "prayer_library_list", ["library", opts.q ?? null, null, null, null, null, null, 50, opts.collection ?? null].map((v, i) => (i === 0 ? (opts.view ?? "library") : v)));
  const titles = async (who: string, opts: Parameters<typeof list>[1] = {}) => (await list(who, opts)).items.map((c) => c.title).sort();
  const shelves = async (who: string) => (await rpc<{ total: number; collections: Shelf[] }>(as(who), "prayer_library_collections")).collections;
  const create = (name: string, description = "") => rpc<string>(as(admin), "prayer_library_collection_save", [null, name, description, null]);
  const putObject = (actor: Actor, name: string) =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ('prayer-library', $1, null, '{}')", [name]);
  const canRead = async (actor: Actor, name: string) =>
    (await db.query(actor, "select 1 from storage.objects where bucket_id = 'prayer-library' and name = $1", [name])).length === 1;

  beforeAll(async () => {
    // The library as it was before collections, with content in every state.
    db = await TestDb.create({ before: MIGRATION });
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("c.admin@example.test", "Synthetic Admin");
    mod = await mk("c.mod@example.test", "Synthetic Moderator");
    alice = await mk("c.alice@example.test", "Alice Contributor");
    bob = await mk("c.bob@example.test", "Bob Reader");
    kid = await mk("c.kid@example.test", "Kit Young");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [kid]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(mod, "prayer_moderator");

    const old = (title: string, publish: boolean) =>
      rpc<string>(as(alice), "prayer_library_save", [null, title, "Old words of prayer.", "shared", "A source", "https://example.org/x", ["Psalm 23"], [], publish, null]);
    legacy = {
      published: await old("Legacy published prayer", true),
      draft: await old("Legacy draft prayer", false),
      archived: await old("Legacy archived prayer", true),
      hidden: await old("Legacy hidden prayer", true),
    };
    await rpc(as(alice), "prayer_library_status", [legacy.archived, "archived"]);
    await rpc(as(mod), "prayer_library_mod_action", [legacy.hidden, "hide", "Synthetic reason", null]);
    await rpc(as(bob), "prayer_library_bookmark", [legacy.published, true]);
    before = Object.fromEntries(
      (await db.raw<Json & { id: string }>("select * from prayer.library_prayers")).map((r) => {
        delete r.search;
        return [r.id, r];
      }),
    );
    await db.applyMigrations({ from: MIGRATION });
    const meta = await rpc<{ collections: Array<{ id: string; is_general: boolean; name: string }> }>(as(bob), "prayer_library_meta");
    general = meta.collections.find((c) => c.is_general)!.id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  describe("existing content", () => {
    it("places every existing prayer in General prayers and changes nothing else", async () => {
      const rows = await db.raw<Json & { id: string }>("select * from prayer.library_prayers");
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        const { collection_id, ...rest } = r;
        delete rest.search;
        expect(collection_id).toBe(general);
        expect(rest).toEqual(before[r.id]);
      }
      // Bookmarks are untouched and still private.
      expect((await list(bob, { view: "saved" })).items.map((c) => c.id)).toEqual([legacy.published]);
      expect((await list(alice, { view: "saved" })).items).toEqual([]);
      // Members see General prayers with only the published, unhidden prayer counted.
      expect(await shelves(bob)).toEqual([expect.objectContaining({ id: general, name: "General prayers", is_general: true, count: 1, cover: null })]);
      expect((await rpc<Card>(as(bob), "prayer_library_prayer", [legacy.published])).collection).toEqual({ id: general, name: "General prayers" });
    });

    it("sends no notifications for the move", async () => {
      expect(await db.raw("select 1 from community.notifications")).toEqual([]);
    });
  });

  describe("contributing", () => {
    it("requires an active collection to publish, but not for a draft", async () => {
      const morning = await create("Morning Prayers", "To begin the day.");
      await fails(as(alice), "prayer_library_save", [null, "No shelf", "Body", "original", null, null, [], [], true, null, null], /Choose a collection/);
      const draft = await save(alice, { title: "Unassigned draft", publish: false, collection: null });
      expect((await rpc<Card>(as(alice), "prayer_library_prayer", [draft])).collection).toBeNull();
      // Publishing the draft from its page needs a collection first.
      await fails(as(alice), "prayer_library_status", [draft, "published"], /Choose a collection/);
      await save(alice, { id: draft, title: "Unassigned draft", collection: morning });
      expect((await rpc<Card>(as(bob), "prayer_library_prayer", [draft])).collection).toEqual({ id: morning, name: "Morning Prayers" });
      // A made-up or archived collection is refused.
      await fails(as(alice), "prayer_library_save", [null, "Bad shelf", "Body", "original", null, null, [], [], true, null, randomUUID()], /no longer available/);
      // Archiving a draft without a collection still works (it lands in General prayers).
      const loose = await save(alice, { title: "Loose draft", publish: false, collection: null });
      await rpc(as(alice), "prayer_library_status", [loose, "archived"]);
      expect((await rpc<Card>(as(alice), "prayer_library_prayer", [loose])).collection?.id).toBe(general);
    });

    it("lets members choose but never manage collections, and keeps youth out", async () => {
      const id = await create("Members Cannot Rename");
      for (const who of [bob, mod]) {
        await fails(as(who), "prayer_library_collection_save", [id, "Renamed", "", null], /permission/);
        await fails(as(who), "prayer_library_collection_save", [null, "New shelf", "", null], /permission/);
        await fails(as(who), "prayer_library_collection_move", [id, "up"], /permission/);
        await fails(as(who), "prayer_library_collection_archive", [id, true, null], /permission/);
        await fails(as(who), "prayer_library_reassign", [[legacy.published], id], /permission/);
        await fails(as(who), "prayer_library_admin_collections", [], /permission/);
        await fails(as(who), "prayer_library_admin_collection_prayers", [general, null, null, null, 50], /permission/);
      }
      for (const fn of ["prayer_library_collections", "prayer_library_meta"]) {
        await fails(as(kid), fn, [], /approved members/);
        await fails(anon, fn, [], /permission denied/);
      }
      await fails(as(kid), "prayer_library_collection", [general], /approved members/);
      // Another member can't move someone else's prayer by editing it.
      await fails(as(bob), "prayer_library_save", [legacy.published, "Mine now", "Body", "original", null, null, [], [], true, null, id], /wasn't found/);
      await rpc(as(admin), "prayer_library_collection_archive", [id, true, null]);
    });
  });

  describe("browsing and search", () => {
    let biblical: string;
    let francis: string;
    let empty: string;

    beforeAll(async () => {
      biblical = await create("Biblical Prayers", "Prayers drawn from Scripture.");
      francis = await create("Prayers by St. Francis");
      empty = await create("Evening Prayers");
      await save(alice, { title: "Psalm of trust", body: "The Lord is my shepherd.", collection: biblical });
      await save(bob, { title: "Hannah's song", body: "My heart rejoices.", collection: biblical });
      await save(alice, { title: "Instrument of peace", body: "Make me an instrument of your peace.", collection: francis });
      // Only drafts, hidden, or archived prayers: the collection stays out of view.
      await save(alice, { title: "Evening draft", publish: false, collection: empty });
      // Archived before it was ever published: still private work.
      const unshared = await save(alice, { title: "Evening private archive", publish: false, collection: empty });
      await rpc(as(alice), "prayer_library_status", [unshared, "archived"]);
      const hidden = await save(bob, { title: "Evening hidden", collection: empty });
      await rpc(as(mod), "prayer_library_mod_action", [hidden, "hide", "Synthetic reason", null]);
      const gone = await save(bob, { title: "Evening archived", collection: empty });
      await rpc(as(bob), "prayer_library_status", [gone, "archived"]);
    });

    it("shows only collections with published, unhidden prayers, with those counts, in order", async () => {
      const list = await shelves(bob);
      expect(list.map((c) => [c.name, c.count])).toEqual(expect.arrayContaining([["Biblical Prayers", 2], ["Prayers by St. Francis", 1]]));
      expect(list.map((c) => c.id)).not.toContain(empty);
      // General prayers sits last until an administrator moves it.
      expect(list[list.length - 1].id).toBe(general);
      expect(await rpc(as(bob), "prayer_library_collection", [biblical])).toMatchObject({ name: "Biblical Prayers", description: "Prayers drawn from Scripture.", count: 2 });
      await fails(as(bob), "prayer_library_collection", [empty], /wasn't found/);
      // The contributor of the draft doesn't get a way in either.
      await fails(as(alice), "prayer_library_collection", [empty], /wasn't found/);
    });

    it("lists a collection's prayers, and searches within it or across all", async () => {
      expect(await titles(bob, { collection: biblical })).toEqual(["Hannah's song", "Psalm of trust"]);
      expect(await titles(bob, { collection: empty })).toEqual([]);
      expect(await titles(alice, { view: "mine", collection: empty })).toEqual(["Evening draft", "Evening private archive"]);
      expect(await titles(bob, { collection: biblical, q: "shepherd" })).toEqual(["Psalm of trust"]);
      expect(await titles(bob, { collection: francis, q: "shepherd" })).toEqual([]);
      expect(await titles(bob, { q: "peace" })).toEqual(["Instrument of peace"]);
      // Collection names are part of discovery.
      expect(await titles(bob, { q: "francis" })).toEqual(["Instrument of peace"]);
      expect(await titles(bob, { q: "biblical" })).toEqual(["Hannah's song", "Psalm of trust"]);
      const card = (await list(bob, { q: "francis" })).items[0];
      expect(card.collection).toEqual({ id: francis, name: "Prayers by St. Francis" });
    });

    it("follows a rename in search and on cards", async () => {
      await rpc(as(admin), "prayer_library_collection_save", [francis, "Franciscan Prayers", "From the Franciscan tradition.", null]);
      expect(await titles(bob, { q: "franciscan" })).toEqual(["Instrument of peace"]);
      expect((await list(bob, { collection: francis })).items[0].collection?.name).toBe("Franciscan Prayers");
      await fails(as(admin), "prayer_library_collection_save", [null, "  biblical   prayers ", "", null], /already exists/);
    });

    it("reassigns prayers one at a time or in bulk, updating counts, never drafts", async () => {
      const ids = (await list(bob, { collection: biblical })).items.map((c) => c.id);
      const draft = (await list(alice, { view: "mine", collection: empty })).items.find((c) => c.title === "Evening draft")!.id;
      const updated = await db.raw<{ id: string; updated_at: string }>("select id, updated_at::text from prayer.library_prayers where id = any($1)", [ids]);
      expect(await rpc<number>(as(admin), "prayer_library_reassign", [[ids[0]], francis])).toBe(1);
      expect((await shelves(bob)).find((c) => c.id === biblical)?.count).toBe(1);
      expect(await rpc<number>(as(admin), "prayer_library_reassign", [[...ids, draft], francis])).toBe(1);
      expect((await shelves(bob)).map((c) => c.id)).not.toContain(biblical);
      await fails(as(bob), "prayer_library_collection", [biblical], /wasn't found/);
      expect((await shelves(bob)).find((c) => c.id === francis)?.count).toBe(3);
      // Owners, dates, and drafts are untouched; nobody was notified.
      expect(await db.raw<{ id: string; updated_at: string }>("select id, updated_at::text from prayer.library_prayers where id = any($1)", [ids])).toEqual(
        expect.arrayContaining(updated),
      );
      expect((await db.raw<{ collection_id: string }>("select collection_id from prayer.library_prayers where id = $1", [draft]))[0].collection_id).toBe(empty);
      expect(await db.raw("select 1 from community.notifications")).toEqual([]);
      await fails(as(admin), "prayer_library_reassign", [[ids[0]], null], /active collection/);
      // Drafts never appear in the administrators' list.
      const adminList = await rpc<{ items: Array<{ id: string; status: string }> }>(as(admin), "prayer_library_admin_collection_prayers", [empty, null, null, null, 50]);
      expect(adminList.items.map((i) => i.status).sort()).toEqual(["archived", "published"]);
      expect(JSON.stringify(adminList)).not.toMatch(/Evening draft|Evening private archive/);
      expect((await rpc<{ counts: Json }>(as(admin), "prayer_library_admin_collection", [empty])).counts).toEqual({ published: 0, hidden: 1, archived: 1, private: 2 });
      const unshared = (await list(alice, { view: "mine", collection: empty })).items.find((c) => c.title === "Evening private archive")!.id;
      expect(await rpc<number>(as(admin), "prayer_library_reassign", [[unshared], francis])).toBe(0);
      await rpc<number>(as(admin), "prayer_library_reassign", [ids, biblical]);
    });

    it("archives only once published prayers are moved, and never General prayers", async () => {
      await fails(as(admin), "prayer_library_collection_archive", [general, true, null], /can't be archived/);
      await fails(as(admin), "prayer_library_collection_archive", [biblical, true, null], /Move this collection's 2 prayers/);
      await fails(as(admin), "prayer_library_collection_archive", [biblical, true, biblical], /another active collection/);
      expect(await rpc<number>(as(admin), "prayer_library_collection_archive", [biblical, true, general])).toBe(2);
      expect((await shelves(bob)).map((c) => c.id)).not.toContain(biblical);
      expect((await rpc<{ collections: Array<{ id: string }> }>(as(alice), "prayer_library_meta")).collections.map((c) => c.id)).not.toContain(biblical);
      await fails(as(alice), "prayer_library_save", [null, "Late", "Body", "original", null, null, [], [], true, null, biblical], /no longer available/);
      // Hidden and archived prayers count as needing a home too; drafts become unassigned.
      await fails(as(admin), "prayer_library_collection_archive", [empty, true, null], /Move this collection's 2 prayers/);
      const mine = (await list(alice, { view: "mine", collection: empty })).items;
      const draft = mine.find((c) => c.title === "Evening draft")!.id;
      const unshared = mine.find((c) => c.title === "Evening private archive")!.id;
      await rpc(as(admin), "prayer_library_reassign", [
        (await rpc<{ items: Array<{ id: string }> }>(as(admin), "prayer_library_admin_collection_prayers", [empty, null, null, null, 50])).items.map((i) => i.id),
        general,
      ]);
      await rpc(as(admin), "prayer_library_collection_archive", [empty, true, null]);
      expect((await rpc<Card>(as(alice), "prayer_library_prayer", [draft])).collection).toBeNull();
      expect((await rpc<Card>(as(alice), "prayer_library_prayer", [unshared])).collection?.id).toBe(general);
      expect((await rpc<Card>(as(alice), "prayer_library_prayer", [unshared])).collection?.id).toBe(general);
      // Restoring brings it back for administrators; members see it once it has a prayer.
      await rpc(as(admin), "prayer_library_collection_archive", [biblical, false, null]);
      expect((await shelves(bob)).map((c) => c.id)).not.toContain(biblical);
      const audit = await db.raw<{ action: string }>("select action from public.audit_log where target_type = 'prayer_library_collection' order by id");
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["prayer.library_collection_created", "prayer.library_collection_archived", "prayer.library_reassigned"]));
    });

    it("reorders active collections", async () => {
      const order = async () => (await rpc<Array<{ id: string; archived: boolean }>>(as(admin), "prayer_library_admin_collections")).filter((c) => !c.archived).map((c) => c.id);
      const start = await order();
      await rpc(as(admin), "prayer_library_collection_move", [general, "up"]);
      const moved = await order();
      expect(moved.indexOf(general)).toBe(start.indexOf(general) - 1);
      await rpc(as(admin), "prayer_library_collection_move", [start[0], "up"]);
      expect((await order())[0]).toBe(start[0]);
    });

    it("keeps covers private to members who can see the collection", async () => {
      const path = `collections/${francis}/cover-1.webp`;
      await expect(putObject(as(bob), path)).rejects.toThrow();
      await putObject(as(admin), path);
      await fails(as(admin), "prayer_library_collection_cover", [francis, `collections/${general}/x.webp`, ""], /wasn't found/);
      expect(await rpc(as(admin), "prayer_library_collection_cover", [francis, path, "Sunlit hills"])).toBeNull();
      expect((await shelves(bob)).find((c) => c.id === francis)?.cover).toEqual({ path, alt: "Sunlit hills" });
      expect(await canRead(as(bob), path)).toBe(true);
      expect(await canRead(as(kid), path)).toBe(false);
      expect(await canRead(anon, path)).toBe(false);
      // Once the collection has nothing published, its cover is no longer readable.
      const ids = (await list(bob, { collection: francis })).items.map((c) => c.id);
      await rpc(as(admin), "prayer_library_reassign", [ids, general]);
      expect(await canRead(as(bob), path)).toBe(false);
      expect(await canRead(as(admin), path)).toBe(true);
      await rpc(as(admin), "prayer_library_reassign", [ids, francis]);
      // Replacing returns the old file for removal; members can't delete files.
      const next = `collections/${francis}/cover-2.webp`;
      await putObject(as(admin), next);
      expect(await rpc(as(admin), "prayer_library_collection_cover", [francis, next, null])).toBe(path);
      expect((await db.query(as(bob), "delete from storage.objects where bucket_id = 'prayer-library' and name = $1 returning 1", [path])).length).toBe(0);
      expect((await db.query(as(admin), "delete from storage.objects where bucket_id = 'prayer-library' and name = $1 returning 1", [path])).length).toBe(1);
      expect(await canRead(as(bob), path)).toBe(false);
      expect(await rpc(as(admin), "prayer_library_collection_cover", [francis, null, null])).toBe(next);
      expect((await shelves(bob)).find((c) => c.id === francis)?.cover).toBeNull();
    });
  });

  it("makes plain-text excerpts from prayers containing HTML", async () => {
    const id = await save(alice, { title: "Pasted prayer", body: "<p>Lord, <strong>hear</strong> us &amp; keep us.</p><br/>**Amen**" });
    const card = (await list(bob, { q: "pasted" })).items.find((c) => c.id === id)!;
    expect(card.excerpt).toBe("Lord, hear us & keep us. Amen");
    // The full text is kept exactly as written.
    expect((await rpc<{ body: string }>(as(bob), "prayer_library_prayer", [id])).body).toContain("<strong>hear</strong>");
  });
});
