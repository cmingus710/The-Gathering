import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 13 church reading: Kindle links, reading dates, related lesson,
 * private progress, and journal notes linked to a book. Synthetic data only.
 */
type Json = Record<string, unknown>;

describeDb("church reading: books, Kindle/Audible links, private progress", () => {
  let db: TestDb;
  let editor: string;
  let publisher: string;
  let m1: string;
  let m2: string;
  let pending: string;
  let book: string;
  let draftBook: string;
  let lesson: string;
  let draftLesson: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const save = (actor: Actor, payload: Json) => rpc<Json>(actor, "media_admin_item_save", [null, j(payload), null]);
  const publish = (id: string) => rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approve = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approve) await db.setStatus(id, "approved");
      return id;
    };
    editor = await mk("b.editor@example.test", "Synthetic Editor");
    publisher = await mk("b.publisher@example.test", "Synthetic Publisher");
    m1 = await mk("b.m1@example.test", "Synthetic Reader One");
    m2 = await mk("b.m2@example.test", "Synthetic Reader Two");
    pending = await mk("b.pending@example.test", "Synthetic Pending", false);
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    book = (await save(as(publisher), { kind: "book", title: "Synthetic Book", book_author: "A. Writer", audible_url: "https://www.audible.com/pd/B000000000", book_current: true })).id as string;
    draftBook = (await save(as(publisher), { kind: "book", title: "Draft Book", book_author: "B. Writer" })).id as string;
    lesson = (await save(as(publisher), { kind: "lesson", title: "Synthetic Lesson", body: "x", audience: "members", delivered_on: "2026-10-18" })).id as string;
    draftLesson = (await save(as(publisher), { kind: "lesson", title: "Unpublished Lesson", body: "x", audience: "members", delivered_on: "2026-10-25" })).id as string;
    await publish(book);
    await publish(lesson);
  }, 120_000);
  afterAll(async () => db?.destroy());

  it("lets content editors set Kindle links and dates, and audits it", async () => {
    await rpc(as(editor), "media_admin_book_details_save", [book, "https://www.amazon.com/dp/B000000000", "2026-10-01", "2026-11-30", lesson]);
    const d = await rpc<Json>(as(editor), "media_admin_book_details", [book]);
    expect(d.kindle_url).toBe("https://www.amazon.com/dp/B000000000");
    expect((d.lessons as Json[]).map((l) => l.id)).toContain(lesson);
    const audit = await db.raw("select details from public.audit_log where action = 'media.book_details_saved' and target_id = $1", [book]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("amazon");
  });

  it("accepts only HTTPS Amazon/Kindle links and sane dates", async () => {
    for (const bad of ["http://www.amazon.com/dp/B0", "https://evil.example/amazon.com/", "javascript:alert(1)", "https://www.amazon.com.evil.example/dp/x", 'https://www.amazon.com/dp/"><script>']) {
      await expect(rpc(as(editor), "media_admin_book_details_save", [book, bad, null, null, null])).rejects.toThrow(/https:\/\/ Amazon or Kindle link/);
    }
    await expect(rpc(as(editor), "media_admin_book_details_save", [book, null, "2026-12-01", "2026-11-01", null])).rejects.toThrow(/before the start/);
    await expect(rpc(as(editor), "media_admin_book_details_save", [book, null, null, null, book])).rejects.toThrow(/Sunday lesson/);
    await expect(rpc(as(editor), "media_admin_book_details_save", [lesson, null, null, null, null])).rejects.toThrow(/Not found/);
    await rpc(as(editor), "media_admin_book_details_save", [book, "https://read.amazon.com/?asin=B000000000", "2026-10-01", "2026-11-30", lesson]);
  });

  it("refuses book administration to members and pending accounts", async () => {
    await expect(rpc(as(m1), "media_admin_book_details_save", [book, null, null, null, null])).rejects.toThrow(/permission/);
    await expect(rpc(as(m1), "media_admin_book_details", [book])).rejects.toThrow(/permission/);
    await expect(rpc(as(pending), "media_book_extras", [book])).rejects.toThrow(/approved members/);
    await expect(rpc(anon, "media_book_extras", [book])).rejects.toThrow(/permission denied/);
  });

  it("shows members the extras for visible books only, and hides unpublished related lessons", async () => {
    const x = await rpc<Json>(as(m1), "media_book_extras", [book]);
    expect(x.kindle_url).toBe("https://read.amazon.com/?asin=B000000000");
    expect((x.related_lesson as Json).id).toBe(lesson);
    expect(x.progress).toBeNull();
    await expect(rpc(as(m1), "media_book_extras", [draftBook])).rejects.toThrow(/Not found/);
    await rpc(as(editor), "media_admin_book_details_save", [book, null, null, null, draftLesson]);
    expect((await rpc<Json>(as(m1), "media_book_extras", [book])).related_lesson).toBeNull();
  });

  it("keeps reading progress private to each member", async () => {
    await rpc(as(m1), "media_book_progress_save", [book, "reading", "Chapter 4"]);
    expect(((await rpc<Json>(as(m1), "media_book_extras", [book])).progress as Json).position).toBe("Chapter 4");
    expect((await rpc<Json>(as(m2), "media_book_extras", [book])).progress).toBeNull();
    expect(await rpc<Json[]>(as(m2), "media_books_progress")).toEqual([]);
    expect((await rpc<Json[]>(as(m1), "media_books_progress")).map((p) => p.item_id)).toEqual([book]);
    // No one, including content publishers, reads the table directly.
    await expect(db.query(as(publisher), "select * from media.book_progress")).rejects.toThrow(/permission denied/);
    await expect(rpc(as(m1), "media_book_progress_save", [book, "skimmed", null])).rejects.toThrow(/Choose/);
    await expect(rpc(as(m1), "media_book_progress_save", [book, "reading", "x".repeat(81)])).rejects.toThrow(/80 characters/);
    await expect(rpc(as(m1), "media_book_progress_save", [draftBook, "reading", null])).rejects.toThrow(/Not found/);
    await rpc(as(m1), "media_book_progress_save", [book, "finished", null]);
    expect(((await rpc<Json>(as(m1), "media_book_extras", [book])).progress as Json).status).toBe("finished");
    await rpc(as(m1), "media_book_progress_clear", [null]);
    expect((await rpc<Json>(as(m1), "media_book_extras", [book])).progress).toBeNull();
  });

  it("links private journal entries to a visible book only", async () => {
    const e = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Thoughts", "Private note", j({ kind: "book", media_item_id: book })]);
    expect((e.link as Json).kind).toBe("book");
    expect((e.link as Json).title).toBe("Synthetic Book");
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "x", "y", j({ kind: "book", media_item_id: draftBook })])).rejects.toThrow(/can't be linked/);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "x", "y", j({ kind: "book", media_item_id: lesson })])).rejects.toThrow(/can't be linked/);
    // Another member can't open it.
    await expect(rpc(as(m2), "journal_entry", [e.id])).rejects.toThrow();
  });

  it("removes details and progress with the book", async () => {
    await rpc(as(m2), "media_book_progress_save", [book, "want", null]);
    await db.raw("delete from journal.entries where media_item_id = $1", [book]);
    await db.raw("delete from media.items where book_id = $1", [book]);
    await db.raw("delete from media.items where id = $1", [book]);
    expect(await db.raw("select 1 from media.book_details where item_id = $1", [book])).toHaveLength(0);
    expect(await db.raw("select 1 from media.book_progress where item_id = $1", [book])).toHaveLength(0);
  });
});
