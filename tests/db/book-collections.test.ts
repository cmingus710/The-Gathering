import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Books · collections from topics (20261115000100): a book's topics group it
 * into collections on the Books page, counts and covers include only books
 * the viewer can open, topic names are normalized and deduplicated, and
 * topics elsewhere behave as before. Synthetic data only.
 */
type Json = Record<string, unknown>;
type Collection = { id: string; name: string; count: number; covers: Json[] };
type Collections = { all: { count: number; covers: Json[] }; collections: Collection[] };
type Books = { collection: { id: string; name: string } | null; q: string | null; total: number; books: Json[] };

const MIGRATION = "20261115000100";

describeDb("book collections: existing topics before the migration", () => {
  let db: TestDb;
  afterAll(async () => db?.destroy());

  it("merges topics that differ only by spacing, keeping every assignment, and normalizes names", async () => {
    db = await TestDb.create({ before: MIGRATION });
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    // Two spellings the old index allowed (inner spacing), and one already-clean name.
    await db.raw("insert into media.topics (id, name, created_at) values ($1, $2, now() - interval '2 days'), ($3, $4, now() - interval '1 day'), ($5, 'Prayer', now())", [
      a,
      "Rob's Reads",
      b,
      "rob's   Reads",
      c,
    ]);
    const items: string[] = [];
    for (const title of ["One", "Two", "Three"]) {
      const [{ id }] = await db.raw<{ id: string }>("insert into media.items (kind, title) values ('book', $1) returning id", [title]);
      items.push(id);
    }
    await db.raw("insert into media.item_topics (item_id, topic_id) values ($1, $4), ($2, $5), ($3, $4), ($3, $5), ($3, $6)", [...items, a, b, c]);

    await db.applyMigrations({ from: MIGRATION });

    const topics = await db.raw<{ id: string; name: string }>("select id, name from media.topics order by name");
    expect(topics).toEqual([
      { id: c, name: "Prayer" },
      { id: a, name: "Rob's Reads" },
    ]);
    const assigned = await db.raw<{ item_id: string; topic_id: string }>("select item_id, topic_id from media.item_topics order by item_id, topic_id");
    expect(assigned).toHaveLength(4);
    expect(assigned.filter((r) => r.topic_id === a).map((r) => r.item_id).sort()).toEqual([...items].sort());
    await expect(db.raw("insert into media.topics (name) values ('  Spaced  ')")).rejects.toThrow(/topics_name_normalized/);
  }, 120_000);
});

describeDb("book collections: members", () => {
  let db: TestDb;
  let admin: string;
  let editor: string;
  let publisher: string;
  let mediaMgr: string;
  let m1: string;
  let m2: string;
  let pending: string;
  let group: string;
  let robs: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const status = (id: string, action: string, at: Date | null = null, expires: Date | null = null) =>
    rpc(as(publisher), "media_admin_item_status", [id, action, at, expires, null]);
  const topic = (name: string, actor: Actor = as(editor)) => rpc<string>(actor, "media_admin_topic_save", [name]);
  const setTopics = (id: string, topics: string[]) => rpc(as(publisher), "media_admin_item_save", [id, j({ topics }), null]);
  const book = async (title: string, opts: Json = {}, publish = true) => {
    const id = (await rpc<Json>(as(publisher), "media_admin_item_save", [null, j({ kind: "book", title, book_author: "A. Writer", ...opts }), null])).id as string;
    if (publish) await status(id, "publish");
    return id;
  };
  const collections = (actor: Actor) => rpc<Collections>(actor, "media_book_collections");
  const shelf = async (actor: Actor, name: string) => (await collections(actor)).collections.find((c) => c.name === name) ?? null;
  const books = (actor: Actor, collection: string | null, q: string | null = null) => rpc<Books>(actor, "media_books", [collection, q]);
  const titles = async (actor: Actor, collection: string | null, q: string | null = null) => (await books(actor, collection, q)).books.map((b) => b.title);

  const putObject = (actor: Actor, name: string, size: number, mimetype: string) =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ('media', $1, $2, $3)", [
      name,
      actor.role === "authenticated" ? actor.userId : null,
      j({ size, mimetype }),
    ]);
  const image = async () => {
    const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["image", "Synthetic cover", "cover.jpg", "image/jpeg", 1000, randomUUID(), null, null]);
    const id = begun.id as string;
    await putObject(as(mediaMgr), begun.upload_path as string, 1000, "image/jpeg");
    await rpc(as(mediaMgr), "media_admin_asset_processing", [id]);
    const path = `assets/${id}/processed.webp`;
    await putObject(as(mediaMgr), path, 500, "image/webp");
    await rpc(as(mediaMgr), "media_admin_asset_complete", [id, path, null, "image/webp", 600, 900, null, "browser"]);
    await rpc(as(mediaMgr), "media_admin_asset_update", [id, j({ rights: "church_owned", confirm_rights: true, public_ok: false })]);
    return id;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approve = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approve) await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("bc.admin@example.test", "Synthetic Admin");
    editor = await mk("bc.editor@example.test", "Synthetic Editor");
    publisher = await mk("bc.publisher@example.test", "Synthetic Publisher");
    mediaMgr = await mk("bc.media@example.test", "Synthetic Media");
    m1 = await mk("bc.m1@example.test", "Synthetic Reader One");
    m2 = await mk("bc.m2@example.test", "Synthetic Reader Two");
    pending = await mk("bc.pending@example.test", "Synthetic Pending", false);
    await db.grantRole(admin, "super_admin");
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(mediaMgr, "media_manager");
    group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Readers", summary: "s", about: "a", visibility: "discoverable", leader_id: admin })]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, m1]);
    robs = await topic("Rob's Reads");
  }, 120_000);
  afterAll(async () => db?.destroy());

  it("reuses one topic regardless of capitalization or extra spaces", async () => {
    expect(await topic("  rob's    READS ")).toBe(robs);
    expect(await topic("Rob's Reads")).toBe(robs);
    expect((await db.raw<{ name: string }>("select name from media.topics where id = $1", [robs]))[0].name).toBe("Rob's Reads");
    await expect(topic("x".repeat(61))).rejects.toThrow(/60 characters/);
    await expect(topic("   ")).rejects.toThrow(/60 characters/);
    await expect(topic("Anything", as(m1))).rejects.toThrow(/permission/);
  });

  it("turns a book's topic into a collection, and adds later books to the same one", async () => {
    const first = await book("Alpha Book", { topics: [robs] });
    let c = await shelf(as(m1), "Rob's Reads");
    expect(c).toMatchObject({ id: robs, count: 1 });
    expect(await titles(as(m1), robs)).toEqual(["Alpha Book"]);

    await book("Beta Book", { topics: [await topic("rob's reads")] });
    c = await shelf(as(m1), "Rob's Reads");
    expect(c?.count).toBe(2);
    expect((await collections(as(m1))).collections.filter((x) => x.name.toLowerCase() === "rob's reads")).toHaveLength(1);
    const r = await books(as(m1), robs);
    expect(r.collection).toEqual({ id: robs, name: "Rob's Reads" });
    expect(r.books.map((b) => b.title)).toEqual(["Alpha Book", "Beta Book"]);
    expect(r.books[0]).toMatchObject({ id: first, kind: "book", book_author: "A. Writer" });
  });

  it("shows one book in several collections, removes it when a topic is removed, and keeps untagged books in All Books", async () => {
    const classics = await topic("Classics");
    const both = await book("Gamma Book", { topics: [robs, classics] });
    const untagged = await book("Delta Book");
    expect(await titles(as(m1), robs)).toContain("Gamma Book");
    expect(await titles(as(m1), classics)).toEqual(["Gamma Book"]);
    expect((await db.raw("select 1 from media.items where title = 'Gamma Book'")).length).toBe(1);

    const all = await titles(as(m1), null);
    expect(all).toEqual(expect.arrayContaining(["Alpha Book", "Beta Book", "Gamma Book", "Delta Book"]));
    expect((await collections(as(m1))).all.count).toBe(all.length);
    expect((await books(as(m1), null)).collection).toBeNull();

    await setTopics(both, [robs]);
    expect(await titles(as(m1), robs)).toContain("Gamma Book");
    expect(await shelf(as(m1), "Classics")).toBeNull();
    await expect(books(as(m1), classics)).rejects.toThrow(/Not found/);
    expect(untagged).toBeTruthy();
  });

  it("previews only covers of books the viewer can open, up to three", async () => {
    const covers = [await image(), await image(), await image(), await image()];
    const shelfName = await topic("Covered");
    for (const [i, cover] of covers.entries()) await book(`Covered ${i}`, { topics: [shelfName], cover_asset_id: cover });
    const hidden = await image();
    await book("Covered Hidden", { topics: [shelfName], cover_asset_id: hidden, audience: "group", group_id: group });
    const forM2 = await shelf(as(m2), "Covered");
    expect(forM2?.count).toBe(4);
    expect(forM2?.covers).toHaveLength(3);
    expect(JSON.stringify(forM2)).not.toContain(hidden);
    expect(JSON.stringify(await collections(as(m2)))).not.toContain(hidden);
    expect((await shelf(as(m1), "Covered"))?.count).toBe(5);
  });

  it("never reveals draft, scheduled, expired, archived, or group-only books, or the collections that only hold them", async () => {
    const secret = await topic("Secret Shelf");
    const draft = await book("Draft Secret", { topics: [secret, robs] }, false);
    const scheduled = await book("Scheduled Secret", { topics: [secret, robs] }, false);
    await status(scheduled, "publish", new Date(Date.now() + 3_600_000));
    const expired = await book("Expired Secret", { topics: [secret, robs] });
    await db.raw("update media.items set publish_at = now() - interval '1 hour', expires_at = now() - interval '1 second' where id = $1", [expired]);
    const archived = await book("Archived Secret", { topics: [secret, robs] });
    await status(archived, "archive");
    const groupOnly = await book("Group Secret", { topics: [secret, robs], audience: "group", group_id: group });
    expect(draft && scheduled).toBeTruthy();

    for (const actor of [as(m2), as(m1)]) {
      const everything = JSON.stringify(await collections(actor));
      for (const t of ["Draft Secret", "Scheduled Secret", "Expired Secret", "Archived Secret"]) {
        expect(await titles(actor, null)).not.toContain(t);
        expect(await titles(actor, robs)).not.toContain(t);
        expect(await titles(actor, null, "Secret")).not.toContain(t);
        expect(await titles(actor, robs, "Secret")).not.toContain(t);
        expect(everything).not.toContain(t);
      }
    }
    // Not a group member: neither the book, its collection, nor the collection's name or count.
    expect(await shelf(as(m2), "Secret Shelf")).toBeNull();
    await expect(books(as(m2), secret)).rejects.toThrow(/Not found/);
    expect(await titles(as(m2), null, "Group Secret")).toEqual([]);
    expect(await titles(as(m2), robs)).not.toContain("Group Secret");
    // A group member sees exactly the one book they can open.
    expect(await shelf(as(m1), "Secret Shelf")).toMatchObject({ count: 1 });
    expect(await titles(as(m1), secret)).toEqual(["Group Secret"]);
    // Leaving the group hides it again.
    await db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [group, m1]);
    expect(await shelf(as(m1), "Secret Shelf")).toBeNull();
    await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, m1]);
    expect(groupOnly).toBeTruthy();
    // An unknown id reads the same as a restricted one.
    await expect(books(as(m1), randomUUID())).rejects.toThrow(/Not found/);
  });

  it("searches all books or within one collection, by title, author, tags, and topics", async () => {
    await book("Epsilon Field Guide", { book_author: "Zed Quill", tags: ["birding"] });
    await book("Zeta Notes", { topics: [robs], tags: ["birding"] });
    expect(await titles(as(m1), null, "quill")).toEqual(["Epsilon Field Guide"]);
    expect(await titles(as(m1), null, "birding")).toEqual(["Epsilon Field Guide", "Zeta Notes"]);
    expect(await titles(as(m1), robs, "birding")).toEqual(["Zeta Notes"]);
    expect(await titles(as(m1), null, "rob's")).toEqual(expect.arrayContaining(["Alpha Book", "Beta Book", "Zeta Notes"]));
    const r = await books(as(m1), robs, "nothing-matches");
    expect(r.books).toEqual([]);
    expect(r.total).toBeGreaterThan(0);
    expect(r.collection?.name).toBe("Rob's Reads");
    expect(await titles(as(m1), null, "100%")).toEqual([]);
  });

  it("is for signed-in approved readers only, and leaves topics on other content alone", async () => {
    await expect(rpc(anon, "media_book_collections")).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "media_books", [null, null])).rejects.toThrow(/permission denied/);
    // A pending account sees no members-only book (the same rule as every other read).
    expect((await collections(as(pending))).collections).toEqual([]);
    expect((await books(as(pending), null)).books).toEqual([]);

    const lesson = (await rpc<Json>(as(publisher), "media_admin_item_save", [null, j({ kind: "lesson", title: "Topic Lesson", body: "x", audience: "members", delivered_on: "2026-10-18", topics: [robs] }), null])).id as string;
    await status(lesson, "publish");
    expect(await titles(as(m1), robs)).not.toContain("Topic Lesson");
    const facets = await rpc<{ topics: Json[] }>(as(m1), "media_facets", ["lesson"]);
    expect(facets.topics.map((t) => t.name)).toContain("Rob's Reads");
  });
});
