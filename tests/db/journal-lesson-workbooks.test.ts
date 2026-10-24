import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, service, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

const MIGRATION = "20261120000100";

/**
 * Lesson answers and notes in My Journal (20261120000100): workbook rows
 * written before the step are copied into journal.entries with owner, text,
 * version, timestamps, lesson, question, and wording intact; running the
 * import again copies nothing twice and never restores an entry the member
 * deleted; lesson writing after the step lands in My Journal and stays
 * editable from both places; and nobody but the author can reach any of it.
 * Every person and lesson here is synthetic.
 */
type Json = Record<string, unknown>;
type Block = Json & { id: string; revision: number; prompt_revision: number };
type Entry = Json & { id: string; title: string; body: string; version: number; link: Json | null };
type Old = { profile_id: string; item_id: string; block_id?: string; body: string; version: number; created_at: Date; updated_at: Date; prompt_snapshot?: string; block_revision?: number };

describeDb("lesson workbooks in My Journal", () => {
  let db: TestDb;
  let admin: string;
  let publisher: string;
  let m1: string;
  let m2: string;
  let youth: string;
  let lesson: string;
  let hiddenLesson: string;
  let q1: Block;
  let q2: Block;
  let q3: Block;
  let hq: Block;
  let oldAnswers: Old[];
  let oldNotes: Old[];

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
  const j = (v: unknown) => JSON.stringify(v);
  const addBlock = async (item: string, block: Json) => {
    const r = await rpc<Json>(as(publisher), "media_admin_lesson_block_save", [item, j(block), null]);
    expect(r.status).toBe("saved");
    return r.block as Block;
  };
  const status = (id: string, action: string) => rpc<Json>(as(publisher), "media_admin_item_status", [id, action, null, null, action === "publish" ? "public" : null]);
  const newLesson = async (title: string) =>
    (await rpc<Json>(as(publisher), "media_admin_item_save", [null, j({ kind: "lesson", title, delivered_on: "2026-11-01" }), null])).id as string;
  const workbook = (actor: Actor, item: string) => rpc<Json>(actor, "media_lesson_workbook", [item, false]);
  const answersOf = (wb: Json) => wb.answers as Array<Json & { entry_id: string; block_id: string; state: string; body: string; version: number; prompt_snapshot: string }>;
  const journal = async (actor: Actor, status = "active", q: string | null = null) =>
    (await rpc<{ total: number; items: Entry[] }>(actor, "journal_entries", [q, status, 100, 0])).items;
  const lessonEntries = (rows: Entry[]) => rows.filter((e) => e.link && ["lesson_answer", "lesson_notes"].includes(String(e.link.kind)));
  const verify = async () => (await db.raw<{ v: Json }>("select journal.verify_workbook_import() as v"))[0].v;
  const importAgain = async () => (await db.raw<{ v: Json }>("select journal.import_workbooks() as v"))[0].v;

  beforeAll(async () => {
    db = await TestDb.create({ before: MIGRATION });
    const mk = async (email: string, name: string) => {
      const id = await db.createAuthUser(email, { fullName: name });
      await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("jw.admin@example.test", "Synthetic Admin");
    publisher = await mk("jw.publisher@example.test", "Synthetic Publisher");
    m1 = await mk("jw.m1@example.test", "Alpha Member");
    m2 = await mk("jw.m2@example.test", "Bravo Member");
    youth = await mk("jw.youth@example.test", "Synthetic Youth");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youth]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(publisher, "content_publisher");

    // Before the step: two lessons with answers and notes in the old tables.
    lesson = await newLesson("Synthetic journal lesson");
    await addBlock(lesson, { kind: "teaching", body: "Teaching." });
    q1 = await addBlock(lesson, { kind: "response", prompt: "What does grace mean to you?" });
    q2 = await addBlock(lesson, { kind: "discussion", prompt: "Who will you tell?" });
    q3 = await addBlock(lesson, { kind: "reflection", prompt: "What will you change?" });
    await status(lesson, "publish");
    hiddenLesson = await newLesson("Synthetic lesson later hidden");
    hq = await addBlock(hiddenLesson, { kind: "response", prompt: "A question on a lesson that goes away" });
    await status(hiddenLesson, "publish");

    const save = (actor: string, item: string, block: string, text: string, base: number) => rpc<Json>(as(actor), "media_workbook_answer_save", [item, block, text, base, false]);
    await save(m1, lesson, q1.id, "Alpha answer one", 0);
    await save(m1, lesson, q1.id, "Alpha answer one, edited", 1);
    await save(m1, lesson, q2.id, "Alpha answer two", 0);
    await save(m1, lesson, q3.id, "", 0); // A box opened but never written in.
    await save(m2, lesson, q1.id, "Bravo answer one", 0);
    await save(m1, hiddenLesson, hq.id, "Answer on the hidden lesson", 0);
    await rpc(as(m1), "media_workbook_note_save", [lesson, "Alpha lesson notes", 0, false]);
    await rpc(as(m2), "media_workbook_note_save", [lesson, "Bravo lesson notes", 0, false]);
    // The question changes after Alpha answered; the answer must stay flagged.
    const r = await rpc<Json>(as(publisher), "media_admin_lesson_block_save", [lesson, j({ id: q2.id, prompt: "Who will you tell this week?" }), q2.revision]);
    q2 = r.block as Block;
    await status(hiddenLesson, "unpublish");
    // Distinct past timestamps, so preserving them is observable.
    await db.raw("update media.workbook_answers set created_at = now() - interval '30 days' - (random() * interval '1 day'), updated_at = now() - interval '20 days'");
    await db.raw("update media.workbook_notes set created_at = now() - interval '40 days', updated_at = now() - interval '10 days'");
    // An existing journal entry that must come through untouched.
    await rpc(as(m1), "journal_entry_create", [randomUUID(), "Existing entry", "Written before the step.", null]);

    oldAnswers = await db.raw<Old>("select * from media.workbook_answers order by profile_id, block_id");
    oldNotes = await db.raw<Old>("select * from media.workbook_notes order by profile_id, item_id");
    expect(oldAnswers).toHaveLength(5);
    expect(oldNotes).toHaveLength(2);

    await db.applyMigrations({ from: MIGRATION });
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("copies every workbook answer and note with owner, text, version, timestamps, and source", async () => {
    for (const a of oldAnswers) {
      const rows = await db.raw<Json>(
        "select * from journal.entries where profile_id = $1 and link_kind = 'lesson_answer' and lesson_block_id = $2",
        [a.profile_id, a.block_id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        body: a.body,
        version: a.version,
        media_item_id: a.item_id,
        block_revision: a.block_revision,
        question: a.prompt_snapshot,
        status: "active",
        title: "",
      });
      expect((rows[0].created_at as Date).toISOString()).toBe(a.created_at.toISOString());
      expect((rows[0].updated_at as Date).toISOString()).toBe(a.updated_at.toISOString());
    }
    for (const n of oldNotes) {
      const rows = await db.raw<Json>("select * from journal.entries where profile_id = $1 and link_kind = 'lesson_notes' and media_item_id = $2", [n.profile_id, n.item_id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ body: n.body, version: n.version });
      expect((rows[0].created_at as Date).toISOString()).toBe(n.created_at.toISOString());
      expect((rows[0].updated_at as Date).toISOString()).toBe(n.updated_at.toISOString());
    }
    // The old tables are left as they were.
    expect(await db.raw("select * from media.workbook_answers order by profile_id, block_id")).toEqual(oldAnswers);
    expect(await db.raw("select * from media.workbook_notes order by profile_id, item_id")).toEqual(oldNotes);
    expect(await verify()).toMatchObject({
      source_answers: 5, source_notes: 2, not_imported: 0, association_mismatch: 0, duplicate_answers: 0, duplicate_notes: 0,
      unchanged: 7, changed_since_import: 0, deleted_since_import: 0,
    });
  });

  it("keeps existing journal entries intact", async () => {
    const mine = await journal(as(m1));
    expect(mine.find((e) => e.title === "Existing entry")).toMatchObject({ excerpt: "Written before the step.", link: null });
  });

  it("restores the same answers on the lesson after the step", async () => {
    const wb = await workbook(as(m1), lesson);
    const a = answersOf(wb);
    expect(a.find((x) => x.block_id === q1.id)).toMatchObject({ body: "Alpha answer one, edited", version: 2, state: "current" });
    expect(a.find((x) => x.block_id === q2.id)).toMatchObject({ body: "Alpha answer two", state: "changed", prompt_snapshot: "Who will you tell?" });
    expect(a.every((x) => typeof x.entry_id === "string")).toBe(true);
    expect((wb.note as Json).body).toBe("Alpha lesson notes");
    expect(answersOf(await workbook(as(m2), lesson)).map((x) => x.body)).toEqual(["Bravo answer one"]);
    // A lesson the member can no longer open still shows their own text.
    const hidden = await workbook(as(m1), hiddenLesson);
    expect(hidden).toMatchObject({ available: false, lesson: null });
    expect(answersOf(hidden)[0]).toMatchObject({ body: "Answer on the hidden lesson", state: "current" });
  });

  it("lists lesson writing in My Journal with its lesson and question", async () => {
    const mine = lessonEntries(await journal(as(m1)));
    // q3's blank box isn't listed; the hidden lesson's answer is, without the lesson's title.
    expect(mine).toHaveLength(4);
    const one = mine.find((e) => e.excerpt === "Alpha answer one, edited")!;
    expect(one.link).toMatchObject({ kind: "lesson_answer", available: true, item_id: lesson, title: "Synthetic journal lesson", question: "What does grace mean to you?", block_id: q1.id, state: "current" });
    const hidden = mine.find((e) => e.excerpt === "Answer on the hidden lesson")!;
    expect(hidden.link).toMatchObject({ kind: "lesson_answer", available: false, item_id: null, title: null, block_id: null });
    expect(hidden.link!.question).toBe("A question on a lesson that goes away");
    expect(mine.find((e) => e.link!.kind === "lesson_notes")!.link).toMatchObject({ available: true, item_id: lesson });
    // Search covers lesson answers.
    expect((await journal(as(m1), "active", "answer two")).map((e) => e.excerpt)).toEqual(["Alpha answer two"]);
  });

  it("saves new lesson answers into My Journal, editable from both places", async () => {
    const lesson2 = await newLesson("Synthetic second lesson");
    const q = await addBlock(lesson2, { kind: "response", prompt: "A new question?" });
    await status(lesson2, "publish");
    expect(await rpc<Json>(as(m1), "media_workbook_answer_save", [lesson2, q.id, "Typed on the lesson", 0, false])).toMatchObject({ status: "saved", version: 1 });
    const entry = lessonEntries(await journal(as(m1))).find((e) => e.excerpt === "Typed on the lesson")!;
    expect(entry.link).toMatchObject({ kind: "lesson_answer", item_id: lesson2, block_id: q.id, question: "A new question?" });

    // Edited in My Journal, then reopened on the lesson.
    expect(await rpc<Json>(as(m1), "journal_entry_save", [entry.id, "My title", "Edited in the journal", 1, false])).toMatchObject({ status: "saved", version: 2 });
    let a = answersOf(await workbook(as(m1), lesson2))[0];
    expect(a).toMatchObject({ entry_id: entry.id, body: "Edited in the journal", version: 2 });
    // A lesson tab still on version 1 is told about the newer text.
    const stale = await rpc<Json>(as(m1), "media_workbook_answer_save", [lesson2, q.id, "Old tab", 1, false]);
    expect(stale).toMatchObject({ status: "conflict", current: { body: "Edited in the journal", version: 2 } });
    expect(await rpc<Json>(as(m1), "media_workbook_answer_save", [lesson2, q.id, "Back on the lesson", 2, false])).toMatchObject({ status: "saved", version: 3 });
    const again = await rpc<Entry>(as(m1), "journal_entry", [entry.id]);
    expect(again).toMatchObject({ title: "My title", body: "Back on the lesson", version: 3 });

    // Saving again never makes a second entry.
    await rpc(as(m1), "media_workbook_answer_save", [lesson2, q.id, "Back on the lesson", 2, false]);
    await rpc(as(m1), "media_workbook_note_save", [lesson2, "Notes", 0, false]);
    await rpc(as(m1), "media_workbook_note_save", [lesson2, "Notes", 0, false]);
    const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from journal.entries where profile_id = $1 and media_item_id = $2", [m1, lesson2]);
    expect(n).toBe(2);

    // Lesson limits hold in the journal editor too.
    await fails(as(m1), "journal_entry_save", [entry.id, "", "x".repeat(10_001), 3, false], /at most 10,000/);
    // Archiving keeps it on the lesson; unlinking detaches it (text kept).
    await rpc(as(m1), "journal_entry_status", [entry.id, "archive"]);
    expect(answersOf(await workbook(as(m1), lesson2))).toHaveLength(1);
    await rpc(as(m1), "journal_entry_unlink", [entry.id]);
    expect(answersOf(await workbook(as(m1), lesson2))).toHaveLength(0);
    a = (await rpc<Entry>(as(m1), "journal_entry", [entry.id])) as unknown as typeof a;
    expect(a).toMatchObject({ body: "Back on the lesson", link: null });
    const [row] = await db.raw<Json>("select link_kind, lesson_block_id, block_revision, media_item_id from journal.entries where id = $1", [entry.id]);
    expect(row).toEqual({ link_kind: "none", lesson_block_id: null, block_revision: null, media_item_id: null });
  });

  it("only makes lesson entries from the lesson", async () => {
    await fails(as(m1), "journal_entry_create", [randomUUID(), "x", "x", j({ kind: "lesson_answer", media_item_id: lesson })], /Unknown link/);
    await fails(as(m1), "journal_entry_create", [randomUUID(), "x", "x", j({ kind: "lesson_notes", media_item_id: lesson })], /Unknown link/);
    // Youth accounts keep their journal but still can't write lesson answers.
    await fails(as(youth), "media_workbook_answer_save", [lesson, q1.id, "x", 0, false], /approved members/);
    await fails(as(youth), "media_workbook_note_save", [lesson, "x", 0, false], /approved members/);
  });

  it("keeps lesson writing private from other members and administrators", async () => {
    const alpha = (await db.raw<{ id: string }>("select id from journal.entries where profile_id = $1 and link_kind = 'lesson_answer' limit 1", [m1]))[0].id;
    for (const actor of [as(m2), as(publisher), as(admin)]) {
      await fails(actor, "journal_entry", [alpha], /not found/);
      await fails(actor, "journal_entry_save", [alpha, "", "taken over", 1, true], /not found/);
      await fails(actor, "journal_entry_delete", [alpha], /not found/);
      expect(j(await journal(actor))).not.toContain("Alpha answer");
      expect(j(await workbook(actor, lesson))).not.toContain("Alpha answer");
    }
    expect(j(await rpc(as(admin), "media_admin_lesson_blocks", [lesson]))).not.toContain("Alpha answer");
    // No API role reaches the tables, the import record, or the operator functions.
    for (const actor of [as(m1), as(admin), service, anon]) {
      for (const table of ["journal.entries", "journal.workbook_imports", "media.workbook_answers", "media.workbook_notes"]) {
        await expect(db.query(actor, `select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      for (const fn of ["journal.import_workbooks()", "journal.verify_workbook_import()"]) {
        await expect(db.query(actor, `select ${fn}`)).rejects.toThrow(/permission denied/);
      }
    }
    expect(j(await db.raw("select * from public.audit_log"))).not.toContain("Alpha answer");
  });

  it("exports lesson answers with their question", async () => {
    const out = await rpc<{ entries: Array<Json & { body: string; link: Json | null }> }>(as(m1), "journal_export");
    const e = out.entries.find((x) => x.body === "Alpha answer two")!;
    expect(e.link).toMatchObject({ kind: "lesson_answer", question: "Who will you tell?", title: "Synthetic journal lesson" });
  });

  it("imports nothing twice and never restores what a member deleted", async () => {
    const before = (await db.raw<{ n: number }>("select count(*)::int n from journal.entries"))[0].n;
    expect(await importAgain()).toEqual({ answers_imported: 0, notes_imported: 0, already_in_journal: 0, kept_as_separate_entries: 0 });
    expect((await db.raw<{ n: number }>("select count(*)::int n from journal.entries"))[0].n).toBe(before);

    // Bravo deletes their imported answer from My Journal; a re-run doesn't bring it back.
    const bravo = (await db.raw<{ id: string }>("select id from journal.entries where profile_id = $1 and link_kind = 'lesson_answer'", [m2]))[0].id;
    await rpc(as(m2), "journal_entry_delete", [bravo]);
    expect((await importAgain()).answers_imported).toBe(0);
    expect(answersOf(await workbook(as(m2), lesson))).toEqual([]);

    // A source row with no import record (e.g. written by an old app server
    // mid-deploy) is picked up; if the member already answered that question
    // in the journal, the old text is kept beside it, not over it.
    await db.raw("delete from journal.workbook_imports where source = 'answer' and profile_id = $1 and source_key = $2", [m1, q1.id]);
    await db.raw("update media.workbook_answers set body = 'Text from an old server' where profile_id = $1 and block_id = $2", [m1, q1.id]);
    expect(await importAgain()).toMatchObject({ answers_imported: 0, kept_as_separate_entries: 1 });
    const copies = await db.raw<Json>("select title, body, link_kind, media_item_id from journal.entries where profile_id = $1 and title = 'Earlier lesson answer'", [m1]);
    expect(copies).toEqual([{ title: "Earlier lesson answer", body: "Text from an old server", link_kind: "lesson", media_item_id: lesson }]);
    expect(answersOf(await workbook(as(m1), lesson)).find((x) => x.block_id === q1.id)!.body).toBe("Alpha answer one, edited");
    expect(await importAgain()).toMatchObject({ answers_imported: 0, kept_as_separate_entries: 0 });

    const v = await verify();
    expect(v).toMatchObject({ not_imported: 0, association_mismatch: 0, duplicate_answers: 0, duplicate_notes: 0, deleted_since_import: 1 });
  });
});
