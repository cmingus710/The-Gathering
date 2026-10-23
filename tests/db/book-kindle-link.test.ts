import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Kindle book URL beside the Audible link (20261114000100): partial saves of
 * a book's reading details, the wider Kindle link check (Amazon country
 * stores, a.co), who may change the links, and what members see for books
 * with both links, one, or neither. Synthetic data only.
 */
type Json = Record<string, unknown>;

describeDb("church reading: Kindle book URL beside Audible", () => {
  let db: TestDb;
  let editor: string;
  let publisher: string;
  let member: string;
  let pending: string;
  let book: string;
  let lesson: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const save = (actor: Actor, payload: Json) => rpc<Json>(actor, "media_admin_item_save", [null, j(payload), null]);
  const update = (actor: Actor, id: string, payload: Json) => rpc<Json>(actor, "media_admin_item_save", [id, j(payload), null]);
  const publish = (id: string) => rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);
  const patch = (actor: Actor, id: string, p: Json) => rpc(actor, "media_admin_book_details_patch", [id, j(p)]);
  const details = (id: string) => rpc<Json>(as(editor), "media_admin_book_details", [id]);
  const audits = async (id: string) =>
    db.raw<{ details: Json }>("select details from public.audit_log where action = 'media.book_details_saved' and target_id = $1 order by created_at", [id]);
  const newBook = async (title: string, audible?: string) => {
    const id = (await save(as(publisher), { kind: "book", title, book_author: "A. Writer", ...(audible ? { audible_url: audible } : {}) })).id as string;
    await publish(id);
    return id;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approve = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approve) await db.setStatus(id, "approved");
      return id;
    };
    editor = await mk("k.editor@example.test", "Synthetic Editor");
    publisher = await mk("k.publisher@example.test", "Synthetic Publisher");
    member = await mk("k.member@example.test", "Synthetic Reader");
    pending = await mk("k.pending@example.test", "Synthetic Pending", false);
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    book = await newBook("Synthetic Book", "https://www.audible.com/pd/B000000000");
    lesson = (await save(as(publisher), { kind: "lesson", title: "Synthetic Lesson", body: "x", audience: "members", delivered_on: "2026-10-18" })).id as string;
    await publish(lesson);
  }, 120_000);
  afterAll(async () => db?.destroy());

  it("saves, edits, and clears the Kindle link without touching the reading dates or lesson", async () => {
    await patch(as(editor), book, { reading_starts_on: "2026-10-01", reading_ends_on: "2026-11-30", related_lesson_id: lesson });
    await patch(as(editor), book, { kindle_url: "https://www.amazon.com/dp/B000000000" });
    expect(await details(book)).toMatchObject({ kindle_url: "https://www.amazon.com/dp/B000000000", reading_starts_on: "2026-10-01", reading_ends_on: "2026-11-30", related_lesson_id: lesson });

    await patch(as(editor), book, { kindle_url: "https://a.co/d/0aBcDeF" });
    expect((await details(book)).kindle_url).toBe("https://a.co/d/0aBcDeF");

    // The reading details form leaves the Kindle link alone.
    await patch(as(editor), book, { reading_starts_on: "2026-10-08", reading_ends_on: "2026-11-30", related_lesson_id: null });
    expect(await details(book)).toMatchObject({ kindle_url: "https://a.co/d/0aBcDeF", reading_starts_on: "2026-10-08", related_lesson_id: null });

    await patch(as(editor), book, { kindle_url: null });
    expect(await details(book)).toMatchObject({ kindle_url: null, reading_starts_on: "2026-10-08", reading_ends_on: "2026-11-30" });
    // An empty string clears too, and the Audible link is untouched throughout.
    await patch(as(editor), book, { kindle_url: "https://www.amazon.co.uk/dp/B000000000" });
    await patch(as(editor), book, { kindle_url: "" });
    expect((await details(book)).kindle_url).toBeNull();
    expect((await rpc<Json>(as(member), "media_item", [book])).audible_url).toBe("https://www.audible.com/pd/B000000000");
  });

  it("audits what changed, never the URL, and logs nothing for an unchanged save", async () => {
    const before = (await audits(book)).length;
    await patch(as(editor), book, { kindle_url: "https://www.amazon.de/dp/B000000000" });
    await patch(as(editor), book, { kindle_url: "https://www.amazon.de/dp/B000000000" });
    await patch(as(editor), book, {});
    const after = await audits(book);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.details).toMatchObject({ kindle: true, kindle_changed: true });
    expect(JSON.stringify(after)).not.toMatch(/amazon|a\.co/);
  });

  it("accepts Amazon's country stores and a.co short links, and only those", async () => {
    for (const ok of ["https://www.amazon.se/dp/B000000000", "https://amazon.com.be/dp/B000000000", "https://www.amazon.sg/dp/B000000000", "https://a.co/7JcW4Yj", "https://read.amazon.com/?asin=B000000000"]) {
      await patch(as(editor), book, { kindle_url: ok });
      expect((await details(book)).kindle_url).toBe(ok);
    }
    for (const bad of [
      "http://www.amazon.com/dp/B000000000",
      "https://www.amazon.com.evil.example/dp/x",
      "https://a.co.evil.example/d/x",
      "https://a.co@evil.example/d/x",
      "https://evila.co/d/x",
      "https://amazon-books.com/dp/x",
      "javascript:alert(1)",
      "data:text/html,x",
      'https://a.co/d/"><script>',
      "https://www.audible.com/pd/B000000000",
    ]) {
      await expect(patch(as(editor), book, { kindle_url: bad }), bad).rejects.toThrow(/https:\/\/ Amazon or Kindle link/);
    }
    expect((await details(book)).kindle_url).toBe("https://read.amazon.com/?asin=B000000000");
    await expect(patch(as(editor), book, { reading_starts_on: "2026-12-01", reading_ends_on: "2026-11-01" })).rejects.toThrow(/before the start/);
    await expect(patch(as(editor), book, { related_lesson_id: book })).rejects.toThrow(/Sunday lesson/);
    await expect(patch(as(editor), lesson, { kindle_url: null })).rejects.toThrow(/Not found/);
    await expect(rpc(as(editor), "media_admin_book_details_patch", [book, j(["x"])])).rejects.toThrow(/wasn't valid/);
  });

  it("doesn't let members, pending accounts, or visitors change either link", async () => {
    const was = (await details(book)).kindle_url;
    await expect(patch(as(member), book, { kindle_url: null })).rejects.toThrow(/permission/);
    await expect(patch(as(pending), book, { kindle_url: null })).rejects.toThrow(/approved members|permission/);
    await expect(patch(anon, book, { kindle_url: null })).rejects.toThrow(/permission denied/);
    await expect(update(as(member), book, { title: "Synthetic Book", audible_url: null })).rejects.toThrow(/permission/);
    await expect(db.query(as(member), "update media.book_details set kindle_url = null")).rejects.toThrow(/permission denied/);
    expect((await details(book)).kindle_url).toBe(was);
    expect((await rpc<Json>(as(member), "media_item", [book])).audible_url).toBe("https://www.audible.com/pd/B000000000");
  });

  it("gives members each link only when it exists: both, Kindle only, Audible only, neither", async () => {
    const both = await newBook("Both Links", "https://www.audible.co.uk/pd/B000000001");
    const kindleOnly = await newBook("Kindle Only");
    const audibleOnly = await newBook("Audible Only", "https://www.audible.com/pd/B000000002");
    const neither = await newBook("No Links");
    await patch(as(editor), both, { kindle_url: "https://www.amazon.co.uk/dp/B000000001" });
    await patch(as(editor), kindleOnly, { kindle_url: "https://a.co/d/0aBcDeF" });
    const seen = async (id: string) => [
      (await rpc<Json>(as(member), "media_book_extras", [id])).kindle_url,
      (await rpc<Json>(as(member), "media_item", [id])).audible_url,
    ];
    expect(await seen(both)).toEqual(["https://www.amazon.co.uk/dp/B000000001", "https://www.audible.co.uk/pd/B000000001"]);
    expect(await seen(kindleOnly)).toEqual(["https://a.co/d/0aBcDeF", null]);
    expect(await seen(audibleOnly)).toEqual([null, "https://www.audible.com/pd/B000000002"]);
    expect(await seen(neither)).toEqual([null, null]);
    // Clearing the Audible link through the book form keeps the Kindle link.
    await update(as(publisher), both, { title: "Both Links", audible_url: null });
    expect(await seen(both)).toEqual(["https://www.amazon.co.uk/dp/B000000001", null]);
  });

  it("is executable by signed-in users only", async () => {
    const [r] = await db.raw<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'public.media_admin_book_details_patch(uuid, jsonb)', 'execute') anon, has_function_privilege('authenticated', 'public.media_admin_book_details_patch(uuid, jsonb)', 'execute') auth",
    );
    expect(r).toEqual({ anon: false, auth: true });
  });
});
