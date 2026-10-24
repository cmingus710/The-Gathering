import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Learn & Play activities (20261118000200) against a real database: the
 * explicit editor role (never implied by super administrator), the
 * draft → preview → published → archived lifecycle with immutable published
 * versions, text and data sanitization, artwork rights and storage rules,
 * who may play for which child (explicit child, practice permission, no
 * guardian play for a child with their own account), group and window
 * access, progress isolation between children, guardians, and youth
 * accounts, safe behaviour when a new version is published, stale saves
 * from another device, immediate loss of access, and no leader access to
 * individual progress.
 *
 * Every person here is synthetic.
 */
type Json = Record<string, unknown>;
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const ALL = {
  manage_profile: true,
  register: true,
  sign_forms: true,
  media_consent: true,
  view_progress: true,
  practice: true,
  manage_account: true,
  receive_updates: true,
};

describeDb("Learn & Play activities", () => {
  let db: TestDb;
  let superAdmin: string;
  let editor: string;
  let ministry: string;
  let famAdmin: string;
  let policyA: string;
  let policyB: string;
  let leader: string;
  let parentA: string; // kidA and kidC, full permissions
  let parentB: string; // second guardian of kidA: updates and progress summaries only
  let parentD: string; // kidD
  let stranger: string;
  let youthUser: string; // kidY's own account
  let groupA: string;
  let groupB: string;
  let kidA: string;
  let kidC: string;
  let kidD: string;
  let kidY: string;
  let gParentA_kidA: string;
  let open: string; // published, every child
  let openV1: string;
  let grouped: string; // published, groupB only

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
  const mk = async (email: string, name: string) => {
    const id = await db.createAuthUser(email, { fullName: name });
    await db.setStatus(id, "approved");
    return id;
  };
  const content = (over: Json = {}) => ({
    title: "Synthetic Noah's Ark",
    summary: "Help the animals find their way.",
    description: "Read the story, then **find the pairs**.",
    kind: "matching",
    difficulty: "beginner",
    age_min: 4,
    age_max: 7,
    bible_story: "Noah's ark",
    scripture_refs: ["Genesis 6:9-22", "Genesis 9:13"],
    lesson_title: "God keeps his promises",
    lesson_week: ymd(0),
    ...over,
  });
  const save = (activity: string, child: string | null, version: string, p: Json, who: string) =>
    rpc<Json>(as(who), "youth_activity_progress_save", [activity, child, version, j(p)]);
  const homeIds = async (who: string) => ((await rpc<Json>(as(who), "youth_activities_home")).activities as Json[]).map((a) => a.id);
  const publish = (id: string) => rpc<Json>(as(editor), "youth_admin_activity_status", [id, "publish", "publish"]);

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await mk("la.super@example.test", "Synthetic Super");
    editor = await mk("la.editor@example.test", "Synthetic Activity Editor");
    ministry = await mk("la.ministry@example.test", "Synthetic Ministry");
    famAdmin = await mk("la.family@example.test", "Synthetic Family Admin");
    policyA = await mk("la.policya@example.test", "Synthetic Policy A");
    policyB = await mk("la.policyb@example.test", "Synthetic Policy B");
    leader = await mk("la.leader@example.test", "Synthetic Leader");
    parentA = await mk("la.parenta@example.test", "Synthetic Parent A");
    parentB = await mk("la.parentb@example.test", "Synthetic Parent B");
    parentD = await mk("la.parentd@example.test", "Synthetic Parent D");
    stranger = await mk("la.stranger@example.test", "Synthetic Stranger");
    await db.grantRole(superAdmin, "super_admin");
    for (const [who, role] of [
      [editor, "youth_activity_editor"], [ministry, "youth_ministry_admin"], [famAdmin, "family_admin"],
      [policyA, "youth_policy_admin"], [policyB, "youth_policy_admin"], [leader, "youth_leader"],
    ]) await db.grantRole(who, role);

    const p = await rpc<Json>(as(policyA), "youth_admin_policy_save", [null, j({
      title: "Synthetic policy", body: "Synthetic.",
      settings: { multiple_guardians: true, birth_date_required: true, independent_accounts: true, eligibility_rule: "Synthetic rule.",
                  guardian_authorization_required: true, progress_sharing: "youth_choice" },
    })]);
    await rpc(as(policyB), "youth_admin_policy_approve", [p.id, `approve version ${p.version}`, "Synthetic minutes"]);

    const verify = async (guardian: string, name: string, permissions: Json, child?: string) => {
      const r = await rpc<Json>(as(guardian), "youth_guardian_request", [j({ kind: child ? "existing_child" : "new_child", child_name: name, relationship: "parent" })]);
      return rpc<Json>(as(famAdmin), "youth_admin_request_decide", [r.id, j({ decision: "approve", verification_method: "in_person", permissions, ...(child ? { child_id: child } : {}) })]);
    };
    const a = await verify(parentA, "Synthetic Kid A", ALL);
    kidA = a.child_id as string;
    gParentA_kidA = a.guardianship_id as string;
    kidC = (await verify(parentA, "Synthetic Kid C", ALL)).child_id as string;
    await verify(parentB, "Synthetic Kid A", { receive_updates: true, view_progress: true }, kidA);
    kidD = (await verify(parentD, "Synthetic Kid D", ALL)).child_id as string;
    kidY = (await verify(parentA, "Synthetic Kid Y", ALL)).child_id as string;

    groupA = (await rpc<Json>(as(ministry), "youth_admin_group_save", [null, j({ name: "Synthetic Little Ones" })])).id as string;
    groupB = (await rpc<Json>(as(ministry), "youth_admin_group_save", [null, j({ name: "Synthetic Older Kids" })])).id as string;
    await rpc(as(ministry), "youth_admin_leader_set", [groupA, leader, j({ role: "leader", can_publish: true })]);
    await rpc(as(ministry), "youth_admin_leader_set", [groupB, leader, j({ role: "leader", can_publish: true })]);
    for (const kid of [kidA, kidC, kidD, kidY]) await rpc(as(ministry), "youth_enroll", [groupA, kid]);
    await rpc(as(ministry), "youth_enroll", [groupB, kidC]);
    await rpc(as(ministry), "youth_enroll", [groupB, kidY]);

    // kidY activates an independent account.
    await rpc(as(famAdmin), "youth_admin_eligibility_set", [kidY, true]);
    await rpc(as(parentA), "youth_child_save", [kidY, j({ birth_date: ymd(-365 * 13) })]);
    const inv = await rpc<Json>(as(parentA), "youth_account_invite", [kidY, "la.youth@example.test"]);
    youthUser = await db.createAuthUser("la.youth@example.test", { fullName: "Synthetic Youth" });
    await rpc(as(parentA), "youth_account_authorize", [inv.id]);
    await rpc(as(youthUser), "youth_activate", [inv.code]);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("administration", () => {
    it("is closed to clients, visitors, and super administrators without the role", async () => {
      await expect(db.query(as(editor), "select * from youth.activities")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(parentA), "select * from youth.activity_progress")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_activities_home()")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_admin_activities(null)")).rejects.toThrow(/permission denied/);
      const caps = (await db.query<{ c: string }>(as(superAdmin), "select c from public.my_capabilities() c")).map((r) => r.c);
      expect(caps).not.toContain("youth.activities");
      for (const who of [superAdmin, ministry, leader, famAdmin, parentA]) {
        await fails(as(who), "youth_admin_activities", [null], /permission/);
        await fails(as(who), "youth_admin_activity_save", [null, j(content())], /permission/);
      }
      await fails(as(youthUser), "youth_admin_activities", [null], /approved adult/);
      expect((await rpc<Json>(as(editor), "youth_me")).caps).toEqual(["youth.activities"]);
    });

    it("keeps drafts and previews away from members and previews them for editors", async () => {
      const made = await rpc<Json>(as(editor), "youth_admin_activity_save", [null, j(content())]);
      open = made.id as string;
      expect(made.version).toBe(1);
      expect(await homeIds(parentA)).not.toContain(open);
      await fails(as(parentA), "youth_activity", [open, kidA], /Not found/);
      await rpc(as(editor), "youth_admin_activity_status", [open, "ready"]);
      expect((await rpc<Json>(as(editor), "youth_admin_activity", [open])).status).toBe("preview");
      expect(await homeIds(parentA)).not.toContain(open);
      const preview = await rpc<Json>(as(editor), "youth_admin_activity_preview", [open, null]);
      expect(preview).toMatchObject({ title: "Synthetic Noah's Ark", state: "preview", kind: "matching" });
      await fails(as(parentA), "youth_admin_activity_preview", [open, null], /permission/);
      // Editing returns it to draft.
      await rpc(as(editor), "youth_admin_activity_save", [open, j(content())]);
      expect((await rpc<Json>(as(editor), "youth_admin_activity", [open])).status).toBe("draft");
    });

    it("refuses markup, scripts, executable configuration, and bad sources", async () => {
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ description: "Hi <script>alert(1)</script>" }))], /HTML or scripts/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ title: "<img src=x onerror=alert(1)>" }))], /HTML or scripts/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ description: "[x](javascript:alert(1))" }))], /HTML or scripts/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ config: { code: "<script>x()</script>" } }))], /markup or scripts/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ config: { "on-load": "x" } }))], /unsupported field/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ kind: "html5_game" }))], /activity type/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ age_min: 9, age_max: 6 }))], /youngest first/);
      await fails(as(editor), "youth_admin_activity_save", [open, j(content({ content_source: "licensed", content_credit: "" }))], /permission or license/);
      // Control characters are stripped from plain text.
      await rpc(as(editor), "youth_admin_activity_save", [open, j(content({ summary: "Find\u0007 the pairs." }))]);
      const a = await rpc<Json>(as(editor), "youth_admin_activity", [open]);
      expect((a.draft as Json).summary).toBe("Find the pairs.");
      expect((a.draft as Json).scripture_refs).toEqual(["Genesis 6:9-22", "Genesis 9:13"]);
    });

    it("records artwork rights, stores it only at a reserved path, and needs a description to publish", async () => {
      await fails(as(editor), "youth_admin_activity_asset_begin", [open, j({ source_kind: "original" })], /Confirm/);
      await fails(as(editor), "youth_admin_activity_asset_begin", [open, j({ source_kind: "licensed", rights_confirmed: true })], /artist or source/);
      await fails(as(editor), "youth_admin_activity_asset_begin", [open, j({ source_kind: "licensed", source_credit: "Synthetic Studio", source_url: "http://x.test", rights_confirmed: true })], /https/);
      await fails(as(leader), "youth_admin_activity_asset_begin", [open, j({ source_kind: "original", rights_confirmed: true })], /permission/);
      const begun = await rpc<Json>(as(editor), "youth_admin_activity_asset_begin", [open, j({ source_kind: "licensed", source_credit: "Synthetic Studio", license: "Synthetic license", rights_confirmed: true })]);
      const path = begun.path as string;
      expect(path).toBe(`activities/${open}/${begun.id}.webp`);
      const canWrite = async (who: string, name: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_write_object($1) ok", [name]))[0].ok;
      expect(await canWrite(editor, path)).toBe(true);
      expect(await canWrite(editor, `activities/${open}/${randomUUID()}.webp`)).toBe(false);
      expect(await canWrite(superAdmin, path)).toBe(false);
      expect(await canWrite(parentA, path)).toBe(false);
      // The storage policy itself: only the reserved path is accepted.
      await db.query(as(editor), "insert into storage.objects (bucket_id, name) values ('youth', $1)", [path]);
      await expect(db.query(as(editor), "insert into storage.objects (bucket_id, name) values ('youth', $1)", [`activities/${open}/${randomUUID()}.webp`]))
        .rejects.toThrow(/row-level security/);
      await expect(db.query(as(parentA), "insert into storage.objects (bucket_id, name) values ('youth', $1)", [`activities/${open}/${randomUUID()}.webp`]))
        .rejects.toThrow(/row-level security/);
      await rpc(as(editor), "youth_admin_activity_asset_finish", [begun.id, j({ width: 800, height: 600, bytes: 52000 })]);
      expect(await canWrite(editor, path)).toBe(false); // active artwork can't be overwritten or deleted directly
      await rpc(as(editor), "youth_admin_activity_save", [open, j(content({ cover_asset_id: begun.id }))]);
      await fails(as(editor), "youth_admin_activity_status", [open, "publish", "yes"], /Type "publish"/);
      await fails(as(editor), "youth_admin_activity_status", [open, "publish", "publish"], /Describe the cover/);
      await rpc(as(editor), "youth_admin_activity_save", [open, j(content({ cover_asset_id: begun.id, cover_alt: "Animals walking two by two into a wooden ark" }))]);
      const done = await publish(open);
      expect(done.status).toBe("published");
      openV1 = done.published_version_id as string;
      const log = await db.raw<{ details: Json }>("select details from public.audit_log where target_id = $1 and action = 'youth.activity_published'", [open]);
      expect(log.map((l) => l.details)).toEqual([{ version: 1 }]);
      // A published version never changes.
      await expect(db.raw("update youth.activity_versions set title = 'Changed' where id = $1", [openV1])).rejects.toThrow(/can't be changed/);
      await expect(db.raw("delete from youth.activity_versions where id = $1", [openV1])).rejects.toThrow(/kept/);
      // Artwork in a published version is kept.
      await fails(as(editor), "youth_admin_activity_asset_remove", [begun.id], /published version/);
      expect(((await rpc<Json>(as(editor), "youth_admin_activity", [open])).assets as Json[])[0]).toMatchObject({ id: begun.id, locked: true, source_credit: "Synthetic Studio" });
      // Group names only, for editors only.
      expect((await rpc<Json[]>(as(editor), "youth_admin_activity_groups")).map((g) => Object.keys(g).sort())).toEqual([["id", "name"], ["id", "name"]]);
      await fails(as(leader), "youth_admin_activity_groups", [], /permission/);
      // Readable by people the activity is open to, and editors; nobody else.
      const canRead = async (who: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_read_object($1) ok", [path]))[0].ok;
      expect(await canRead(editor)).toBe(true);
      expect(await canRead(parentA)).toBe(true);
      expect(await canRead(youthUser)).toBe(true);
      expect(await canRead(stranger)).toBe(false);
      expect(await canRead(superAdmin)).toBe(false);
      expect(await canRead(parentB)).toBe(false); // no practice permission: nothing to play
    });
  });

  describe("who sees what", () => {
    it("shows published activities only to people who may play, with the children they may play for", async () => {
      const home = await rpc<Json>(as(parentA), "youth_activities_home");
      expect(home.role).toBe("adult");
      // kidY has their own account, so parentA can't play for them.
      expect((home.players as Json[]).map((p) => p.id).sort()).toEqual([kidA, kidC].sort());
      expect(home.other_children).toBe(1);
      const card = (home.activities as Json[]).find((a) => a.id === open)!;
      expect(card).toMatchObject({ title: "Synthetic Noah's Ark", difficulty: "beginner", age_min: 4, this_week: true, cover_alt: "Animals walking two by two into a wooden ark" });
      expect(JSON.stringify(card)).not.toMatch(/Synthetic Studio|license|content_credit|created_by/);
      // A second guardian without the practice permission, a stranger, a leader: nothing to play.
      for (const who of [parentB, stranger, leader, editor]) {
        const h = await rpc<Json>(as(who), "youth_activities_home");
        expect(h.activities).toEqual([]);
        expect(h.players).toEqual([]);
        await fails(as(who), "youth_activity", [open, kidA], /Not found/);
        await fails(as(who), "youth_activity", [open, null], /Not found/);
      }
      const y = await rpc<Json>(as(youthUser), "youth_activities_home");
      expect(y.role).toBe("youth");
      expect((y.players as Json[]).map((p) => p.id)).toEqual([kidY]);
      expect((y.activities as Json[]).map((a) => a.id)).toContain(open);
    });

    it("limits group-assigned activities to children enrolled in those groups", async () => {
      const made = await rpc<Json>(as(editor), "youth_admin_activity_save", [null, j(content({ title: "Synthetic Older Quiz", kind: "quiz", difficulty: "challenge", age_min: 11, age_max: 14 }))]);
      grouped = made.id as string;
      await rpc(as(editor), "youth_admin_activity_groups_set", [grouped, [groupB]]);
      await fails(as(editor), "youth_admin_activity_groups_set", [grouped, [randomUUID()]], /active youth groups/);
      await publish(grouped);
      const a = await rpc<Json>(as(parentA), "youth_activities_home");
      expect(((a.activities as Json[]).find((x) => x.id === grouped)!).players).toEqual([kidC]);
      expect(await homeIds(parentD)).not.toContain(grouped);
      await fails(as(parentA), "youth_activity", [grouped, kidA], /Not found/);
      expect((await rpc<Json>(as(parentA), "youth_activity", [grouped, kidC])).title).toBe("Synthetic Older Quiz");
      expect(await homeIds(youthUser)).toContain(grouped);
      // Removing the child from the group closes it at once.
      await rpc(as(ministry), "youth_unenroll", [groupB, kidC]);
      await fails(as(parentA), "youth_activity", [grouped, kidC], /Not found/);
      await rpc(as(ministry), "youth_enroll", [groupB, kidC]);
    });

    it("respects the availability window and archiving", async () => {
      const made = await rpc<Json>(as(editor), "youth_admin_activity_save", [null, j({ ...content({ title: "Synthetic Later" }), available_from: new Date(Date.now() + 86400000).toISOString() })]);
      await publish(made.id as string);
      expect(await homeIds(parentA)).not.toContain(made.id);
      await fails(as(parentA), "youth_activity", [made.id, kidA], /Not found/);
      await fails(as(editor), "youth_admin_activity_status", [made.id, "archive", "no"], /Type "archive"/);
      await rpc(as(editor), "youth_admin_activity_status", [made.id, "archive", "archive"]);
      await fails(as(editor), "youth_admin_activity_save", [made.id, j(content())], /Restore/);
      await rpc(as(editor), "youth_admin_activity_status", [made.id, "restore"]);
      expect((await rpc<Json>(as(editor), "youth_admin_activity", [made.id])).status).toBe("published");
      await rpc(as(editor), "youth_admin_activity_status", [made.id, "archive", "archive"]);
      expect((await rpc<Json>(as(editor), "youth_admin_activities", ["archived"])).length).toBe(1);
    });

    it("lists this week's lesson for the children in view only", async () => {
      // A leader's assignment to groupB reaches parentA (kidC) and the youth, never parentD.
      const tr = (await db.raw<{ id: string }>(
        `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
         values ('WEB', 'World English Bible', 'Public domain.', 'Public domain', 'public_domain', now(), 'draft', 1) returning id`,
      ))[0].id;
      const plan = (await db.raw<{ id: string }>(
        "insert into bible.plans (title, translation_id, mode, status, published_at) values ('Synthetic Plan', $1, 'personal', 'published', now()) returning id",
        [tr],
      ))[0].id;
      await rpc(as(leader), "youth_learning_assign", [groupB, j({ kind: "reading_plan", ref_id: plan })]);
      const a = await rpc<Json>(as(parentA), "youth_activities_home");
      const d = await rpc<Json>(as(parentD), "youth_activities_home");
      expect((a.lesson as Json[]).length).toBe(1);
      expect(d.lesson).toEqual([]);
    });
  });

  describe("progress", () => {
    it("needs an explicit child for guardians and saves only on that child", async () => {
      await fails(as(parentA), "youth_activity_progress_save", [open, null, openV1, j({ data: {}, revision: 0 })], /Not found/);
      const one = await save(open, kidA, openV1, { data: { found_pairs: 2 }, revision: 0 }, parentA);
      expect(one).toMatchObject({ child_id: kidA, status: "started", revision: 1, version: 1 });
      expect(one.data).toBeUndefined();
      const rows = await db.raw<{ child_id: string; last_operator_id: string }>("select child_id, last_operator_id from youth.activity_progress");
      expect(rows).toEqual([{ child_id: kidA, last_operator_id: parentA }]);
      // Nothing lands in the guardian's own journal or memory history.
      for (const t of ["journal.entries", "memory.attempts", "memory.cards"]) {
        const n = await db.raw<{ n: number }>(`select count(*)::int n from ${t} where profile_id = $1`, [parentA]).catch(() => [{ n: 0 }]);
        expect(n[0].n).toBe(0);
      }
    });

    it("switches progress with the chosen child on a shared device", async () => {
      const a = await rpc<Json>(as(parentA), "youth_activity", [open, kidA]);
      expect(a.child).toEqual({ id: kidA, display_name: "Synthetic Kid A" });
      expect((a.progress as Json).data).toEqual({ found_pairs: 2 });
      const c = await rpc<Json>(as(parentA), "youth_activity", [open, kidC]);
      expect(c.child).toEqual({ id: kidC, display_name: "Synthetic Kid C" });
      expect(c.progress).toBeNull();
      await save(open, kidC, openV1, { data: { found_pairs: 5 }, completed: true, revision: 0 }, parentA);
      expect(((await rpc<Json>(as(parentA), "youth_activity", [open, kidA])).progress as Json).data).toEqual({ found_pairs: 2 });
      expect(((await rpc<Json>(as(parentA), "youth_activity", [open, kidC])).progress as Json)).toMatchObject({ status: "completed", data: { found_pairs: 5 } });
      // Without a chosen child, no one's progress is shown.
      const none = await rpc<Json>(as(parentA), "youth_activity", [open, null]);
      expect(none.child).toBeNull();
      expect(none.progress).toBeNull();
      expect((none.players as Json[]).length).toBe(2);
    });

    it("refuses other families' children, children with their own account, and impersonation", async () => {
      await fails(as(parentA), "youth_activity_progress_save", [open, kidD, openV1, j({ data: {}, revision: 0 })], /Not found/);
      await fails(as(parentD), "youth_activity", [open, kidA], /Not found/);
      await fails(as(parentA), "youth_activity", [open, kidY], /Not found/);
      await fails(as(parentA), "youth_activity_progress_save", [open, kidY, openV1, j({ data: {}, revision: 0 })], /Not found/);
      await fails(as(parentB), "youth_activity_progress_save", [open, kidA, openV1, j({ data: {}, revision: 0 })], /Not found/);
      await fails(as(leader), "youth_activity_progress_save", [open, kidA, openV1, j({ data: {}, revision: 0 })], /Not found/);
      await fails(as(youthUser), "youth_activity_progress_save", [open, kidA, openV1, j({ data: {}, revision: 0 })], /Not found/);
      await fails(as(youthUser), "youth_activity", [open, kidA], /Not found/);
      // The youth plays for themselves without naming a child.
      const y = await save(open, null, openV1, { data: { found_pairs: 1 }, revision: 0 }, youthUser);
      expect(y.child_id).toBe(kidY);
      const mine = await rpc<Json>(as(youthUser), "youth_activity", [open, null]);
      expect((mine.progress as Json).data).toEqual({ found_pairs: 1 });
      expect(JSON.stringify(mine)).not.toContain(kidA);
    });

    it("refuses markup in saved work", async () => {
      await fails(as(parentA), "youth_activity_progress_save", [open, kidA, openV1, j({ data: { note: "<script>x()</script>" }, revision: 1 })], /markup or scripts/);
      await fails(as(parentA), "youth_activity_progress_save", [open, kidA, openV1, j({ data: { note: "x".repeat(40000) }, revision: 1 })], /too/);
    });

    it("doesn't overwrite a save made meanwhile on another device", async () => {
      const next = await save(open, kidA, openV1, { data: { found_pairs: 3 }, revision: 1 }, parentA);
      expect(next.revision).toBe(2);
      const stale = await save(open, kidA, openV1, { data: { found_pairs: 0 }, revision: 1 }, parentA);
      expect(stale).toEqual({ conflict: "revision" });
      expect(((await rpc<Json>(as(parentA), "youth_activity", [open, kidA])).progress as Json).data).toEqual({ found_pairs: 3 });
    });

    it("keeps earlier progress on its own version when a new version is published", async () => {
      await rpc(as(editor), "youth_admin_activity_save", [open, j(content({ title: "Synthetic Noah's Ark (new)", cover_asset_id: null, change_note: "New pairs" }))]);
      // Until published, members still get version 1.
      expect((await rpc<Json>(as(parentA), "youth_activity", [open, kidA])).version).toBe(1);
      expect((await rpc<Json>(as(editor), "youth_admin_activity", [open])).progress_on_published).toBe(3);
      const v2 = (await publish(open)).published_version_id as string;
      const before = await db.raw("select id, data, status, revision, version_id from youth.activity_progress where version_id = $1 order by id", [openV1]);
      // A page still showing version 1 can't write.
      expect(await save(open, kidA, openV1, { data: { found_pairs: 9 }, revision: 2 }, parentA)).toEqual({ conflict: "version" });
      const a = await rpc<Json>(as(parentA), "youth_activity", [open, kidA]);
      expect(a).toMatchObject({ version: 2, title: "Synthetic Noah's Ark (new)", progress: null });
      expect((a.earlier as Json[]).map((e) => [e.version, e.status])).toEqual([[1, "started"]]);
      expect((a.earlier as Json[])[0].data).toBeUndefined();
      await save(open, kidA, v2, { data: { found_pairs: 1 }, revision: 0 }, parentA);
      const after = await db.raw("select id, data, status, revision, version_id from youth.activity_progress where version_id = $1 order by id", [openV1]);
      expect(after).toEqual(before);
      expect((await db.raw("select state from youth.activity_versions where id = $1", [openV1]))[0].state).toBe("retired");
      // The retired version is still there and its progress is not movable.
      await expect(db.raw("delete from youth.activity_versions where id = $1", [openV1])).rejects.toThrow();
    });

    it("gives guardians allowed to see progress counts only, and nothing for a youth who doesn't share", async () => {
      const s = await rpc<Json>(as(parentB), "youth_activity_progress_summary", [kidA]);
      expect(s).toEqual({ shared: true, started: 1, completed: 0, completed_28: 0 });
      await fails(as(stranger), "youth_activity_progress_summary", [kidA], /Not found/);
      await fails(as(leader), "youth_activity_progress_summary", [kidA], /Not found/);
      expect(await rpc<Json>(as(parentA), "youth_activity_progress_summary", [kidY])).toEqual({ shared: false });
      await rpc(as(youthUser), "youth_progress_sharing_set", [true]);
      expect((await rpc<Json>(as(parentA), "youth_activity_progress_summary", [kidY])).started).toBe(1);
    });

    it("closes access at once when a guardian loses the permission, is paused, or the child is restricted", async () => {
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gParentA_kidA, j({ permissions: { ...ALL, practice: false } })]);
      await fails(as(parentA), "youth_activity", [open, kidA], /Not found/);
      expect((await rpc<Json>(as(parentA), "youth_activity", [open, kidC])).child).toMatchObject({ id: kidC });
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gParentA_kidA, j({ permissions: ALL })]);
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gParentA_kidA, j({ status: "suspended" })]);
      await fails(as(parentA), "youth_activity", [open, kidA], /Not found/);
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gParentA_kidA, j({ status: "verified", verification_method: "in_person" })]);
      expect((await rpc<Json>(as(parentA), "youth_activity", [open, kidA])).child).toMatchObject({ id: kidA });
      await rpc(as(famAdmin), "youth_admin_child_restrict", [kidA, true, "other"]);
      await fails(as(parentA), "youth_activity", [open, kidA], /Not found/);
      await rpc(as(famAdmin), "youth_admin_child_restrict", [kidA, false, null]);
      // A paused child isn't offered as a player.
      await rpc(as(parentA), "youth_child_save", [kidC, j({ participation: "paused" })]);
      expect(((await rpc<Json>(as(parentA), "youth_activities_home")).players as Json[]).map((p) => p.id)).toEqual([kidA]);
      await rpc(as(parentA), "youth_child_save", [kidC, j({ participation: "active" })]);
    });

    it("never shows individual progress to leaders, editors, or administrators", async () => {
      for (const who of [leader, editor, ministry, famAdmin, superAdmin]) {
        const blobs = [
          JSON.stringify(await rpc(as(who), "youth_activities_home").catch(() => null)),
          JSON.stringify(await rpc(as(who), "youth_admin_activity", [open]).catch(() => null)),
        ].join(" ");
        expect(blobs).not.toContain("found_pairs");
        expect(blobs).not.toContain(kidA);
      }
    });
  });
});
