import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parsePlanCsv, planTemplate } from "@/lib/bible/plan-import";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 8 Bible reading against a real database: scoped capabilities
 * (source manager vs plan editor vs publisher vs content editor), the
 * staged scripture import and its review boundary, translation activation,
 * reading only active translations, plan publishing and validation, CSV
 * import (preview, add/replace, conflicts, transactional failure), calendar
 * and personal schedules (midyear joins, rest days, leap day, DST), progress
 * and idempotent completion, versioned changes that keep completions and
 * journal links, journals that only their owner can reach (not household
 * members, group leaders, plan staff, or super administrators), autosave
 * concurrency, export and deletion, bookmarks and highlights, and reminders
 * (one per day, rest days skipped, generic wording, access rechecked).
 *
 * Scripture comes from tests/fixtures/bible/web-sample.csv and
 * asv-sample.csv: excerpts of the public-domain World English Bible and
 * American Standard Version prepared by scripts/bible-prepare-web.mjs and
 * scripts/bible-prepare-asv.mjs. Every person and plan is synthetic.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const ASV_FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/asv-sample.csv"), "utf8");
const ASV_JOHN_3_16 = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth on him should not perish, but have eternal life.";
const JOHN_3_16 = "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.";
const SECRET_PHRASE = "zebra-lantern private reflection";

describeDb("Bible reading plans, scripture, and journals", () => {
  let db: TestDb;
  let admin: string; // super administrator
  let sourceMgr: string; // bible_source_manager
  let editor: string; // reading_plan_editor
  let publisher: string; // reading_plan_publisher
  let contentEditor: string; // content_editor (Phase 1/7 role)
  let leader: string; // group leader
  let m1: string;
  let m2: string; // shares a household with m1
  let m3: string;
  let pending: string;
  let suspended: string;
  let group: string;
  let churchThread: string;
  let groupThread: string;
  let web: string; // translation id
  let tz: string; // a time zone where it's mid-day now (keeps reminder tests away from midnight)

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
  const today = async (zone = tz) => (await db.raw<{ d: string }>("select bible.local_today($1)::text as d", [zone]))[0].d;
  const shift = async (days: number, zone = tz) => (await db.raw<{ d: string }>("select (bible.local_today($1) + $2::integer)::text as d", [zone, days]))[0].d;
  const notifs = async (id: string) => (await rpc<Json>(as(id), "community_notifications", [null, 50])).items as Json[];

  /** Stages the fixture (or other text) as an import and finishes it. */
  const stageImport = async (translation: string, text: string, format: "csv" | "vpl" = "csv") => {
    const begun = await rpc<Json>(as(sourceMgr), "bible_admin_import_begin", [translation, format, `sample.${format === "vpl" ? "txt" : format}`, Buffer.byteLength(text), randomUUID()]);
    const id = begun.id as string;
    await rpc(as(sourceMgr), "bible_admin_import_processing", [id]);
    const rows = parseSourceFile(text, format);
    for (let i = 0; i < rows.length; i += 1000) await rpc(as(sourceMgr), "bible_admin_import_stage", [id, j(rows.slice(i, i + 1000))]);
    const done = await rpc<Json>(as(sourceMgr), "bible_admin_import_finish", [id, null]);
    return { id, summary: done.summary as Record<string, number> };
  };

  const newPlan = async (mode: "calendar" | "personal", title: string, opts: { audience?: string; group?: string; actor?: string } = {}) =>
    (await rpc<Json>(as(opts.actor ?? editor), "bible_admin_plan_save", [
      null,
      j({ title, mode, translation_id: web, timezone: tz, audience: opts.audience ?? "members", group_id: opts.group ?? null }),
      null,
    ])).id as string;
  const day = async (plan: string, key: { date?: string; number?: number }, passages: Json[], extra: Json = {}) =>
    (await rpc<Json>(as(editor), "bible_admin_day_save", [plan, null, j({ day_date: key.date ?? null, day_number: key.number ?? null, passages, ...extra })])).id as string;
  const publish = (plan: string) => rpc(as(publisher), "bible_admin_plan_status", [plan, "publish", "publish"]);
  const P = (book: string, sc: number, sv: number | null = null, ec = sc, ev: number | null = sv) => ({ book, sc, sv, ec, ev });

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, state: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (state !== "pending") await db.setStatus(id, "approved");
      if (state === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("b.admin@example.test", "Synthetic Admin");
    sourceMgr = await mk("b.source@example.test", "Synthetic Source Manager");
    editor = await mk("b.editor@example.test", "Synthetic Plan Editor");
    publisher = await mk("b.publisher@example.test", "Synthetic Plan Publisher");
    contentEditor = await mk("b.content@example.test", "Synthetic Content Editor");
    leader = await mk("b.leader@example.test", "Synthetic Leader");
    m1 = await mk("b.m1@example.test", "Alpha Reader");
    m2 = await mk("b.m2@example.test", "Bravo Reader");
    m3 = await mk("b.m3@example.test", "Charlie Reader");
    pending = await mk("b.pending@example.test", "Pending Reader", "pending");
    suspended = await mk("b.suspended@example.test", "Suspended Reader", "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(sourceMgr, "bible_source_manager");
    await db.grantRole(editor, "reading_plan_editor");
    await db.grantRole(publisher, "reading_plan_publisher");
    await db.grantRole(contentEditor, "content_editor");
    group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Reading Group", summary: "s", about: "a", visibility: "discoverable", leader_id: leader })]);
    for (const id of [m1, publisher, editor]) await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    // m1 and m2 share a household (households grant no journal access).
    const h = await rpc<string>(as(m1), "household_create", ["Synthetic Household"]);
    await db.raw("insert into public.household_members (household_id, profile_id) values ($1, $2)", [h, m2]);
    const cat = (await db.raw<{ id: string }>("select id from community.categories order by sort_order limit 1"))[0].id;
    churchThread = (await db.raw<{ id: string }>("insert into community.threads (category_id, author_id, title, body) values ($1, $2, 'Synthetic reading discussion', 'Body') returning id", [cat, m1]))[0].id;
    groupThread = (await db.raw<{ id: string }>("insert into community.threads (group_id, author_id, title, body) values ($1, $2, 'Synthetic group discussion', 'Body') returning id", [group, m1]))[0].id;
    // A zone where the local time is between 04:00 and 19:00.
    const zones = ["UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Honolulu", "Europe/Berlin", "Asia/Kolkata", "Australia/Sydney"];
    for (const z of zones) {
      const [{ h: hour }] = await db.raw<{ h: number }>("select extract(hour from now() at time zone $1)::int as h", [z]);
      if (hour >= 4 && hour < 19) {
        tz = z;
        break;
      }
    }
    expect(tz).toBeTruthy();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  describe("access and capabilities", () => {
    it("keeps the bible and journal schemas closed to every API role", async () => {
      for (const actor of [anon, as(m1), as(admin)]) {
        await expect(db.query(actor, "select * from bible.translations")).rejects.toThrow(/permission denied/);
        await expect(db.query(actor, "select * from journal.entries")).rejects.toThrow(/permission denied/);
      }
      await expect(db.query(anon, "select public.bible_translations()")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.journal_entries(null, 'active', 10, 0)")).rejects.toThrow(/permission denied/);
    });

    it("refuses pending and suspended accounts", async () => {
      for (const id of [pending, suspended]) {
        await fails(as(id), "bible_translations", [], /Only approved members/);
        await fails(as(id), "journal_entries", [null, "active", 10, 0], /Only approved members/);
        await fails(as(id), "bible_hub", [], /Only approved members/);
      }
    });

    it("scopes source and plan management to their roles", async () => {
      await fails(as(m1), "bible_admin_sources", [], /permission/);
      await fails(as(editor), "bible_admin_sources", [], /permission/);
      await fails(as(publisher), "bible_admin_translation_save", [null, j({ code: "XX", name: "X" })], /permission/);
      await fails(as(contentEditor), "bible_admin_plans", [], /permission/);
      await fails(as(contentEditor), "bible_admin_plan_save", [null, j({ title: "x", mode: "personal" }), null], /permission/);
      await fails(as(sourceMgr), "bible_admin_plans", [], /permission/);
      await fails(as(m1), "bible_admin_plans", [], /permission/);
      await expect(rpc(as(admin), "bible_admin_sources")).resolves.toBeTruthy();
      await expect(rpc(as(editor), "bible_admin_plans")).resolves.toEqual([]);
    });
  });

  describe("translations and the scripture import review", () => {
    it("stages the public-domain sample and flags omitted verses for review", async () => {
      const t = await rpc<Json>(as(sourceMgr), "bible_admin_translation_save", [null, j({
        code: "WEB", name: "World English Bible", source_kind: "database",
        attribution: "World English Bible (WEB), public domain. Source: eBible.org.", copyright: "Public domain",
        source_url: "https://ebible.org/web/",
      })]);
      web = t.id as string;
      expect(t.status).toBe("draft");
      // Not usable until the rights are confirmed and text is published.
      await fails(as(sourceMgr), "bible_admin_translation_status", [web, "activate", "WEB"], /Confirm the rights/);
      await rpc(as(sourceMgr), "bible_admin_translation_save", [web, j({ rights: "public_domain", confirm_rights: true, allow_copy: true, allow_print: true, allow_export: true })]);
      await fails(as(sourceMgr), "bible_admin_translation_status", [web, "activate", "WEB"], /Publish a reviewed import/);

      const { id, summary } = await stageImport(web, FIXTURE);
      expect(summary.verses).toBe(186);
      expect(summary.empty).toBe(2); // Acts 8:37 and Romans 16:25 have no text in the WEB
      expect(summary.duplicate).toBe(0);
      expect(summary.malformed).toBe(0);
      expect(summary.missing).toBe(2); // until the two empty verses are accepted
      // Staged text is not published scripture: nothing to read yet.
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from bible.verses where translation_id = $1", [web]);
      expect(n).toBe(0);
      await fails(as(sourceMgr), "bible_admin_import_publish", [id, "WEB", true, null], /Review every flagged line/);
      const review = await rpc<Json>(as(sourceMgr), "bible_admin_import", [id, "empty", 100, 0]);
      const lines = (review.issues as Json[]).map((x) => x.line as number);
      expect((review.issues as Json[]).map((x) => `${x.book} ${x.chapter}:${x.verse}`).sort()).toEqual(["ACT 8:37", "ROM 16:25"]);
      expect((review.issues as Json[])[0].source_ref).toMatch(/^line \d+$/);
      await rpc(as(sourceMgr), "bible_admin_import_accept", [id, lines, true]);
      await fails(as(sourceMgr), "bible_admin_import_publish", [id, "web", true, null], /Type the translation code/);
      await fails(as(editor), "bible_admin_import_publish", [id, "WEB", true, null], /permission/);
      const pub = await rpc<Json>(as(sourceMgr), "bible_admin_import_publish", [id, "WEB", false, "Reviewed against the source"]);
      expect(pub.verses).toBe(188);
      await rpc(as(sourceMgr), "bible_admin_translation_status", [web, "activate", "WEB"]);
      await rpc(as(sourceMgr), "bible_admin_translation_status", [web, "make_default", null]);
    });

    it("serves exact text with its translation label and marks omitted verses honestly", async () => {
      const ch = await rpc<Json>(as(m1), "bible_chapter", [web, "JHN", 3]);
      const verses = ch.verses as Json[];
      expect((verses.find((v) => v.v === 16) as Json).t).toBe(JOHN_3_16);
      expect((ch.translation as Json).code).toBe("WEB");
      expect((ch.translation as Json).attribution).toMatch(/public domain/);
      const acts = await rpc<Json>(as(m1), "bible_chapter", [web, "ACT", 8]);
      expect((acts.verses as Json[]).find((v) => v.v === 37)).toMatchObject({ t: "", o: true });
      const ps = await rpc<Json>(as(m1), "bible_passage", [web, "PSA", 23, null, 23, null]);
      expect(ps.label).toBe("Psalm 23");
      expect((ps.verses as Json[])[0]).toMatchObject({ v: 1, h: "A Psalm by David.", q: true });
      expect(String((ps.verses as Json[])[0].t)).toBe("Yahweh is my shepherd:\nI shall lack nothing.");
      // Only chapters that exist in this translation's text.
      await fails(as(m1), "bible_chapter", [web, "EXO", 1], /isn't in this translation/);
      await fails(as(m1), "bible_passage", [web, "JHN", 3, 16, 3, 40], /verse doesn't exist/);
      const books = await rpc<Json[]>(as(m1), "bible_books", [web]);
      expect(books.map((b) => b.code)).toEqual(["GEN", "PSA", "JHN", "ACT", "ROM", "JUD"]);
    });

    it("never shows a draft translation or mixes text between translations", async () => {
      const other = (await rpc<Json>(as(sourceMgr), "bible_admin_translation_save", [null, j({ code: "TESTX", name: "Unreviewed test translation" })])).id;
      await fails(as(m1), "bible_chapter", [other, "JHN", 3], /isn't available/);
      const list = (await rpc<Json>(as(m1), "bible_translations")).items as Json[];
      expect(list.map((t) => t.code)).toEqual(["WEB"]);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from bible.verses where translation_id = $1", [other]);
      expect(n).toBe(0);
    });

    it("flags malformed lines, unknown books, and duplicates, and blocks publishing on duplicates", async () => {
      const t = (await rpc<Json>(as(sourceMgr), "bible_admin_translation_save", [null, j({ code: "DUPTEST", name: "Duplicate test" })])).id as string;
      const vpl = ["JHN 3:16 First line.", "JHN 3:16 Repeated line.", "XYZ 1:1 Unknown book.", "not a verse line", "# a comment", ""].join("\n");
      const { id, summary } = await stageImport(t, vpl, "vpl");
      expect(summary).toMatchObject({ duplicate: 1, unknown_book: 1, malformed: 1, verses: 1 });
      await fails(as(sourceMgr), "bible_admin_import_publish", [id, "DUPTEST", true, null], /more than once/);
      await rpc(as(sourceMgr), "bible_admin_import_discard", [id]);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from bible.staged_verses where import_id = $1", [id]);
      expect(n).toBe(0);
    });

    it("requires a fresh rights confirmation when permissions of an active translation change", async () => {
      await fails(as(sourceMgr), "bible_admin_translation_save", [web, j({ allow_export: false })], /Confirm the rights again/);
      await rpc(as(sourceMgr), "bible_admin_translation_save", [web, j({ allow_export: true, confirm_rights: true })]);
      const [{ details }] = await db.raw<{ details: Json }>("select details from public.audit_log where action = 'bible.translation_updated' order by id desc limit 1");
      expect(details).toEqual({ fields: [], rights_confirmed: true });
    });
  });

  describe("plans: drafting, validation, publishing", () => {
    let personal: string;
    let restDay: string;
    it("validates passages against the translation and keeps drafts unpublished", async () => {
      personal = await newPlan("personal", "Synthetic Gospel Plan");
      await fails(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 1, passages: [P("JHN", 22)] })], /chapter doesn't exist/);
      await fails(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 1, passages: [P("JHN", 3, 1, 3, 40)] })], /verse doesn't exist/);
      await fails(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 1, passages: [] })], /needs at least one passage/);
      await day(personal, { number: 1 }, [P("GEN", 1, null, 2, null), P("PSA", 23)]);
      await day(personal, { number: 2 }, [P("JHN", 3, 16, 3, 21), P("JHN", 3, 1, 3, 8)]);
      restDay = (await rpc<Json>(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 3, kind: "rest" })])).id as string;
      await day(personal, { number: 4 }, [P("JUD", 1, 1, 1, 25)], { questions: ["What encourages you here?"] });
      await fails(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 2, passages: [P("PSA", 23)] })], /already uses that number/);
      const plan = await rpc<Json>(as(editor), "bible_admin_plan", [personal]);
      const d2 = (plan.day_list as Json[]).find((d) => d.day_number === 2) as Json;
      // Two passages from the same book stay separate, in order.
      expect((d2.passages as Json[]).map((p) => p.label)).toEqual(["John 3:16–21", "John 3:1–8"]);
      expect((plan.day_list as Json[]).find((d) => d.day_number === 1)!.passages).toMatchObject([{ label: "Genesis 1–2" }, { label: "Psalm 23" }]);
      // Members can't see drafts.
      await fails(as(m1), "bible_plan", [personal], /not found/);
      await fails(as(editor), "bible_admin_plan_status", [personal, "publish", "publish"], /permission/);
      await fails(as(publisher), "bible_admin_plan_status", [personal, "publish", null], /Confirm publishing/);
      await publish(personal);
      expect((await rpc<Json>(as(m1), "bible_plan", [personal])).title).toBe("Synthetic Gospel Plan");
      expect(restDay).toBeTruthy();
    });

    it("validates references in bulk for editors only", async () => {
      const res = await rpc<Json[]>(as(editor), "bible_admin_validate_refs", [web, j([P("JHN", 3, 16, 3, 21), P("JHN", 3, 99, 3, 99), P("EXO", 1)])]);
      expect(res.map((r) => r.ok)).toEqual([true, false, false]);
      expect(res[0].label).toBe("John 3:16–21");
      await fails(as(m1), "bible_admin_validate_refs", [web, j([])], /permission/);
    });

    it("links only discussions no broader than the plan", async () => {
      const plan = await newPlan("personal", "Synthetic Discussion Plan");
      await fails(as(editor), "bible_admin_day_save", [plan, null, j({ day_number: 1, passages: [P("PSA", 23)], discussion_thread_id: groupThread })], /Choose a discussion/);
      await day(plan, { number: 1 }, [P("PSA", 23)], { discussion_thread_id: churchThread });
      const groupPlan = await newPlan("personal", "Synthetic Group Plan", { audience: "group", group: group });
      await fails(as(editor), "bible_admin_day_save", [groupPlan, null, j({ day_number: 1, passages: [P("PSA", 23)], discussion_thread_id: churchThread })], /Choose a discussion/);
      await day(groupPlan, { number: 1 }, [P("PSA", 23)], { discussion_thread_id: groupThread });
      await publish(groupPlan);
      // Group plans are visible to the group only.
      await expect(rpc(as(m1), "bible_plan", [groupPlan])).resolves.toBeTruthy();
      await fails(as(m3), "bible_plan", [groupPlan], /not found/);
    });
  });

  describe("CSV import", () => {
    it("previews, adds, refuses conflicts, replaces, and applies transactionally", async () => {
      const plan = await newPlan("personal", "Synthetic Imported Plan");
      const parsed = parsePlanCsv(planTemplate("personal"), "personal");
      expect(parsed.errors).toEqual([]);
      // The template uses books outside the sample; keep rows the sample has.
      const rows = parsed.rows.filter((r) => r.passages.every((p) => ["GEN", "PSA", "JHN", "ACT", "ROM", "JUD"].includes(p.book)) && r.passages.every((p) => p.book !== "GEN" || p.ec <= 2) && r.passages.every((p) => p.book !== "PSA" || p.sc === 23));
      const filtered = rows.length ? rows : parsed.rows.filter((r) => r.kind !== "reading");
      const stage = (data: unknown[]) => rpc<string>(as(editor), "bible_admin_plan_import_stage", [plan, "plan.csv", j(data), "[]", "[]"]);
      const keep = [
        { row: 2, day_number: 1, day_date: null, kind: "reading", heading: "Start", notes: "", questions: ["Q1?"], passages: [P("GEN", 1, null, 2, null), P("PSA", 23)] },
        { row: 3, day_number: 2, day_date: null, kind: "rest", heading: null, notes: "", questions: [], passages: [] },
        ...filtered.filter((r) => r.kind === "catch_up").map((r) => ({ ...r, day_number: 3 })),
      ];
      const first = await stage(keep);
      await fails(as(editor), "bible_admin_plan_import_apply", [first, "add", "replace"], /confirm/);
      expect((await rpc<Json>(as(editor), "bible_admin_plan_import_apply", [first, "add", "add"])).applied).toBe(keep.length);
      await fails(as(editor), "bible_admin_plan_import_apply", [first, "add", "add"], /already applied/);
      const second = await stage([{ row: 2, day_number: 1, kind: "reading", passages: [P("JHN", 3)] }]);
      await fails(as(editor), "bible_admin_plan_import_apply", [second, "add", "add"], /already in the draft: day 1/);
      // One bad row (bypassing the file checks) rolls back the whole import.
      const bad = await stage([
        { row: 2, day_number: 1, kind: "reading", passages: [P("JHN", 3)] },
        { row: 3, day_number: 2, kind: "reading", passages: [P("JHN", 50)] },
      ]);
      await fails(as(editor), "bible_admin_plan_import_apply", [bad, "replace", "replace"], /Row 3: Passage 1: That chapter doesn't exist/);
      const after = await rpc<Json>(as(editor), "bible_admin_plan", [plan]);
      expect(after.days).toBe(keep.length);
      const good = await stage([{ row: 2, day_number: 1, kind: "reading", passages: [P("JHN", 3)] }]);
      expect((await rpc<Json>(as(editor), "bible_admin_plan_import_apply", [good, "replace", "replace"])).applied).toBe(1);
      expect((await rpc<Json>(as(editor), "bible_admin_plan", [plan])).days).toBe(1);
      // Never into a published plan.
      await publish(plan);
      await fails(as(editor), "bible_admin_plan_import_stage", [plan, "plan.csv", j(keep), "[]", "[]"], /draft plan/);
      await fails(as(m1), "bible_admin_plan_import_stage", [plan, "plan.csv", "[]", "[]", "[]"], /permission/);
    });
  });

  describe("schedules, progress, and completion", () => {
    let personal: string;
    let enrollment: string;
    let days: Json[];
    it("maps personal days to the member's start date and time zone", async () => {
      personal = await newPlan("personal", "Synthetic Personal Plan");
      await day(personal, { number: 1 }, [P("GEN", 1)]);
      await day(personal, { number: 2 }, [P("GEN", 2)]);
      await rpc(as(editor), "bible_admin_day_save", [personal, null, j({ day_number: 3, kind: "rest" })]);
      await day(personal, { number: 4 }, [P("PSA", 23)]);
      await day(personal, { number: 5 }, [P("JHN", 3, 16, 3, 21)]);
      await publish(personal);
      const start = await shift(-3);
      const e = await rpc<Json>(as(m1), "bible_plan_join", [personal, start, tz, true]);
      enrollment = e.id as string;
      expect(e.is_primary).toBe(true);
      const t = await rpc<Json>(as(m1), "bible_today");
      expect(((t.day as Json).passages as string[])).toEqual(["Psalm 23"]); // day 4
      const plan = await rpc<Json>(as(m1), "bible_plan", [personal]);
      days = plan.day_list as Json[];
      expect(days.map((d) => d.scheduled)).toEqual([start, await shift(-2), await shift(-1), await today(), await shift(1)]);
    });

    it("counts progress without counting rest days, and marks completion idempotently", async () => {
      const d1 = days[0].id as string;
      const rest = days[2].id as string;
      let r = await rpc<Json>(as(m1), "bible_day_complete", [d1, true]);
      r = await rpc<Json>(as(m1), "bible_day_complete", [d1, true]);
      expect(r.progress).toMatchObject({ total: 4, completed: 1, remaining: 3, due: 3, behind: 1 });
      await rpc(as(m1), "bible_day_complete", [d1, false]);
      r = await rpc<Json>(as(m1), "bible_day_complete", [d1, false]);
      expect(r).toMatchObject({ completed: false, progress: { completed: 0, behind: 2 } });
      await fails(as(m1), "bible_day_complete", [rest, true], /Rest days don't need to be marked/);
      // Opening a reading never marks it.
      await rpc(as(m1), "bible_day", [days[3].id]);
      expect(((await rpc<Json>(as(m1), "bible_today")).day as Json).completed).toBe(false);
      await rpc(as(m1), "bible_day_complete", [d1, true]);
      const cu = await rpc<Json>(as(m1), "bible_catch_up", [enrollment]);
      expect((cu.days as Json[]).map((d) => d.passages)).toEqual([["Genesis 2"]]);
      // Someone else can't mark it or see the enrollment.
      await fails(as(m3), "bible_day_complete", [d1, true], /Join this plan/);
      await fails(as(m3), "bible_catch_up", [enrollment], /not found/);
    });

    it("counts a midyear join of a dated plan from today when the member chooses", async () => {
      const cal = await newPlan("calendar", "Synthetic Church Year");
      for (let i = -3; i <= 3; i++) await day(cal, { date: await shift(i) }, [P("JHN", 3, i + 4, 3, i + 4)]);
      await publish(cal);
      const late = await rpc<Json>(as(m2), "bible_plan_join", [cal, null, null, false]);
      expect(late.expect_from).toBe(await today());
      const p = await rpc<Json>(as(m2), "bible_plan", [cal]);
      expect(p.progress).toMatchObject({ total: 4, due: 1, behind: 0 });
      const full = await rpc<Json>(as(m3), "bible_plan_join", [cal, null, null, true]);
      expect(full.expect_from).toBeNull();
      expect((await rpc<Json>(as(m3), "bible_plan", [cal])).progress).toMatchObject({ total: 7, due: 4, behind: 3 });
      // Calendar "today" is the plan's date, whatever the member's zone.
      expect(((await rpc<Json>(as(m3), "bible_plan", [cal])).today_day as Json).passages).toEqual(["John 3:4"]);
    });

    it("accepts February 29 only in leap years and keeps dates through daylight saving", async () => {
      const cal = await newPlan("calendar", "Synthetic Leap Plan");
      await day(cal, { date: "2028-02-29" }, [P("PSA", 23)]);
      await fails(as(editor), "bible_admin_day_save", [cal, null, j({ day_date: "2027-02-29", passages: [P("PSA", 23)] })]);
      // Personal day 2 from 2027-03-13 in New York is 2027-03-14 (the day clocks change).
      const [{ d }] = await db.raw<{ d: string }>(
        "select bible.day_date_for(row(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'active', false, '2027-03-13'::date, null, 'America/New_York', false, '07:00'::time, false, null, now(), null, now())::bible.enrollments, row(gen_random_uuid(), gen_random_uuid(), 2, null, 'reading', null, '', '{}', null, 1, null, null, now(), now())::bible.plan_days)::text as d",
      );
      expect(d).toBe("2027-03-14");
    });

    it("previews a plan and its readings without joining", async () => {
      const m3Rows = () => db.raw<{ n: string }>("select count(*)::text as n from bible.enrollments where plan_id = $1 and profile_id = $2", [personal, m3]);
      const plan = await rpc<Json>(as(m3), "bible_plan", [personal]);
      expect(plan.enrollment).toBeNull();
      expect((plan.day_list as Json[]).length).toBe(5);
      const d = await rpc<Json>(as(m3), "bible_day", [days[0].id]);
      expect(d).toMatchObject({ enrollment: null, completed: false });
      expect((d.passages as Json[]).length).toBe(1);
      expect((await m3Rows())[0].n).toBe("0");
    });

    it("leaves a plan without losing history, rejoins, and deletes only on confirmation", async () => {
      await rpc(as(m1), "bible_enrollment_update", [enrollment, j({ reminders: true })]);
      const left = await rpc<Json>(as(m1), "bible_plan_leave", [enrollment]);
      expect(left).toMatchObject({ status: "left", reminders: false, is_primary: false });
      // A left enrollment is still reported (so the page offers "Rejoin"), on the plan and on each day.
      expect(((await rpc<Json>(as(m1), "bible_plan", [personal])).enrollment as Json).status).toBe("left");
      expect(((await rpc<Json>(as(m1), "bible_day", [days[0].id])).enrollment as Json).status).toBe("left");
      await fails(as(m1), "bible_day_complete", [days[1].id, true], /Join this plan/);
      const hub = await rpc<Json>(as(m1), "bible_hub");
      expect((hub.history as Json[]).map((h) => (h.plan as Json).id)).toContain(personal);
      const back = await rpc<Json>(as(m1), "bible_plan_join", [personal, await shift(-3), tz, true]);
      // Same enrollment, history kept, and reminders stay off until turned on again.
      expect(back).toMatchObject({ id: enrollment, status: "active", reminders: false });
      expect(((await rpc<Json>(as(m1), "bible_plan", [personal])).progress as Json).completed).toBe(1);
      await fails(as(m1), "bible_enrollment_delete", [enrollment, "yes"], /Confirm/);
      await fails(as(m3), "bible_enrollment_delete", [enrollment, "delete"], /not found/);
    });
  });

  describe("changes to published plans", () => {
    let cal: string;
    let past: string;
    let future: string;
    let entry: string;
    it("revises a future day with a reason, keeping earlier completions and journal links on their revision", async () => {
      cal = await newPlan("calendar", "Synthetic Revised Plan");
      past = await day(cal, { date: await shift(-2) }, [P("GEN", 1)]);
      future = await day(cal, { date: await shift(2) }, [P("GEN", 2)], { questions: ["What do you notice?"] });
      await publish(cal);
      await rpc(as(m1), "bible_plan_join", [cal, null, null, true]);
      await rpc(as(m2), "bible_plan_join", [cal, null, null, true]);
      await rpc(as(m1), "bible_day_complete", [future, true]); // read ahead
      entry = (await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "On the reading", `${SECRET_PHRASE} one`, j({ kind: "assignment", day_id: future, question: "What do you notice?" })])).id as string;
      const impact = await rpc<Json>(as(publisher), "bible_admin_day_impact", [future]);
      expect(impact).toMatchObject({ is_past: false, completions: 1, upcoming_readers: 1, active_enrollments: 2 });
      expect(JSON.stringify(impact)).not.toContain("journal");
      await fails(as(publisher), "bible_admin_day_revise", [future, j({ passages: [P("PSA", 23)] }), "", "revise"], /reason/);
      await fails(as(editor), "bible_admin_day_revise", [future, j({ passages: [P("PSA", 23)] }), "Better fit", "revise"], /permission/);
      const r = await rpc<Json>(as(publisher), "bible_admin_day_revise", [future, j({ passages: [P("PSA", 23)] }), "Swapped for a psalm", "revise"]);
      expect(r).toMatchObject({ revision: 2, material: true, notified: 1 });
      const seen = await rpc<Json>(as(m1), "bible_day", [future]);
      expect(seen).toMatchObject({ completed: true, completed_revision: 1, revision: 2 });
      expect(((seen.completed_snapshot as Json).passages as Json[]).map((p) => p.label)).toEqual(["Genesis 2"]);
      const link = (await rpc<Json>(as(m1), "journal_entry", [entry])).link as Json;
      expect(link).toMatchObject({ kind: "assignment", revision: 1, changed_since: true, available: true, question: "What do you notice?" });
      expect((link.passages as Json[]).map((p) => p.label)).toEqual(["Genesis 2"]);
      // Only m2 (day ahead, unread) is told.
      expect((await notifs(m2)).map((n) => n.kind)).toContain("reading_plan_changed");
      expect((await notifs(m1)).map((n) => n.kind)).not.toContain("reading_plan_changed");
    });

    it("keeps multi-paragraph questions whole and journal answers on their question when questions are reordered", async () => {
      const long = "Read verses 1–3 again.\n\nWhat does the passage say about rest, and where do you need it this week?";
      const plan = await newPlan("calendar", "Synthetic Question Order Plan");
      const d = await day(plan, { date: await shift(3) }, [P("PSA", 23)], { questions: ["What do you notice?", long, "  ", "Who could you share this with?"] });
      await publish(plan);
      await rpc(as(m1), "bible_plan_join", [plan, null, null, true]);
      expect((await rpc<Json>(as(m1), "bible_day", [d])).questions).toEqual(["What do you notice?", long, "Who could you share this with?"]);
      const answer = (await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "Rest", "synthetic answer", j({ kind: "assignment", day_id: d, question: long })])).id as string;
      await rpc(as(publisher), "bible_admin_day_revise", [d, j({ questions: [long, "Who could you share this with?", "What do you notice?"] }), "Lead with the rest question", "revise"]);
      expect((await rpc<Json>(as(m1), "bible_day", [d])).questions).toEqual([long, "Who could you share this with?", "What do you notice?"]);
      expect(((await rpc<Json>(as(m1), "journal_entry", [answer])).link as Json).question).toBe(long);
    });

    it("needs an explicit correction to change a past day, and never deletes published days", async () => {
      await rpc(as(m1), "bible_day_complete", [past, true]);
      await fails(as(publisher), "bible_admin_day_revise", [past, j({ passages: [P("GEN", 2)] }), "Typo in the reference", "revise"], /already passed/);
      await rpc(as(publisher), "bible_admin_day_revise", [past, j({ passages: [P("GEN", 2)] }), "Typo in the reference", "correct-past"]);
      await fails(as(editor), "bible_admin_day_delete", [past], /Only days of a draft plan/);
      await fails(as(editor), "bible_admin_plan_delete", [cal], /Only an unused draft/);
      await rpc(as(publisher), "bible_admin_day_retire", [past, "No longer part of the plan", "correct-past"]);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from bible.completions where day_id = $1", [past]);
      expect(n).toBe(1);
      const list = ((await rpc<Json>(as(m1), "bible_plan", [cal])).day_list as Json[]).map((d) => d.id);
      expect(list).not.toContain(past);
      const changes = (await rpc<Json>(as(publisher), "bible_admin_plan", [cal])).changes as Json[];
      expect(changes.map((c) => c.action)).toEqual(expect.arrayContaining(["day_revised", "day_corrected", "day_retired", "publish"]));
    });

    it("keeps progress when title or description change, and refuses structural changes", async () => {
      const before = (await rpc<Json>(as(m1), "bible_plan", [cal])).progress;
      await rpc(as(publisher), "bible_admin_plan_save", [cal, j({ title: "Synthetic Revised Plan (renamed)", description: "New words" }), null]);
      expect((await rpc<Json>(as(m1), "bible_plan", [cal])).progress).toEqual(before);
      await fails(as(editor), "bible_admin_plan_save", [cal, j({ title: "x" }), null], /publisher/);
      await fails(as(publisher), "bible_admin_plan_save", [cal, j({ mode: "personal" }), null], /Create a new version/);
      const copy = await rpc<Json>(as(editor), "bible_admin_plan_duplicate", [cal, "Synthetic Revised Plan 2028", true, 365]);
      expect(copy).toMatchObject({ status: "draft", previous_plan_id: cal });
    });

    it("keeps archived plans readable to people who joined them", async () => {
      await rpc(as(publisher), "bible_admin_plan_status", [cal, "archive", null]);
      await expect(rpc(as(m1), "bible_plan", [cal])).resolves.toBeTruthy();
      await fails(as(m3), "bible_plan", [cal], /not found/);
      expect(((await rpc<Json>(as(m1), "journal_entry", [entry])).link as Json).available).toBe(true);
    });
  });

  describe("journals are owner-only", () => {
    let entry: string;
    it("creates idempotently and is readable by nobody else", async () => {
      const key = randomUUID();
      const a = await rpc<Json>(as(m1), "journal_entry_create", [key, "Morning", `${SECRET_PHRASE} two`, null]);
      const b = await rpc<Json>(as(m1), "journal_entry_create", [key, "Morning", `${SECRET_PHRASE} two`, null]);
      expect(b.id).toBe(a.id);
      entry = a.id as string;
      for (const other of [m2, admin, publisher, editor, sourceMgr, leader, contentEditor]) {
        await fails(as(other), "journal_entry", [entry], /Entry not found/);
        await fails(as(other), "journal_entry_save", [entry, "x", "y", 1, true], /Entry not found/);
        await fails(as(other), "journal_entry_delete", [entry], /Entry not found/);
        const mine = await rpc<Json>(as(other), "journal_entries", [SECRET_PHRASE, "active", 50, 0]);
        expect(mine.total).toBe(0);
        const exported = await rpc<Json>(as(other), "journal_export");
        expect(JSON.stringify(exported)).not.toContain(SECRET_PHRASE);
      }
    });

    it("searches only the owner's own entries, with literal wildcards", async () => {
      const r = await rpc<Json>(as(m1), "journal_entries", [SECRET_PHRASE, "active", 50, 0]);
      expect(r.total).toBe(2);
      expect((await rpc<Json>(as(m1), "journal_entries", ["%", "active", 50, 0])).total).toBe(0);
    });

    it("saves with optimistic concurrency: retries are idempotent, stale saves conflict, force overwrites", async () => {
      const s1 = await rpc<Json>(as(m1), "journal_entry_save", [entry, "Morning", "draft one", 1, false]);
      expect(s1).toMatchObject({ status: "saved", version: 2 });
      // The same request retried after it landed.
      expect(await rpc<Json>(as(m1), "journal_entry_save", [entry, "Morning", "draft one", 1, false])).toMatchObject({ status: "saved", version: 2 });
      // Another tab still on version 1.
      const c = await rpc<Json>(as(m1), "journal_entry_save", [entry, "Morning", "other tab text", 1, false]);
      expect(c).toMatchObject({ status: "conflict", current: { body: "draft one", version: 2 } });
      expect((await rpc<Json>(as(m1), "journal_entry", [entry])).body).toBe("draft one");
      expect(await rpc<Json>(as(m1), "journal_entry_save", [entry, "Morning", "other tab text", 1, true])).toMatchObject({ status: "saved", version: 3 });
      await fails(as(m1), "journal_entry_save", [entry, "t", "x".repeat(100_001), 3, false], /too long/);
    });

    it("withholds linked teaching once the member can't see it, keeping the note", async () => {
      const item = (await rpc<Json>(as(admin), "media_admin_item_save", [null, j({ kind: "devotional", title: "Synthetic devotional", body: "Body", audience: "members" }), null])).id as string;
      await rpc(as(admin), "media_admin_item_status", [item, "publish", null, null, null]);
      const e = (await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "On the devotional", "note text", j({ kind: "devotional", media_item_id: item })])).id;
      expect(((await rpc<Json>(as(m1), "journal_entry", [e])).link as Json)).toMatchObject({ available: true, title: "Synthetic devotional" });
      await rpc(as(admin), "media_admin_item_status", [item, "archive", null, null, null]);
      const after = await rpc<Json>(as(m1), "journal_entry", [e]);
      expect(after.body).toBe("note text");
      expect(after.link).toMatchObject({ available: false, title: null, item_id: null });
    });

    it("pauses access while suspended and restores it on reinstatement", async () => {
      await db.setStatus(m1, "suspended");
      await fails(as(m1), "journal_entry", [entry], /Only approved members/);
      await db.setStatus(m1, "approved");
      expect((await rpc<Json>(as(m1), "journal_entry", [entry])).body).toBe("other tab text");
    });

    it("archives, exports, and deletes", async () => {
      await rpc(as(m1), "journal_entry_status", [entry, "archive"]);
      expect((await rpc<Json>(as(m1), "journal_entries", [null, "archived", 50, 0])).total).toBe(1);
      const exported = await rpc<Json>(as(m1), "journal_export");
      expect((exported.entries as Json[]).length).toBeGreaterThanOrEqual(3);
      await rpc(as(m1), "journal_entry_delete", [entry]);
      await fails(as(m1), "journal_entry", [entry], /Entry not found/);
      await fails(as(m1), "journal_delete_all", ["delete"], /Type DELETE/);
    });

    it("keeps journal text out of the audit log, notifications, and staff views", async () => {
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from public.audit_log where details::text like $1", [`%zebra-lantern%`]);
      expect(n).toBe(0);
      const [{ k }] = await db.raw<{ k: number }>("select count(*)::int k from community.notifications where detail::text like '%zebra%'");
      expect(k).toBe(0);
      const staff = JSON.stringify(await rpc(as(admin), "bible_admin_plans"));
      expect(staff).not.toContain("zebra");
    });
  });

  describe("account deletion", () => {
    it("removes a deleted member's journal, progress, bookmarks, and highlights", async () => {
      const gone = await db.createAuthUser("b.gone@example.test", { fullName: "Departing Reader" });
      await db.setStatus(gone, "approved");
      await rpc(as(gone), "journal_entry_create", [randomUUID(), "Synthetic", "Synthetic text", null]);
      await rpc(as(gone), "bible_highlight_set", [web, "JHN", 3, [16], "green"]);
      const plans = (await rpc<Json>(as(gone), "bible_hub")).available as Json[];
      await rpc(as(gone), "bible_plan_join", [plans[0].id, null, null, true]);
      await db.raw("delete from auth.users where id = $1", [gone]);
      for (const table of ["journal.entries", "bible.highlights", "bible.enrollments", "bible.bookmarks", "bible.reader_prefs"]) {
        const [{ n }] = await db.raw<{ n: number }>(`select count(*)::int n from ${table} where profile_id = $1`, [gone]);
        expect(n, table).toBe(0);
      }
    });
  });

  describe("bookmarks, highlights, and export", () => {
    it("are private, toggle, and are included in the member's export", async () => {
      const b = await rpc<Json>(as(m1), "bible_bookmark_toggle", [j({ kind: "passage", translation_id: web, book: "JHN", chapter: 3, start_verse: 16, end_verse: 17 })]);
      expect(b.bookmarked).toBe(true);
      await fails(as(m1), "bible_bookmark_toggle", [j({ kind: "passage", translation_id: web, book: "JHN", chapter: 3, start_verse: 99 })], /can't be bookmarked/);
      expect((await rpc<Json[]>(as(m1), "bible_bookmarks"))[0]).toMatchObject({ reference: "John 3:16–17", translation_code: "WEB", available: true });
      expect(await rpc<Json[]>(as(m2), "bible_bookmarks")).toEqual([]);
      // Someone else can't remove it.
      await rpc(as(m2), "bible_bookmark_remove", [b.id]);
      expect(await rpc<Json[]>(as(m1), "bible_bookmarks")).toHaveLength(1);
      const h = await rpc<Json[]>(as(m1), "bible_highlight_set", [web, "JHN", 3, [16, 17], "yellow"]);
      expect(h).toEqual([{ verse: 16, color: "yellow" }, { verse: 17, color: "yellow" }]);
      await fails(as(m1), "bible_highlight_set", [web, "JHN", 3, [99], "yellow"], /Choose verses/);
      expect(await rpc<Json[]>(as(m2), "bible_highlights", [web, "JHN", 3])).toEqual([]);
      const exported = await rpc<Json>(as(m1), "bible_my_reading_export");
      expect(exported.highlights).toMatchObject([{ translation: "WEB", reference: "John 3:16", color: "yellow" }, { reference: "John 3:17" }]);
      expect((exported.bookmarks as Json[]).length).toBe(1);
      expect(await rpc<Json[]>(as(m1), "bible_highlight_set", [web, "JHN", 3, [16], null])).toEqual([{ verse: 17, color: "yellow" }]);
      expect((await rpc<Json>(as(m1), "bible_bookmark_toggle", [j({ kind: "passage", translation_id: web, book: "JHN", chapter: 3, start_verse: 16, end_verse: 17 })])).bookmarked).toBe(false);
      await fails(as(m1), "bible_annotations_clear", ["highlights", "bookmarks"], /Confirm/);
      expect(await rpc<number>(as(m1), "bible_annotations_clear", ["highlights", "highlights"])).toBe(1);
      // Shared verse rows carry no annotations.
      const cols = await db.raw<{ c: string }>("select column_name c from information_schema.columns where table_schema = 'bible' and table_name = 'verses'");
      expect(cols.map((c) => c.c).sort()).toEqual(["book_code", "chapter", "heading", "omitted", "para_start", "poetry", "text", "translation_id", "verse"]);
    });

    it("keeps reader settings separate from scripture", async () => {
      await fails(as(m1), "bible_reader_prefs_save", [j({ text_size: 400 })]);
      const p = await rpc<Json>(as(m1), "bible_reader_prefs_save", [j({ text_size: 130, line_spacing: 1.9 })]);
      expect(p).toMatchObject({ text_size: 130, line_spacing: 1.9 });
      expect(await rpc<Json>(as(m2), "bible_reader_prefs")).toMatchObject({ text_size: 100 });
    });
  });

  describe("reminders", () => {
    let plan: string;
    let restPlan: string;
    const tick = () => db.raw("select community.tick()");
    const reminders = async (id: string) => (await notifs(id)).filter((n) => n.kind === "reading_reminder");
    it("sends one generic reminder per day at the member's time, never twice", async () => {
      plan = await newPlan("personal", "Synthetic Reminder Plan");
      await day(plan, { number: 1 }, [P("PSA", 23)]);
      await publish(plan);
      const e = await rpc<Json>(as(m3), "bible_plan_join", [plan, await today(), tz, true]);
      const [{ t }] = await db.raw<{ t: string }>("select to_char((now() at time zone $1)::time - interval '2 minutes', 'HH24:MI') t", [tz]);
      await rpc(as(m3), "bible_enrollment_update", [e.id, j({ reminders: true, reminder_time: t })]);
      await tick();
      await tick();
      const r = await reminders(m3);
      expect(r).toHaveLength(1);
      expect(r[0].title).toBe("Today's reading is ready: “Synthetic Reminder Plan”");
      expect(r[0].url).toBe("/bible/today");
      // Outside the app: generic wording only.
      const [{ item }] = await db.raw<{ item: Json }>("select community.notification_email_item(n) item from community.notifications n where n.id = $1", [r[0].id]);
      expect(item.title).toBe("Your Bible reading for today is ready");
      expect(JSON.stringify(item)).not.toContain("Synthetic");
      // A retried run on the same day doesn't add another.
      await db.raw("update bible.enrollments set last_reminded_on = null where id = $1", [e.id]);
      await tick();
      expect(await reminders(m3)).toHaveLength(1);
    });

    it("skips rest days, finished readings, paused reminders, and people who lost access", async () => {
      restPlan = await newPlan("personal", "Synthetic Rest Plan", { audience: "group", group });
      await rpc(as(editor), "bible_admin_day_save", [restPlan, null, j({ day_number: 1, kind: "rest" })]);
      await day(restPlan, { number: 2 }, [P("PSA", 23)]);
      await publish(restPlan);
      const [{ t }] = await db.raw<{ t: string }>("select to_char((now() at time zone $1)::time - interval '2 minutes', 'HH24:MI') t", [tz]);
      const e = await rpc<Json>(as(m1), "bible_plan_join", [restPlan, await today(), tz, true]);
      await rpc(as(m1), "bible_enrollment_update", [e.id, j({ reminders: true, reminder_time: t })]);
      await tick();
      expect((await notifs(m1)).filter((n) => n.kind === "reading_reminder" && String(n.title).includes("Rest Plan"))).toHaveLength(0);
      // Day 2 (tomorrow's reading) becomes today's: completed already → none.
      await rpc(as(m1), "bible_enrollment_update", [e.id, j({ start_date: await shift(-1) })]);
      const day2 = ((await rpc<Json>(as(m1), "bible_plan", [restPlan])).day_list as Json[])[1].id;
      await rpc(as(m1), "bible_day_complete", [day2, true]);
      await db.raw("update bible.enrollments set last_reminded_on = null where id = $1", [e.id]);
      await tick();
      expect((await notifs(m1)).filter((n) => n.kind === "reading_reminder" && String(n.title).includes("Rest Plan"))).toHaveLength(0);
      // Leaving the group turns reminders off for the group's plan.
      await db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [group, m1]);
      const [{ enabled }] = await db.raw<{ enabled: boolean }>("select reminders as enabled from bible.enrollments where id = $1", [e.id]);
      expect(enabled).toBe(false);
      await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, m1]);
    });

    it("never sends twice when two scheduler runs overlap, and pushes only generic text", async () => {
      const p2 = await newPlan("personal", "Synthetic Concurrency Plan");
      await day(p2, { number: 1 }, [P("PSA", 23)]);
      await publish(p2);
      const e = await rpc<Json>(as(m2), "bible_plan_join", [p2, await today(), tz, true]);
      const [{ t }] = await db.raw<{ t: string }>("select to_char((now() at time zone $1)::time - interval '2 minutes', 'HH24:MI') t", [tz]);
      await rpc(as(m2), "bible_enrollment_update", [e.id, j({ reminders: true, reminder_time: t })]);
      await db.raw("update community.notification_prefs set push = true where profile_id = $1", [m2]);
      await db.raw("insert into community.notification_prefs (profile_id, category, in_app, email, push) values ($1, 'reading', true, 'immediate', true) on conflict (profile_id, category) do update set push = true", [m2]);
      await db.raw("insert into community.push_subscriptions (profile_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/synthetic', $2, 'synthetic-auth')", [m2, "p".repeat(40)]);
      const a = await db.connect();
      const b = await db.connect();
      try {
        await Promise.all([a.query("select community.tick()"), b.query("select community.tick()")]);
      } finally {
        await a.end();
        await b.end();
      }
      const mine = (await notifs(m2)).filter((n) => n.kind === "reading_reminder" && String(n.title).includes("Concurrency"));
      expect(mine).toHaveLength(1);
      const [{ n: emails }] = await db.raw<{ n: number }>("select count(*)::int n from community.email_outbox where notification_id = $1", [mine[0].id]);
      expect(emails).toBe(1);
      const claimed = await db.raw<{ r: Json[] }>("select community.op_push_claim('{\"limit\": 50}'::jsonb) r");
      const push = (claimed[0].r as Json[]).find((x) => x.url === `/notifications/open/${mine[0].id}`);
      expect(push?.body).toBe("There's an update about your Bible reading.");
    });

    it("rechecks the enrollment before showing or delivering a reminder", async () => {
      const r = await reminders(m3);
      expect(r).toHaveLength(1);
      const enr = (await rpc<Json>(as(m3), "bible_plan", [plan])).enrollment as Json;
      await rpc(as(m3), "bible_enrollment_update", [enr.id, j({ reminders_paused: true })]);
      expect(await reminders(m3)).toHaveLength(0);
      await rpc(as(m3), "bible_enrollment_update", [enr.id, j({ reminders_paused: false })]);
      await rpc(as(m3), "bible_plan_leave", [enr.id]);
      expect(await reminders(m3)).toHaveLength(0);
    });
  });

  describe("a second version (ASV) and the member's preferred version", () => {
    let asv: string;
    it("imports the ASV sample through the same review and keeps its numbering", async () => {
      asv = (await rpc<Json>(as(sourceMgr), "bible_admin_translation_save", [null, j({
        code: "ASV", name: "American Standard Version (1901)", source_kind: "database",
        attribution: "American Standard Version (1901). Public domain.", copyright: "Public domain",
        rights: "public_domain", confirm_rights: true, allow_copy: true, allow_print: true, allow_export: true,
      })])).id as string;
      const { id, summary } = await stageImport(asv, ASV_FIXTURE);
      expect(summary.duplicate).toBe(0);
      expect(summary.malformed).toBe(0);
      expect(summary.empty).toBe(0); // the ASV prints Acts 8:37 (bracketed)
      const flagged = (await rpc<Json>(as(sourceMgr), "bible_admin_import", [id, null, 100, 0])).issues as Json[];
      // The ASV numbers the Romans doxology 16:25–27; the reference numbering
      // stops at 16:25, so 16:26–27 are flagged and kept only on acceptance.
      expect(flagged.map((x) => `${x.issue} ${x.book} ${x.chapter}:${x.verse}`)).toEqual(["out_of_range ROM 16:26", "out_of_range ROM 16:27"]);
      await fails(as(sourceMgr), "bible_admin_import_publish", [id, "ASV", true, null], /Review every flagged line/);
      await rpc(as(sourceMgr), "bible_admin_import_accept", [id, flagged.map((x) => x.line as number), true]);
      const pub = await rpc<Json>(as(sourceMgr), "bible_admin_import_publish", [id, "ASV", true, "Sample reviewed against the source"]);
      expect(pub.verses).toBe(190);
      await rpc(as(sourceMgr), "bible_admin_translation_status", [asv, "activate", "ASV"]);
    });

    it("lists both versions with the church's default first", async () => {
      const list = await rpc<Json>(as(m3), "bible_translations");
      expect((list.items as Json[]).map((t) => t.code)).toEqual(["WEB", "ASV"]);
      expect(list.default_id).toBe(web);
      expect(list.preferred_id).toBeNull();
    });

    it("serves each version's own words, labelled, without mixing", async () => {
      const a = await rpc<Json>(as(m3), "bible_passage", [asv, "JHN", 3, 16, 3, 16]);
      const w = await rpc<Json>(as(m3), "bible_passage", [web, "JHN", 3, 16, 3, 16]);
      expect((a.translation as Json).code).toBe("ASV");
      expect((a.verses as Json[]).map((v) => v.t)).toEqual([ASV_JOHN_3_16]);
      expect((w.verses as Json[]).map((v) => v.t)).toEqual([JOHN_3_16]);
      const ps = await rpc<Json>(as(m3), "bible_passage", [asv, "PSA", 23, 1, 23, 1]);
      expect((ps.verses as Json[])[0].t).toBe("Jehovah is my shepherd; I shall not want.");
      // Square brackets are the source's own (a verse the ASV prints in its margin).
      const acts = await rpc<Json>(as(m3), "bible_chapter", [asv, "ACT", 8]);
      expect(String((acts.verses as Json[]).find((v) => v.v === 37)!.t)).toMatch(/^\[And Philip said/);
      // Versification differs: the ASV's doxology is Romans 16:25–27; the WEB has
      // no 16:26. The day page falls back to the plan's version on this error.
      expect(((await rpc<Json>(as(m3), "bible_passage", [asv, "ROM", 16, 25, 16, 27])).verses as Json[])).toHaveLength(3);
      await fails(as(m3), "bible_passage", [web, "ROM", 16, 26, 16, 27], /verse doesn't exist/);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from bible.verses where translation_id = $1", [asv]);
      expect(n).toBe(190);
    });

    it("saves the member's preferred version privately and clears it", async () => {
      const saved = await rpc<Json>(as(m3), "bible_reader_prefs_save", [j({ translation_id: asv })]);
      expect(saved.translation_id).toBe(asv);
      expect((await rpc<Json>(as(m3), "bible_translations")).preferred_id).toBe(asv);
      // Other members (and administrators) keep their own.
      expect((await rpc<Json>(as(m1), "bible_translations")).preferred_id).not.toBe(asv);
      expect((await rpc<Json>(as(admin), "bible_translations")).preferred_id).toBeNull();
      // Only an active version can be chosen.
      const draft = (await rpc<Json>(as(sourceMgr), "bible_admin_translation_save", [null, j({ code: "DRAFTV", name: "Draft version" })])).id;
      await fails(as(m3), "bible_reader_prefs_save", [j({ translation_id: draft })], /isn't available/);
      // Other reader settings don't touch the choice; an empty value clears it.
      await rpc(as(m3), "bible_reader_prefs_save", [j({ text_size: 120 })]);
      expect((await rpc<Json>(as(m3), "bible_reader_prefs")).translation_id).toBe(asv);
      await rpc(as(m3), "bible_reader_prefs_save", [j({ translation_id: "" })]);
      expect((await rpc<Json>(as(m3), "bible_translations")).preferred_id).toBeNull();
    });
  });
});
