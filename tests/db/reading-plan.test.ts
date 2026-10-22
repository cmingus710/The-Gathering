import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The unified church reading page (media_reading_plan): a book's assignments
 * with each member's own completion, group plans visible only to the group,
 * book progress kept separate from completions, and private notes linked to
 * the book or one of its assignments. Synthetic data only.
 */
type Json = Record<string, unknown>;

describeDb("church reading plan page: assignments, completions, notes", () => {
  let db: TestDb;
  let admin: string;
  let publisher: string;
  let m1: string; // in the group
  let m2: string; // not in the group
  let pending: string;
  let group: string;
  let book: string;
  let otherBook: string;
  let draftBook: string;
  let week1: string;
  let week2: string;
  let groupWeek: string;
  let otherWeek: string;
  let draftWeek: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const save = (payload: Json) => rpc<Json>(as(publisher), "media_admin_item_save", [null, j(payload), null]).then((r) => r.id as string);
  const publish = (id: string) => rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);
  const plan = (actor: Actor, id = book) => rpc<{ today: string; assignments: Json[]; notes: Json[] }>(actor, "media_reading_plan", [id]);

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approve = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approve) await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("rp.admin@example.test", "Synthetic Admin");
    publisher = await mk("rp.publisher@example.test", "Synthetic Publisher");
    m1 = await mk("rp.m1@example.test", "Synthetic Reader One");
    m2 = await mk("rp.m2@example.test", "Synthetic Reader Two");
    pending = await mk("rp.pending@example.test", "Synthetic Pending", false);
    await db.grantRole(admin, "super_admin");
    await db.grantRole(publisher, "content_publisher");
    group = await rpc<string>(as(admin), "community_group_save", [
      j({ name: "Synthetic Men's Group", summary: "s", about: "a", visibility: "discoverable", leader_id: admin }),
    ]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, m1]);

    book = await save({ kind: "book", title: "Same Title", book_author: "A. Writer", book_current: true });
    // A different book with the same title: nothing may be joined by title.
    otherBook = await save({ kind: "book", title: "Same Title", book_author: "B. Writer" });
    draftBook = await save({ kind: "book", title: "Draft Book", book_author: "C. Writer" });
    await publish(book);
    await publish(otherBook);
    week1 = await save({ kind: "assignment", title: "Week 1", book_id: book, starts_on: "2026-10-01", ends_on: "2026-10-07", instructions: "Chapters 1–2", questions: ["What stood out?"] });
    week2 = await save({ kind: "assignment", title: "Week 2", book_id: book, starts_on: "2026-10-08", ends_on: "2026-10-14", instructions: "Chapters 3–4" });
    groupWeek = await save({ kind: "assignment", title: "Group week", book_id: book, starts_on: "2026-10-01", audience: "group", group_id: group });
    otherWeek = await save({ kind: "assignment", title: "Week 1", book_id: otherBook, starts_on: "2026-10-01" });
    draftWeek = await save({ kind: "assignment", title: "Draft week", book_id: book, starts_on: "2026-10-15" });
    for (const id of [week1, week2, groupWeek, otherWeek]) await publish(id);
  }, 120_000);
  afterAll(async () => db?.destroy());

  it("is for approved members and visible books only", async () => {
    await expect(rpc(anon, "media_reading_plan", [book])).rejects.toThrow(/permission denied/);
    await expect(rpc(as(pending), "media_reading_plan", [book])).rejects.toThrow(/approved members/);
    await expect(plan(as(m1), draftBook)).rejects.toThrow(/Not found/);
    await expect(plan(as(m1), week1)).rejects.toThrow(/Not found/);
  });

  it("lists the book's own visible assignments in date order, using the explicit book link", async () => {
    const p1 = await plan(as(m1));
    expect(p1.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p1.assignments.map((a) => a.id)).toEqual([week1, groupWeek, week2]);
    expect(p1.assignments.map((a) => a.id)).not.toContain(otherWeek);
    expect(p1.assignments.map((a) => a.id)).not.toContain(draftWeek);
    const g = p1.assignments.find((a) => a.id === groupWeek)!;
    expect(g.group_id).toBe(group);
    expect(g.group_name).toBe("Synthetic Men's Group");
    expect(p1.assignments.find((a) => a.id === week1)!.instructions).toBe("Chapters 1–2");
    // Not in the group: the group's plan isn't visible at all.
    expect((await plan(as(m2))).assignments.map((a) => a.id)).toEqual([week1, week2]);
  });

  it("keeps completions per member and per assignment, separate from book progress", async () => {
    await rpc(as(m1), "media_book_progress_save", [book, "reading", "Chapter 9"]);
    await rpc(as(m1), "media_assignment_complete", [week1, true]);
    await rpc(as(m1), "media_assignment_complete", [week2, true]);
    const done = (p: { assignments: Json[] }) => p.assignments.filter((a) => a.completed).map((a) => a.id);
    expect(done(await plan(as(m1)))).toEqual([week1, week2]);
    expect(done(await plan(as(m2)))).toEqual([]);
    expect((await rpc<Json>(as(m1), "media_item", [otherWeek])).completed).toBe(false);
    // Completing every assignment doesn't touch the member's own place or status.
    const progress = (await rpc<Json>(as(m1), "media_book_extras", [book])).progress as Json;
    expect(progress.status).toBe("reading");
    expect(progress.position).toBe("Chapter 9");
    // Undo works.
    await rpc(as(m1), "media_assignment_complete", [week2, false]);
    expect(done(await plan(as(m1)))).toEqual([week1]);
  });

  it("links private notes to a visible assignment and lists only the owner's notes for this book", async () => {
    const onBook = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Book", "About the book", j({ kind: "book", media_item_id: book })]);
    const onWeek = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Week", "About week 1", j({ kind: "book_assignment", media_item_id: week1 })]);
    const onOther = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Other", "Other book", j({ kind: "book_assignment", media_item_id: otherWeek })]);
    expect((onWeek.link as Json).kind).toBe("book_assignment");
    expect((onWeek.link as Json).title).toBe("Week 1");
    // Only assignments the member can see, and only assignments.
    await expect(rpc(as(m2), "journal_entry_create", [randomUUID(), "x", "y", j({ kind: "book_assignment", media_item_id: groupWeek })])).rejects.toThrow(/can't be linked/);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "x", "y", j({ kind: "book_assignment", media_item_id: draftWeek })])).rejects.toThrow(/can't be linked/);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "x", "y", j({ kind: "book_assignment", media_item_id: book })])).rejects.toThrow(/can't be linked/);

    const notes = (await plan(as(m1))).notes.map((n) => n.id);
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(expect.arrayContaining([onBook.id, onWeek.id]));
    expect(notes).not.toContain(onOther.id);
    // Still in My Journal, once each.
    const all = ((await rpc<Json>(as(m1), "journal_entries", [null, "active", 100, 0])).items as Json[]).map((e) => e.id);
    expect(all.filter((id) => id === onWeek.id)).toHaveLength(1);
    // Nobody else sees them, including administrators.
    expect((await plan(as(m2))).notes).toEqual([]);
    expect((await plan(as(admin))).notes).toEqual([]);
    expect(((await plan(as(admin))).assignments as Json[]).every((a) => a.completed === false)).toBe(true);
    // Archived notes leave the list.
    await db.raw("update journal.entries set status = 'archived', archived_at = now() where id = $1", [onBook.id]);
    expect((await plan(as(m1))).notes.map((n) => n.id)).toEqual([onWeek.id]);
  });

  it("keeps a note when the member loses access to its assignment, without naming it", async () => {
    const e = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Group", "Group note", j({ kind: "book_assignment", media_item_id: groupWeek })]);
    await db.raw("delete from community.group_members where group_id = $1 and profile_id = $2", [group, m1]);
    const n = (await plan(as(m1))).notes.find((x) => x.id === e.id)!;
    expect((n.link as Json).available).toBe(false);
    expect((n.link as Json).title).toBeNull();
  });
});
