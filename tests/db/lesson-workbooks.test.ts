import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Lesson builder and private workbooks (20261031000300): teacher-only
 * content never reaches a member payload (media_item, the workbook, or the
 * teacher's preview); who may build, preview, and write; answers private to
 * their author (no teacher, publisher, or super administrator path);
 * versioning across published edits, removal, and reordering; autosave
 * conflicts; and files shown by blocks. Every person and lesson here is
 * synthetic.
 */
type Json = Record<string, unknown>;
type Block = Json & { id: string; revision: number; prompt_revision: number };

const SECRET_NOTE = "TEACHER-SECRET-NOTE-7f3a";
const SECRET_BLOCK = "TEACHER-ONLY-BLOCK-91cd";
const SECRET_PROMPT_NOTE = "TEACHER-PROMPT-NOTE-2b6e";
const ANSWER = "My private answer 5c1d about grace.";

describeDb("lesson builder and private workbooks", () => {
  let db: TestDb;
  let admin: string;
  let editor: string;
  let publisher: string;
  let mediaMgr: string;
  let m1: string;
  let m2: string;
  let pending: string;
  let youth: string;
  let lesson: string;
  let blocks: Record<string, Block>;

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
  const saveBlock = (actor: Actor, item: string, block: Json, base: number | null = null) =>
    rpc<Json>(actor, "media_admin_lesson_block_save", [item, j(block), base]);
  const addBlock = async (actor: Actor, item: string, block: Json) => {
    const r = await saveBlock(actor, item, block);
    expect(r.status).toBe("saved");
    return r.block as Block;
  };
  const workbook = (actor: Actor, item: string, preview = false) => rpc<Json>(actor, "media_lesson_workbook", [item, preview]);
  const answer = (actor: Actor, item: string, block: string, text: string, base: number, force = false) =>
    rpc<Json>(actor, "media_workbook_answer_save", [item, block, text, base, force]);
  const answersOf = (wb: Json) => wb.answers as Array<Json & { block_id: string; state: string; body: string; prompt_snapshot: string }>;
  const status = (actor: Actor, id: string, action: string) => rpc<Json>(actor, "media_admin_item_status", [id, action, null, null, action === "publish" ? "public" : null]);
  const noSecrets = (payload: unknown) => {
    const text = j(payload);
    for (const s of [SECRET_NOTE, SECRET_BLOCK, SECRET_PROMPT_NOTE]) expect(text).not.toContain(s);
    expect(text).not.toContain("teacher_note");
    expect(text).not.toContain("teacher_only");
  };
  const putObject = (actor: Actor, bucket: string, name: string, size = 1000, mimetype = "image/jpeg") =>
    db.query(actor, "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)", [
      bucket,
      name,
      actor.role === "authenticated" ? actor.userId : null,
      j({ size, mimetype }),
    ]);
  const readyImage = async () => {
    const begun = await rpc<Json>(as(mediaMgr), "media_admin_asset_begin", ["image", "Synthetic image", "synthetic.jpg", "image/jpeg", 1000, randomUUID(), null, null]);
    const id = begun.id as string;
    await putObject(as(mediaMgr), "media", begun.upload_path as string);
    await rpc(as(mediaMgr), "media_admin_asset_processing", [id]);
    const path = `assets/${id}/processed.webp`;
    await putObject(as(mediaMgr), "media", path, 500, "image/webp");
    await rpc(as(mediaMgr), "media_admin_asset_complete", [id, path, null, "image/webp", 100, 100, null, "browser"]);
    await rpc(as(mediaMgr), "media_admin_asset_update", [id, j({ rights: "church_owned", confirm_rights: true, public_ok: false })]);
    return { id, path };
  };
  const canRead = async (actor: Actor, name: string) =>
    (await db.query(actor, "select 1 from storage.objects where bucket_id = 'media' and name = $1", [name])).length === 1;

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approved = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approved) await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("wb.admin@example.test", "Synthetic Admin");
    editor = await mk("wb.editor@example.test", "Synthetic Editor");
    publisher = await mk("wb.publisher@example.test", "Synthetic Publisher");
    mediaMgr = await mk("wb.media@example.test", "Synthetic Media");
    m1 = await mk("wb.m1@example.test", "Alpha Member");
    m2 = await mk("wb.m2@example.test", "Bravo Member");
    pending = await mk("wb.pending@example.test", "Pending Person", false);
    youth = await mk("wb.youth@example.test", "Synthetic Youth");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youth]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(editor, "content_editor");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(mediaMgr, "media_manager");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("lets an editor build a draft lesson from blocks, teacher fields included for editors", async () => {
    lesson = (await rpc<Json>(as(editor), "media_admin_item_save", [null, j({ kind: "lesson", title: "Synthetic workbook lesson", delivered_on: "2026-11-01", notes: "Member-visible lesson notes." }), null])).id as string;
    const intro = await addBlock(as(editor), lesson, { kind: "title_intro", heading: "Welcome", body: "Intro text." });
    const scripture = await addBlock(as(editor), lesson, { kind: "scripture", scripture_ref: "John 3:16–18", teacher_note: SECRET_NOTE });
    const q1 = await addBlock(as(editor), lesson, { kind: "response", prompt: "What does grace mean to you?", teacher_note: SECRET_PROMPT_NOTE });
    const hidden = await addBlock(as(editor), lesson, { kind: "illustration", body: SECRET_BLOCK, teacher_only: true });
    const q2 = await addBlock(as(editor), lesson, { kind: "discussion", prompt: "How will you share it this week?" });
    blocks = { intro, scripture, q1, hidden, q2 };
    expect([intro, scripture, q1, hidden, q2].map((b) => b.position)).toEqual([1, 2, 3, 4, 5]);

    const admin = await rpc<Json>(as(editor), "media_admin_lesson_blocks", [lesson]);
    const list = admin.blocks as Block[];
    expect(list.map((b) => b.id)).toEqual([intro.id, scripture.id, q1.id, hidden.id, q2.id]);
    expect(list.find((b) => b.id === scripture.id)!.teacher_note).toBe(SECRET_NOTE);
    expect(list.find((b) => b.id === hidden.id)!.teacher_only).toBe(true);
    expect(admin.can_edit).toBe(true);
    expect(admin.can_publish).toBe(false);

    // Idempotent creation by client key.
    const key = randomUUID();
    const a = await addBlock(as(editor), lesson, { kind: "closing", body: "Go in peace.", client_key: key });
    const b = await addBlock(as(editor), lesson, { kind: "closing", body: "Go in peace.", client_key: key });
    expect(b.id).toBe(a.id);
    blocks.closing = a;
  });

  it("validates blocks", async () => {
    await fails(as(editor), "media_admin_lesson_block_save", [lesson, j({ kind: "response" }), null], /Write the question/);
    await fails(as(editor), "media_admin_lesson_block_save", [lesson, j({ kind: "scripture" }), null], /scripture reference/);
    await fails(as(editor), "media_admin_lesson_block_save", [lesson, j({ kind: "image" }), null], /ready file/);
    await fails(as(editor), "media_admin_lesson_block_save", [lesson, j({ kind: "html", body: "<script>" }), null], /what kind of block/);
    const devotional = (await rpc<Json>(as(editor), "media_admin_item_save", [null, j({ kind: "devotional", title: "Synthetic devotional" }), null])).id as string;
    await fails(as(editor), "media_admin_lesson_block_save", [devotional, j({ kind: "teaching", body: "x" }), null], /Lesson not found/);
  });

  it("keeps builder functions from members, pending people, youth, and visitors", async () => {
    for (const actor of [as(m1), as(pending), as(youth), anon]) {
      await fails(actor, "media_admin_lesson_blocks", [lesson]);
      await fails(actor, "media_admin_lesson_block_save", [lesson, j({ kind: "teaching", body: "x" }), null]);
      await fails(actor, "media_admin_lesson_block_remove", [lesson, blocks.intro.id, null]);
      await fails(actor, "media_admin_lesson_blocks_reorder", [lesson, [blocks.intro.id]]);
      await fails(actor, "media_lesson_workbook", [lesson, true]);
    }
    // The tables themselves are closed to the API roles.
    for (const table of ["media.lesson_blocks", "media.workbook_answers", "media.workbook_notes"]) {
      await expect(db.query(as(m1), `select * from ${table}`)).rejects.toThrow(/permission denied/);
      await expect(db.query(as(admin), `select * from ${table}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("previews the member projection without teacher content", async () => {
    const preview = await workbook(as(editor), lesson, true);
    expect(preview.preview).toBe(true);
    const ids = (preview.blocks as Block[]).map((b) => b.id);
    expect(ids).toEqual([blocks.intro.id, blocks.scripture.id, blocks.q1.id, blocks.q2.id, blocks.closing.id]);
    noSecrets(preview);
  });

  it("doesn't open a draft lesson's workbook to members", async () => {
    await fails(as(m1), "media_lesson_workbook", [lesson, false], /Not found/);
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.q1.id, "x", 0, false], /Not found/);
    // Editors can't publish; publishers can.
    await fails(as(editor), "media_admin_item_status", [lesson, "publish", null, null, null], /permission/);
    expect((await status(as(publisher), lesson, "publish")).state).toBe("live");
  });

  it("never sends teacher content to members (media_item, workbook)", async () => {
    const item = await rpc<Json>(as(m1), "media_item", [lesson]);
    expect(item.notes).toBe("Member-visible lesson notes.");
    noSecrets(item);
    const wb = await workbook(as(m1), lesson);
    expect(wb.available).toBe(true);
    expect((wb.blocks as Block[]).map((b) => b.id)).not.toContain(blocks.hidden.id);
    noSecrets(wb);
    // A publisher's own workbook (not the preview) is the member projection too.
    noSecrets(await workbook(as(publisher), lesson));
  });

  it("keeps teacher content out of a public lesson for visitors", async () => {
    const pub = (await rpc<Json>(as(publisher), "media_admin_item_save", [
      null,
      j({ kind: "lesson", title: "Synthetic public workbook lesson", delivered_on: "2026-11-08", audience: "public", confirm_public: "public" }),
      null,
    ])).id as string;
    await addBlock(as(publisher), pub, { kind: "teaching", body: "Public teaching.", teacher_note: SECRET_NOTE });
    await addBlock(as(publisher), pub, { kind: "illustration", body: SECRET_BLOCK, teacher_only: true });
    await status(as(publisher), pub, "publish");
    noSecrets(await rpc<Json>(anon, "media_item", [pub]));
    noSecrets(await rpc<Json>(as(youth), "media_item", [pub]));
    // Workbooks are for approved adult members only, even on public lessons.
    await fails(anon, "media_lesson_workbook", [pub, false]);
    await fails(as(youth), "media_lesson_workbook", [pub, false], /approved members/);
    await fails(as(pending), "media_lesson_workbook", [pub, false], /approved members/);
  });

  it("refuses youth and pending accounts on a members-only lesson workbook", async () => {
    for (const actor of [as(youth), as(pending)]) {
      await fails(actor, "media_lesson_workbook", [lesson, false], /approved members/);
      await fails(actor, "media_workbook_answer_save", [lesson, blocks.q1.id, "x", 0, false], /approved members/);
      await fails(actor, "media_workbook_note_save", [lesson, "x", 0, false], /approved members/);
      await fails(actor, "media_workbooks", []);
    }
  });

  it("autosaves answers with version checks (conflict, force, retry)", async () => {
    const first = await answer(as(m1), lesson, blocks.q1.id, ANSWER, 0);
    expect(first).toMatchObject({ status: "saved", version: 1 });
    // The same save retried: no conflict, no new version.
    expect(await answer(as(m1), lesson, blocks.q1.id, ANSWER, 0)).toMatchObject({ status: "saved", version: 1 });
    // Another tab still on version 0 with different text.
    const stale = await answer(as(m1), lesson, blocks.q1.id, "Other tab text", 0);
    expect(stale.status).toBe("conflict");
    expect((stale.current as Json).body).toBe(ANSWER);
    expect((stale.current as Json).version).toBe(1);
    // "Keep mine".
    expect(await answer(as(m1), lesson, blocks.q1.id, "Other tab text", 0, true)).toMatchObject({ status: "saved", version: 2 });
    expect(await answer(as(m1), lesson, blocks.q1.id, ANSWER, 2)).toMatchObject({ status: "saved", version: 3 });
    expect(await answer(as(m1), lesson, blocks.q2.id, "Second answer.", 0)).toMatchObject({ status: "saved", version: 1 });
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.q1.id, "x".repeat(10001), 3, false], /at most 10,000/);
    // Not answerable: teacher-only, non-question, and another lesson's block.
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.hidden.id, "x", 0, false], /no longer part/);
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.intro.id, "x", 0, false], /no longer part/);

    const wb = await workbook(as(m1), lesson);
    const a = answersOf(wb).find((x) => x.block_id === blocks.q1.id)!;
    expect(a).toMatchObject({ body: ANSWER, version: 3, state: "current", prompt_snapshot: "What does grace mean to you?" });
  });

  it("keeps answers private from other members, teachers, publishers, and super administrators", async () => {
    for (const actor of [as(m2), as(editor), as(publisher), as(admin)]) {
      const wb = await workbook(actor, lesson);
      expect(answersOf(wb)).toEqual([]);
      expect(j(wb)).not.toContain(ANSWER);
      expect(await rpc<Json[]>(actor, "media_workbooks")).toEqual([]);
    }
    for (const actor of [as(editor), as(publisher), as(admin)]) {
      expect(j(await workbook(actor, lesson, true))).not.toContain(ANSWER);
      expect(j(await rpc(actor, "media_admin_lesson_blocks", [lesson]))).not.toContain(ANSWER);
      expect(j(await rpc(actor, "media_admin_item", [lesson]))).not.toContain(ANSWER);
    }
    // Another member saving "their" answer to the same block creates their own row.
    expect(await answer(as(m2), lesson, blocks.q1.id, "Bravo's answer.", 0)).toMatchObject({ status: "saved", version: 1 });
    expect(answersOf(await workbook(as(m1), lesson)).find((x) => x.block_id === blocks.q1.id)!.body).toBe(ANSWER);
    // Deleting is per member.
    await rpc(as(m2), "media_workbook_delete", [lesson, null]);
    expect(answersOf(await workbook(as(m1), lesson))).toHaveLength(2);
    // Nothing about answers reaches the audit log.
    expect(j(await db.raw("select * from public.audit_log"))).not.toContain(ANSWER);
  });

  it("only lets publishers change a published lesson's blocks", async () => {
    await fails(as(editor), "media_admin_lesson_block_save", [lesson, j({ id: blocks.q1.id, prompt: "Changed" }), blocks.q1.revision], /Only publishers/);
    await fails(as(editor), "media_admin_lesson_block_remove", [lesson, blocks.q2.id, null], /Only publishers/);
    expect((await rpc<Json>(as(editor), "media_admin_lesson_blocks", [lesson])).can_edit).toBe(false);
  });

  it("flags a reworded question and keeps the original wording with the answer", async () => {
    const r = await saveBlock(as(publisher), lesson, { id: blocks.q1.id, prompt: "What does grace look like in your week?" }, blocks.q1.revision);
    expect(r.status).toBe("saved");
    const q1 = r.block as Block;
    expect(q1.id).toBe(blocks.q1.id);
    expect(q1.revision).toBe(blocks.q1.revision + 1);
    expect(q1.prompt_revision).toBe(2);
    blocks.q1 = q1;
    // A teacher-note edit is a revision but not a new question.
    const r2 = await saveBlock(as(publisher), lesson, { id: blocks.q2.id, teacher_note: SECRET_PROMPT_NOTE }, blocks.q2.revision);
    blocks.q2 = r2.block as Block;
    expect(blocks.q2.prompt_revision).toBe(1);

    const wb = await workbook(as(m1), lesson);
    noSecrets(wb);
    const a1 = answersOf(wb).find((x) => x.block_id === blocks.q1.id)!;
    expect(a1).toMatchObject({ state: "changed", body: ANSWER, prompt_snapshot: "What does grace mean to you?", block_revision: 1 });
    expect(answersOf(wb).find((x) => x.block_id === blocks.q2.id)!.state).toBe("current");
    // Editing the answer keeps it flagged until the member accepts the new wording.
    await answer(as(m1), lesson, blocks.q1.id, `${ANSWER} More.`, 3);
    expect(answersOf(await workbook(as(m1), lesson)).find((x) => x.block_id === blocks.q1.id)!.state).toBe("changed");
    const accepted = await rpc<Json>(as(m1), "media_workbook_answer_accept", [lesson, blocks.q1.id]);
    expect(accepted).toMatchObject({ state: "current", block_revision: 2, prompt_snapshot: "What does grace look like in your week?" });
  });

  it("detects a teacher's concurrent block edit", async () => {
    const stale = blocks.intro.revision;
    expect((await saveBlock(as(publisher), lesson, { id: blocks.intro.id, body: "Edited by A." }, stale)).status).toBe("saved");
    const conflict = await saveBlock(as(admin), lesson, { id: blocks.intro.id, body: "Edited by B." }, stale);
    expect(conflict.status).toBe("conflict");
    expect((conflict.current as Json).body).toBe("Edited by A.");
    blocks.intro = conflict.current as Block;
    // Removal checks the revision too.
    expect((await rpc<Json>(as(publisher), "media_admin_lesson_block_remove", [lesson, blocks.intro.id, stale])).status).toBe("conflict");
  });

  it("reorders without changing identity", async () => {
    const ids = [blocks.closing.id, blocks.q2.id, blocks.hidden.id, blocks.q1.id, blocks.scripture.id, blocks.intro.id];
    expect((await rpc<Json>(as(publisher), "media_admin_lesson_blocks_reorder", [lesson, ids])).status).toBe("saved");
    const after = (await rpc<Json>(as(publisher), "media_admin_lesson_blocks", [lesson])).blocks as Block[];
    expect(after.map((b) => b.id)).toEqual(ids);
    expect(after.find((b) => b.id === blocks.q1.id)!.revision).toBe(blocks.q1.revision);
    const wb = await workbook(as(m1), lesson);
    expect((wb.blocks as Block[]).map((b) => b.id)).toEqual(ids.filter((id) => id !== blocks.hidden.id));
    expect(answersOf(wb).find((x) => x.block_id === blocks.q1.id)!.body).toBe(`${ANSWER} More.`);
    // A stale or partial list is refused.
    expect((await rpc<Json>(as(publisher), "media_admin_lesson_blocks_reorder", [lesson, ids.slice(1)])).status).toBe("conflict");
    expect((await rpc<Json>(as(publisher), "media_admin_lesson_blocks_reorder", [lesson, [...ids, randomUUID()]])).status).toBe("conflict");
  });

  it("keeps answers to a removed question for their author", async () => {
    const r = await rpc<Json>(as(publisher), "media_admin_lesson_block_remove", [lesson, blocks.q2.id, blocks.q2.revision]);
    expect(r.status).toBe("removed");
    const wb = await workbook(as(m1), lesson);
    expect((wb.blocks as Block[]).map((b) => b.id)).not.toContain(blocks.q2.id);
    const kept = answersOf(wb).find((x) => x.block_id === blocks.q2.id)!;
    expect(kept).toMatchObject({ state: "removed", body: "Second answer.", prompt_snapshot: "How will you share it this week?" });
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.q2.id, "x", 1, false], /no longer part/);
    const admin = await rpc<Json>(as(publisher), "media_admin_lesson_blocks", [lesson]);
    expect((admin.removed as Block[]).map((b) => b.id)).toEqual([blocks.q2.id]);
    // Restoring brings the same block (and the answer) back.
    await rpc(as(publisher), "media_admin_lesson_block_restore", [lesson, blocks.q2.id]);
    expect(answersOf(await workbook(as(m1), lesson)).find((x) => x.block_id === blocks.q2.id)!.state).toBe("current");
    // A question made teacher-only reads as removed for the member (with their own wording copy only).
    const q2 = ((await rpc<Json>(as(publisher), "media_admin_lesson_blocks", [lesson])).blocks as Block[]).find((b) => b.id === blocks.q2.id)!;
    await saveBlock(as(publisher), lesson, { id: q2.id, teacher_only: true }, q2.revision);
    const wb2 = await workbook(as(m1), lesson);
    expect(answersOf(wb2).find((x) => x.block_id === blocks.q2.id)!.state).toBe("removed");
    noSecrets(wb2);
  });

  it("autosaves private notes and lists and deletes my workbooks", async () => {
    expect(await rpc<Json>(as(m1), "media_workbook_note_save", [lesson, "My notes.", 0, false])).toMatchObject({ status: "saved", version: 1 });
    const c = await rpc<Json>(as(m1), "media_workbook_note_save", [lesson, "Other tab.", 0, false]);
    expect(c.status).toBe("conflict");
    expect((c.current as Json).body).toBe("My notes.");
    expect(await rpc<Json>(as(m1), "media_workbook_note_save", [lesson, "Other tab.", 0, true])).toMatchObject({ status: "saved", version: 2 });
    expect(((await workbook(as(m1), lesson)).note as Json).body).toBe("Other tab.");
    expect(((await workbook(as(m2), lesson)).note)).toBeNull();
    const mine = await rpc<Json[]>(as(m1), "media_workbooks");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ item_id: lesson, available: true, title: "Synthetic workbook lesson", has_note: true });
    expect(mine[0].answers).toBe(2);
  });

  it("closes an unpublished lesson's workbook, but members keep their own text", async () => {
    await status(as(publisher), lesson, "unpublish");
    await fails(as(m2), "media_lesson_workbook", [lesson, false], /Not found/);
    await fails(as(m1), "media_workbook_answer_save", [lesson, blocks.q1.id, "x", 4, false], /Not found/);
    const wb = await workbook(as(m1), lesson);
    expect(wb).toMatchObject({ available: false, lesson: null, blocks: [] });
    expect(answersOf(wb).length).toBe(2);
    expect((await rpc<Json[]>(as(m1), "media_workbooks"))[0]).toMatchObject({ available: false, title: null });
    // Deleting my workbook removes my answers and notes.
    await rpc(as(m1), "media_workbook_delete", [lesson, null]);
    await fails(as(m1), "media_lesson_workbook", [lesson, false], /Not found/);
    expect(await rpc<Json[]>(as(m1), "media_workbooks")).toEqual([]);
    await status(as(publisher), lesson, "publish");
  });

  it("shows a block's image to members who can open the workbook, and counts it as in use", async () => {
    const img = await readyImage();
    const hiddenImg = await readyImage();
    await addBlock(as(publisher), lesson, { kind: "image", asset_id: img.id, caption: "A synthetic picture", alt_text: "A field" });
    await addBlock(as(publisher), lesson, { kind: "image", asset_id: hiddenImg.id, teacher_only: true });
    const wb = await workbook(as(m1), lesson);
    const block = (wb.blocks as Array<Json & { kind: string; asset: Json | null }>).find((b) => b.kind === "image")!;
    expect(block.asset).toMatchObject({ asset_id: img.id, path: img.path, alt: "A field" });
    expect(await canRead(as(m1), img.path)).toBe(true);
    expect(await canRead(as(m2), img.path)).toBe(true);
    expect(await canRead(as(youth), img.path)).toBe(false);
    expect(await canRead(anon, img.path)).toBe(false);
    expect(await canRead(as(m1), hiddenImg.path)).toBe(false);
    await fails(as(mediaMgr), "media_admin_asset_remove", [img.id], /still used/);
  });
});
