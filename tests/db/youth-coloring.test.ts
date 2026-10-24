import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializeDoc, type ColoringTemplate } from "@/lib/youth/coloring";
import { COLORING_DEMOS, DEMO_CREDIT } from "@/lib/youth/coloring-demos";
import { checkColoringSvg } from "@/lib/youth/coloring-svg";
import { TEST_DATABASE_URL, TestDb, anon, as } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Bible Coloring Studio (20261122000100) against a real database: coloring
 * pictures only as checked data on Drawing & coloring versions (refusing
 * markup and anything malformed), the ordinary editor save keeping the
 * picture, each child's artwork private to that child's youth account and
 * the guardians who may play for them, saves that never overwrite newer
 * work from another device, artwork kept on its own version when a new one
 * is published, line art readable only where the activity is open, and
 * access closing at once.
 *
 * Every person here is synthetic.
 */
type Json = Record<string, unknown>;
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
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const demo = COLORING_DEMOS[0];
const checked = checkColoringSvg(demo.svg, { story: demo.story, attribution: { source_kind: "original", credit: DEMO_CREDIT, license: "", source_url: null } });
if (!checked.ok) throw new Error(checked.errors.join("\n"));
const picture: ColoringTemplate = checked.template;
const sky = picture.regions[0].id;
const stripe = picture.regions[1].id;

describeDb("Bible Coloring Studio", () => {
  let db: TestDb;
  let superAdmin: string;
  let editor: string;
  let famAdmin: string;
  let ministry: string;
  let policyA: string;
  let policyB: string;
  let leader: string;
  let parentA: string; // kidA and kidC, full permissions
  let parentB: string; // second guardian of kidA: progress summaries only
  let parentD: string;
  let stranger: string;
  let youthUser: string; // kidY's own account
  let kidA: string;
  let kidC: string;
  let kidD: string;
  let kidY: string;
  let gParentA_kidA: string;
  let act: string;
  let v1: string;

  const rpc = async <T = Json>(who: string | null, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(who ? as(who) : anon, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (who: string | null, fn: string, args: unknown[], message: RegExp) => {
    await expect(rpc(who, fn, args)).rejects.toThrow(message);
  };
  const j = (v: unknown) => JSON.stringify(v);
  const mk = async (email: string, name: string) => {
    const id = await db.createAuthUser(email, { fullName: name });
    await db.setStatus(id, "approved");
    return id;
  };
  const content = (over: Json = {}) => ({
    title: "Synthetic Rainbow",
    summary: "Color the promise.",
    kind: "drawing",
    difficulty: "beginner",
    bible_story: "Noah and the rainbow",
    scripture_refs: ["Genesis 9:8-17"],
    ...over,
  });
  const get = (who: string, child: string | null) => rpc<Json>(who, "youth_coloring_artwork", [act, child]);
  const save = (who: string, child: string | null, version: string, base: number, doc: Json) =>
    rpc<Json>(who, "youth_coloring_save", [act, child, version, base, j(doc)]);
  const publish = (id: string) => rpc<Json>(editor, "youth_admin_activity_status", [id, "publish", "publish"]);

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await mk("col.super@example.test", "Synthetic Super");
    editor = await mk("col.editor@example.test", "Synthetic Editor");
    famAdmin = await mk("col.family@example.test", "Synthetic Family Admin");
    ministry = await mk("col.ministry@example.test", "Synthetic Ministry");
    policyA = await mk("col.policya@example.test", "Synthetic Policy A");
    policyB = await mk("col.policyb@example.test", "Synthetic Policy B");
    leader = await mk("col.leader@example.test", "Synthetic Leader");
    parentA = await mk("col.parenta@example.test", "Synthetic Parent A");
    parentB = await mk("col.parentb@example.test", "Synthetic Parent B");
    parentD = await mk("col.parentd@example.test", "Synthetic Parent D");
    stranger = await mk("col.stranger@example.test", "Synthetic Stranger");
    await db.grantRole(superAdmin, "super_admin");
    for (const [who, role] of [
      [editor, "youth_activity_editor"], [famAdmin, "family_admin"], [ministry, "youth_ministry_admin"],
      [policyA, "youth_policy_admin"], [policyB, "youth_policy_admin"], [leader, "youth_leader"],
    ]) await db.grantRole(who, role);
    const p = await rpc<Json>(policyA, "youth_admin_policy_save", [null, j({
      title: "Synthetic policy", body: "Synthetic.",
      settings: { multiple_guardians: true, birth_date_required: true, independent_accounts: true, eligibility_rule: "Synthetic rule.",
                  guardian_authorization_required: true, progress_sharing: "youth_choice" },
    })]);
    await rpc(policyB, "youth_admin_policy_approve", [p.id, `approve version ${p.version}`, "Synthetic minutes"]);
    const verify = async (guardian: string, name: string, permissions: Json, child?: string) => {
      const r = await rpc<Json>(guardian, "youth_guardian_request", [j({ kind: child ? "existing_child" : "new_child", child_name: name, relationship: "parent" })]);
      return rpc<Json>(famAdmin, "youth_admin_request_decide", [r.id, j({ decision: "approve", verification_method: "in_person", permissions, ...(child ? { child_id: child } : {}) })]);
    };
    const a = await verify(parentA, "Synthetic Kid A", ALL);
    kidA = a.child_id as string;
    gParentA_kidA = a.guardianship_id as string;
    kidC = (await verify(parentA, "Synthetic Kid C", ALL)).child_id as string;
    await verify(parentB, "Synthetic Kid A", { receive_updates: true, view_progress: true }, kidA);
    kidD = (await verify(parentD, "Synthetic Kid D", ALL)).child_id as string;
    kidY = (await verify(parentA, "Synthetic Kid Y", ALL)).child_id as string;
    const group = (await rpc<Json>(ministry, "youth_admin_group_save", [null, j({ name: "Synthetic Group" })])).id as string;
    await rpc(ministry, "youth_admin_leader_set", [group, leader, j({ role: "leader", can_publish: true })]);
    for (const kid of [kidA, kidC, kidD, kidY]) await rpc(ministry, "youth_enroll", [group, kid]);
    await rpc(famAdmin, "youth_admin_eligibility_set", [kidY, true]);
    await rpc(parentA, "youth_child_save", [kidY, j({ birth_date: ymd(-365 * 13) })]);
    const inv = await rpc<Json>(parentA, "youth_account_invite", [kidY, "col.youth@example.test"]);
    youthUser = await db.createAuthUser("col.youth@example.test", { fullName: "Synthetic Youth" });
    await rpc(parentA, "youth_account_authorize", [inv.id]);
    await rpc(youthUser, "youth_activate", [inv.code]);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("pictures", () => {
    it("keeps the new table and helpers closed to clients", async () => {
      await expect(db.query(as(parentA), "select * from youth.coloring_artwork")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(editor), "select youth.coloring_template_problem('{}'::jsonb, null)")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_coloring_artwork(gen_random_uuid(), null)")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_coloring_save(gen_random_uuid(), null, gen_random_uuid(), 0, '{}'::jsonb)")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_admin_activity_coloring_set(gen_random_uuid(), null)")).rejects.toThrow(/permission denied/);
    });

    it("lets only activity editors set a picture, and only on Drawing & coloring activities", async () => {
      const quiz = (await rpc<Json>(editor, "youth_admin_activity_save", [null, j(content({ kind: "quiz", title: "Synthetic Quiz" }))])).id as string;
      await fails(editor, "youth_admin_activity_coloring_set", [quiz, j(picture)], /Drawing & coloring/);
      act = (await rpc<Json>(editor, "youth_admin_activity_save", [null, j(content())])).id as string;
      for (const who of [superAdmin, ministry, leader, parentA]) await fails(who, "youth_admin_activity_coloring_set", [act, j(picture)], /permission/);
      await fails(youthUser, "youth_admin_activity_coloring_set", [act, j(picture)], /approved adult/);
      const r = await rpc<Json>(editor, "youth_admin_activity_coloring_set", [act, j(picture)]);
      expect(r.version).toBe(1);
      const log = await db.raw<{ details: Json }>("select details from public.audit_log where target_id = $1 and action = 'youth.activity_coloring_set'", [act]);
      expect(log.map((l) => l.details)).toEqual([{ version: 1, mode: "regions" }]);
    });

    it("refuses markup, unknown fields, malformed shapes, and unsupported values in a picture", async () => {
      const bad = (over: Partial<ColoringTemplate> | Json) => j({ ...picture, ...over });
      const region = picture.regions[0];
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ svg: "<svg onload=alert(1)>" })], /unsupported field/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [{ ...region, d: "M0 0<script>alert(1)</script>" }] })], /unsupported shape data/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [{ ...region, d: "M0 0 A5 5 0 0 1 9 9" }] })], /unsupported shape data/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [{ ...region, label: "<b onmouseover=x>Sky</b>" }] })], /plain-text name/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [{ ...region, onclick: "x" }] })], /unsupported format/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [region, region] })], /unique id/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [] })], /no parts/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ lines: [{ d: "javascript:alert(1)", w: 2 }] })], /line art/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ width: "1000" })], /size/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ width: 5000 })], /size/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ story: "Read <script>x()</script>" })], /story summary/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ attribution: { source_kind: "licensed", credit: "", license: "", source_url: null } })], /artist or source/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ attribution: { source_kind: "original", credit: "", license: "", source_url: "http://x.test" } })], /https/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ mode: "freehand", regions: [], lines: [], line_art_asset_id: randomUUID() })], /line art uploaded for this activity/);
      // Missing keys are refused too (not waved through as NULL).
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ regions: [{ id: region.id, rule: region.rule, w: region.w }] })], /unsupported format/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, bad({ lines: [{ w: 2 }] })], /line art/);
      await fails(editor, "youth_admin_activity_coloring_set", [act, j(Object.fromEntries(Object.entries(picture).filter(([k]) => k !== "attribution")))], /attribution/);
      // The ordinary config path can't smuggle one in either.
      await fails(editor, "youth_admin_activity_save", [act, j(content({ config: { coloring: { ...picture, regions: [{ ...region, d: "<x>" }] } } }))], /coloring picture has a part/);
    });

    it("keeps the picture through ordinary editor saves and refuses changing the type while it's there", async () => {
      await rpc(editor, "youth_admin_activity_save", [act, j(content({ summary: "Edited card text." }))]);
      const a = await rpc<Json>(editor, "youth_admin_activity", [act]);
      expect(((a.draft as Json).config as Json).coloring).toEqual(picture);
      await fails(editor, "youth_admin_activity_save", [act, j(content({ kind: "quiz" }))], /must stay Drawing & coloring/);
      const p = await publish(act);
      v1 = p.published_version_id as string;
      // A published activity: the next ordinary save starts a draft from the published picture.
      await rpc(editor, "youth_admin_activity_save", [act, j(content({ summary: "Draft 2." }))]);
      const b = await rpc<Json>(editor, "youth_admin_activity", [act]);
      expect(((b.draft as Json).config as Json).coloring).toEqual(picture);
      await rpc(editor, "youth_admin_activity_status", [act, "discard_draft"]);
      // A published version (and so its picture) can't change.
      await expect(db.raw("update youth.activity_versions set config = '{}' where id = $1", [v1])).rejects.toThrow(/can't be changed/);
    });

    it("shows members the picture through the activity, without editor notes", async () => {
      const a = await rpc<Json>(parentA, "youth_activity", [act, kidA]);
      expect((a.config as Json).coloring).toMatchObject({ mode: "regions", story: demo.story, attribution: { credit: DEMO_CREDIT } });
    });
  });

  describe("a child's artwork", () => {
    it("starts empty and saves privately to the chosen child", async () => {
      expect(await get(parentA, kidA)).toMatchObject({ child_id: kidA, version_id: v1, revision: 0, doc: {}, earlier: false });
      const one = await save(parentA, kidA, v1, 0, { fills: { [sky]: "sky" }, strokes: [] });
      expect(one).toMatchObject({ status: "saved", revision: 1 });
      const rows = await db.raw<{ child_id: string; last_operator_id: string }>("select child_id, last_operator_id from youth.coloring_artwork");
      expect(rows).toEqual([{ child_id: kidA, last_operator_id: parentA }]);
      // Nothing is published to the gallery or the guardian's own records.
      const gallery = await db.raw<{ n: number }>("select count(*)::int n from media.photos");
      expect(gallery[0].n).toBe(0);
    });

    it("reopens with the saved picture (fills and brush strokes)", async () => {
      const doc = { fills: { [sky]: "sky", [stripe]: "red" }, strokes: [{ t: "paint", c: "green", s: "m", p: "10,10 20,20 30,25", r: sky }, { t: "erase", s: "l", p: "15,15" }] };
      expect(await save(parentA, kidA, v1, 1, doc)).toMatchObject({ status: "saved", revision: 2 });
      const back = await get(parentA, kidA);
      expect(back.revision).toBe(2);
      expect(serializeDoc(back.doc as never)).toBe(serializeDoc(doc as never));
    });

    it("keeps each child's picture separate on a shared device", async () => {
      expect(await get(parentA, kidC)).toMatchObject({ child_id: kidC, revision: 0, doc: {} });
      await save(parentA, kidC, v1, 0, { fills: { [sky]: "yellow" }, strokes: [] });
      expect(((await get(parentA, kidA)).doc as Json).fills).toMatchObject({ [sky]: "sky" });
      expect(((await get(parentA, kidC)).doc as Json).fills).toEqual({ [sky]: "yellow" });
      // A guardian must name the child.
      await fails(parentA, "youth_coloring_artwork", [act, null], /Not found/);
      await fails(parentA, "youth_coloring_save", [act, null, v1, 0, j({ fills: {}, strokes: [] })], /Not found/);
    });

    it("never overwrites a newer save from another device or tab", async () => {
      // Device 1 and device 2 both loaded revision 2; device 2 saves first.
      expect(await save(parentA, kidA, v1, 2, { fills: { [sky]: "blue" }, strokes: [] })).toMatchObject({ status: "saved", revision: 3 });
      const stale = await save(parentA, kidA, v1, 2, { fills: { [sky]: "pink" }, strokes: [] });
      expect(stale.status).toBe("conflict");
      expect(stale.current).toMatchObject({ revision: 3, doc: { fills: { [sky]: "blue" } } });
      // A first save that raced another first save is a conflict too.
      expect((await save(parentA, kidC, v1, 0, { fills: {}, strokes: [] })).status).toBe("conflict");
      expect(((await get(parentA, kidA)).doc as Json).fills).toEqual({ [sky]: "blue" });
      // Choosing to keep this device's picture saves on top of the revision just seen.
      expect(await save(parentA, kidA, v1, 3, { fills: { [sky]: "pink" }, strokes: [] })).toMatchObject({ status: "saved", revision: 4 });
    });

    it("lets a youth color only as themselves", async () => {
      expect(await get(youthUser, null)).toMatchObject({ child_id: kidY, revision: 0 });
      expect((await save(youthUser, null, v1, 0, { fills: { [stripe]: "purple" }, strokes: [] })).status).toBe("saved");
      await fails(youthUser, "youth_coloring_artwork", [act, kidA], /Not found/);
      await fails(youthUser, "youth_coloring_save", [act, kidA, v1, 4, j({ fills: {}, strokes: [] })], /Not found/);
    });

    it("refuses everyone else, whatever their role", async () => {
      // A child with their own account: their guardian no longer colors for them.
      await fails(parentA, "youth_coloring_artwork", [act, kidY], /Not found/);
      await fails(parentD, "youth_coloring_artwork", [act, kidA], /Not found/);
      await fails(parentB, "youth_coloring_artwork", [act, kidA], /Not found/); // progress summaries only
      await fails(parentB, "youth_coloring_save", [act, kidA, v1, 4, j({ fills: {}, strokes: [] })], /Not found/);
      for (const who of [stranger, leader, editor, famAdmin, ministry, superAdmin]) {
        await fails(who, "youth_coloring_artwork", [act, kidA], /Not found/);
        await fails(who, "youth_coloring_save", [act, kidA, v1, 4, j({ fills: {}, strokes: [] })], /Not found/);
        const blobs = JSON.stringify([
          await rpc(who, "youth_admin_activity", [act]).catch(() => null),
          await rpc(who, "youth_activities_home").catch(() => null),
        ]);
        expect(blobs).not.toMatch(/"pink"|"purple"/);
      }
      await fails(parentA, "youth_coloring_artwork", [randomUUID(), kidA], /Not found/);
    });

    it("refuses artwork that doesn't fit the picture or the palette", async () => {
      const no = (doc: unknown, message: RegExp) => fails(parentA, "youth_coloring_save", [act, kidA, v1, 4, j(doc)], message);
      await no({ fills: { r999: "red" }, strokes: [] }, /part the picture doesn't have/);
      await no({ fills: { [sky]: "#ff0000" }, strokes: [] }, /palette/);
      await no({ fills: { [sky]: "<script>" }, strokes: [] }, /palette/);
      await no({ fills: {}, strokes: [{ t: "paint", c: "red", s: "m", p: "javascript:alert(1)" }] }, /unsupported format/);
      await no({ fills: {}, strokes: [{ t: "paint", c: "red", s: "huge", p: "1,1" }] }, /brush size/);
      await no({ fills: {}, strokes: [{ t: "erase", c: "red", s: "m", p: "1,1" }] }, /unsupported format/);
      await no({ fills: {}, strokes: [{ t: "paint", c: "red", s: "m", p: "1,1", r: "r999" }] }, /part the picture doesn't have/);
      await no({ fills: {}, strokes: [], html: "<b>x</b>" }, /isn't a coloring picture/);
      await no({ fills: {}, strokes: [{ t: "paint", s: "m", p: "1,1" }] }, /palette|unsupported format/);
      await no({ fills: {}, strokes: [{ t: "paint", c: "red", s: "m" }] }, /unsupported format/);
      await no({ fills: {}, strokes: [{ c: "red", s: "m", p: "1,1" }] }, /unsupported format/);
      await no({ fills: {}, strokes: Array.from({ length: 2001 }, () => ({ t: "paint", c: "red", s: "s", p: "1,1" })) }, /too many/);
      expect((await get(parentA, kidA)).revision).toBe(4);
    });

    it("keeps artwork on its own version when a new version is published", async () => {
      await rpc(editor, "youth_admin_activity_save", [act, j(content({ title: "Synthetic Rainbow (new)" }))]);
      const v2 = (await publish(act)).published_version_id as string;
      const before = await db.raw("select id, doc, revision from youth.coloring_artwork where version_id = $1 order by id", [v1]);
      // A page still showing version 1 can't write.
      expect(await save(parentA, kidA, v1, 4, { fills: {}, strokes: [] })).toEqual({ status: "version" });
      const now = await get(parentA, kidA);
      expect(now).toMatchObject({ version_id: v2, revision: 0, doc: {}, earlier: true });
      await save(parentA, kidA, v2, 0, { fills: { [sky]: "orange" }, strokes: [] });
      expect(await db.raw("select id, doc, revision from youth.coloring_artwork where version_id = $1 order by id", [v1])).toEqual(before);
      v1 = v2;
    });

    it("closes access at once when a guardian loses the practice permission or the child is restricted", async () => {
      await rpc(famAdmin, "youth_admin_guardian_update", [gParentA_kidA, j({ permissions: { ...ALL, practice: false } })]);
      await fails(parentA, "youth_coloring_artwork", [act, kidA], /Not found/);
      await fails(parentA, "youth_coloring_save", [act, kidA, v1, 1, j({ fills: {}, strokes: [] })], /Not found/);
      expect((await get(parentA, kidC)).child_id).toBe(kidC);
      await rpc(famAdmin, "youth_admin_guardian_update", [gParentA_kidA, j({ permissions: ALL })]);
      expect((await get(parentA, kidA)).revision).toBe(1);
      await rpc(famAdmin, "youth_admin_child_restrict", [kidA, true, "other"]);
      await fails(parentA, "youth_coloring_artwork", [act, kidA], /Not found/);
      await rpc(famAdmin, "youth_admin_child_restrict", [kidA, false, null]);
      await rpc(editor, "youth_admin_activity_status", [act, "archive", "archive"]);
      await fails(parentA, "youth_coloring_artwork", [act, kidA], /Not found/);
      await rpc(editor, "youth_admin_activity_status", [act, "restore"]);
      expect((await get(parentA, kidA)).revision).toBe(1);
    });
  });

  describe("freehand-only line art", () => {
    it("uses uploaded artwork, keeps it while a version uses it, and lets only players read it", async () => {
      const free = (await rpc<Json>(editor, "youth_admin_activity_save", [null, j(content({ title: "Synthetic Freehand" }))])).id as string;
      const other = (await rpc<Json>(editor, "youth_admin_activity_save", [null, j(content({ title: "Synthetic Other" }))])).id as string;
      const upload = async (activity: string) => {
        const b = await rpc<Json>(editor, "youth_admin_activity_asset_begin", [activity, j({ source_kind: "permission", source_credit: "Synthetic Artist", license: "Written permission", rights_confirmed: true })]);
        await db.query(as(editor), "insert into storage.objects (bucket_id, name) values ('youth', $1)", [b.path]);
        await rpc(editor, "youth_admin_activity_asset_finish", [b.id, j({ width: 1600, height: 1200, bytes: 90000 })]);
        return b as { id: string; path: string };
      };
      const art = await upload(free);
      const elsewhere = await upload(other);
      const t = { format: 1, mode: "freehand", width: 1000, height: 750, regions: [], lines: [], line_art_asset_id: art.id, story: "Synthetic.", attribution: { source_kind: "permission", credit: "Synthetic Artist", license: "Written permission", source_url: null } };
      await fails(editor, "youth_admin_activity_coloring_set", [free, j({ ...t, line_art_asset_id: elsewhere.id })], /line art uploaded for this activity/);
      await fails(editor, "youth_admin_activity_coloring_set", [free, j({ ...t, regions: picture.regions })], /freehand-only/);
      await rpc(editor, "youth_admin_activity_coloring_set", [free, j(t)]);
      await fails(editor, "youth_admin_activity_asset_remove", [art.id], /Remove the coloring picture first/);
      const canRead = async (who: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_read_object($1) ok", [art.path]))[0].ok;
      expect(await canRead(parentA)).toBe(false); // not published yet
      await publish(free);
      expect(await canRead(parentA)).toBe(true);
      expect(await canRead(youthUser)).toBe(true);
      expect(await canRead(editor)).toBe(true);
      for (const who of [stranger, parentB, leader, superAdmin]) expect(await canRead(who)).toBe(false);
      await fails(editor, "youth_admin_activity_asset_remove", [art.id], /published version/);
      expect(((await rpc<Json>(editor, "youth_admin_activity", [free])).assets as Json[]).find((x) => x.id === art.id)).toMatchObject({ locked: true });
      // Freehand artwork has strokes only: there are no parts to fill.
      expect((await save(parentA, kidA, v1, 1, { fills: {}, strokes: [] })).status).toBe("saved");
      const freeV = ((await rpc<Json>(editor, "youth_admin_activity", [free])).published as Json).version_id as string;
      const s = (doc: Json) => rpc<Json>(parentA, "youth_coloring_save", [free, kidA, freeV, 0, j(doc)]);
      await expect(s({ fills: { r1: "red" }, strokes: [] })).rejects.toThrow(/part the picture doesn't have/);
      expect((await s({ fills: {}, strokes: [{ t: "paint", c: "blue", s: "l", p: "100,100 200,200" }] })).status).toBe("saved");
    });
  });
});
