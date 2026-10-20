import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 9 scripture memory against a real database: scoped capabilities
 * (editor vs publisher vs authorized group leader vs content and Bible
 * staff), passages captured exactly from the Phase 8 source, collections
 * (audience, scheduling, archive, duplicate, delete), all six activities
 * with server-side scoring (Unicode, punctuation, case, contractions,
 * repeated words, verse numbers, references, hints), answers never sent
 * before they're revealed, idempotent submission and conflicts, the review
 * schedule (one change per day, early reviews, easing back, missed days),
 * time zones, badges awarded once, owner-only results (not administrators,
 * leaders, or household members), challenges (opt-in, thresholds, rounding,
 * withdrawal, lost membership, suspension), text-version changes,
 * deletion, and reminders (preferences, generic wording, deduplication).
 *
 * Scripture comes from tests/fixtures/bible/web-sample.csv (an excerpt of
 * the public-domain World English Bible). Every person is synthetic.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const JOHN_3_16 = "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.";
const JOHN_3_17 = "For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.";

describeDb("Scripture memory and practice", () => {
  let db: TestDb;
  let admin: string; // super administrator
  let editor: string; // memory_verse_editor
  let publisher: string; // memory_verse_publisher
  let contentEditor: string;
  let planPublisher: string; // reading_plan_publisher (Phase 8)
  let leader: string; // leads `group`
  let otherLeader: string; // leads `otherGroup`
  let m1: string;
  let m2: string; // shares a household with m1
  let m3: string;
  let m4: string;
  let m5: string;
  let pending: string;
  let suspended: string;
  let group: string;
  let otherGroup: string;
  let web: string;
  let api: string; // an API-sourced translation
  let church: string; // published church collection
  let john: string; // item: John 3:16–17 (current assignment)
  let psalm: string; // item: Psalm 23:1–6

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
  const P = (book: string, sc: number, sv: number, ec = sc, ev = sv) => ({ book, sc, sv, ec, ev });
  const addCard = async (who: string, p: Json) => (await rpc<Json>(as(who), "memory_card_add", [j(p)])).id as string;
  const start = (who: string, card: string, activity: string, difficulty = "guided", segment = 0, options: Json = {}) =>
    rpc<Json>(as(who), "memory_session_start", [card, activity, difficulty, segment, j(options)]);
  const submit = (who: string, session: string, payload: Json) => rpc<Json>(as(who), "memory_session_submit", [session, j(payload)]);
  /** Moves a card's schedule back as if its last change happened days ago. */
  const age = (card: string, days: number) =>
    db.raw("update memory.cards set last_scheduled_on = last_scheduled_on - $2::int, due_on = due_on - $2::int where id = $1", [card, days]);
  const typedSession = async (who: string, card: string, text: string, options: Json = {}) => {
    const s = await start(who, card, "type_verse", "growing", 0, options);
    return submit(who, s.id as string, { text });
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, state: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (state !== "pending") await db.setStatus(id, "approved");
      if (state === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("mv.admin@example.test", "Synthetic Admin");
    editor = await mk("mv.editor@example.test", "Synthetic Memory Editor");
    publisher = await mk("mv.publisher@example.test", "Synthetic Memory Publisher");
    contentEditor = await mk("mv.content@example.test", "Synthetic Content Editor");
    planPublisher = await mk("mv.plans@example.test", "Synthetic Plan Publisher");
    leader = await mk("mv.leader@example.test", "Synthetic Leader");
    otherLeader = await mk("mv.leader2@example.test", "Synthetic Other Leader");
    m1 = await mk("mv.m1@example.test", "Alpha Memorizer");
    m2 = await mk("mv.m2@example.test", "Bravo Memorizer");
    m3 = await mk("mv.m3@example.test", "Charlie Memorizer");
    m4 = await mk("mv.m4@example.test", "Delta Memorizer");
    m5 = await mk("mv.m5@example.test", "Echo Memorizer");
    pending = await mk("mv.pending@example.test", "Pending Memorizer", "pending");
    suspended = await mk("mv.suspended@example.test", "Suspended Memorizer", "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(editor, "memory_verse_editor");
    await db.grantRole(publisher, "memory_verse_publisher");
    await db.grantRole(contentEditor, "content_editor");
    await db.grantRole(planPublisher, "reading_plan_publisher");
    group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Memory Group", summary: "s", about: "a", visibility: "discoverable", leader_id: leader })]);
    otherGroup = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Other Group", summary: "s", about: "a", visibility: "hidden", leader_id: otherLeader })]);
    for (const id of [m1, m2, m3, m4, m5]) await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    const h = await rpc<string>(as(m1), "household_create", ["Synthetic Household"]);
    await db.raw("insert into public.household_members (household_id, profile_id) values ($1, $2)", [h, m2]);

    // The approved source (Phase 8): stored WEB text, imported as an administrator would.
    web = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
       values ('WEB', 'World English Bible', 'World English Bible (WEB), public domain.', 'Public domain', 'public_domain', now(), 'draft', 1) returning id`,
    ))[0].id;
    const rows = parseSourceFile(FIXTURE, "csv").filter((r) => r.book && r.chapter && r.verse);
    for (const r of rows) {
      await db.raw("insert into bible.verses (translation_id, book_code, chapter, verse, text, omitted, heading, para_start, poetry) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        web, r.book, r.chapter, r.verse, r.text, r.text.trim() === "", r.heading, r.para, r.poetry,
      ]);
    }
    await db.raw("update bible.translations set verse_count = $2, status = 'active' where id = $1", [web, rows.length]);
    await db.raw("update bible.settings set default_translation_id = $1", [web]);
    api = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status)
       values ('APIX', 'Licensed API version', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), 'active') returning id`,
    ))[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("access and capabilities", () => {
    it("keeps the memory schema closed to clients", async () => {
      await expect(db.query(as(m1), "select * from memory.cards")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(admin), "select * from memory.attempts")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.memory_home()")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(m1), "select memory.award($1, 'explorer')", [m1])).rejects.toThrow(/permission denied/);
    });

    it("refuses pending and suspended accounts", async () => {
      await fails(as(pending), "memory_home", [], /approved members/);
      await fails(as(suspended), "memory_home", [], /approved members/);
      await fails(as(suspended), "memory_cards", [], /approved members/);
    });

    it("scopes administration to the memory capabilities", async () => {
      for (const who of [m1, contentEditor, planPublisher, leader]) await fails(as(who), "memory_admin_home", [], /permission/);
      const home = await rpc<Json>(as(editor), "memory_admin_home");
      expect(home).toMatchObject({ can_manage: true, can_publish: false });
      expect((await rpc<Json>(as(admin), "memory_admin_home")).can_publish).toBe(true);
    });

    it("lets editors draft but only publishers publish", async () => {
      const c = await rpc<Json>(as(editor), "memory_admin_collection_save", [null, j({ title: "Editor draft", translation_id: web }), randomUUID()]);
      await rpc(as(editor), "memory_admin_item_add", [c.id, j(P("GEN", 1, 1))]);
      await fails(as(editor), "memory_admin_collection_status", [c.id, "publish", null], /publisher/);
      expect((await rpc<Json>(as(publisher), "memory_admin_collection_status", [c.id, "publish", null])).status).toBe("published");
      // Published collections change only with publishing rights.
      await fails(as(editor), "memory_admin_collection_save", [c.id, j({ title: "Renamed" })], /publisher/);
      await rpc(as(publisher), "memory_admin_collection_status", [c.id, "archive", null]);
    });

    it("creates idempotently with a client key and audits without content", async () => {
      const key = randomUUID();
      const a = await rpc<Json>(as(editor), "memory_admin_collection_save", [null, j({ title: "Keyed", translation_id: web }), key]);
      const b = await rpc<Json>(as(editor), "memory_admin_collection_save", [null, j({ title: "Keyed", translation_id: web }), key]);
      expect(b.id).toBe(a.id);
      const audit = await db.raw<{ action: string; details: Json }>("select action, details from public.audit_log where target_id = $1", [a.id]);
      expect(audit.map((r) => r.action)).toEqual(["memory.collection_created"]);
      expect(JSON.stringify(audit)).not.toContain("Keyed");
    });
  });

  describe("passages from the approved source", () => {
    it("captures the exact text, reference, translation, attribution, and version", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Fall verses", translation_id: web, kind: "sequence" }), null]);
      church = c.id as string;
      const item = await rpc<Json>(as(publisher), "memory_admin_item_add", [church, j({ ...P("JHN", 3, 16, 3, 17), title: "God so loved", hint: "Two verses about God's love", starts_on: "2000-01-01", ends_on: "2000-01-07" })]);
      john = item.id as string;
      const passage = item.passage as Json;
      expect(passage).toMatchObject({ label: "John 3:16–17", ref_key: "WEB:JHN.3.16-3.17", version: 1, text_version: 1 });
      expect((passage.verses as Json[]).map((v) => v.t)).toEqual([JOHN_3_16, JOHN_3_17]);
      expect(passage.translation).toMatchObject({ code: "WEB", attribution: "World English Bible (WEB), public domain." });
      // Editorial text stays apart from scripture.
      expect(item.title).toBe("God so loved");
      expect(JSON.stringify(passage)).not.toContain("God's love");
      psalm = (await rpc<Json>(as(publisher), "memory_admin_item_add", [church, j(P("PSA", 23, 1, 23, 6))])).id as string;
      await rpc(as(publisher), "memory_admin_item_save", [john, j({ starts_on: await todayIn("America/Chicago", -2), ends_on: await todayIn("America/Chicago", 4) })]);
      await rpc(as(publisher), "memory_admin_collection_status", [church, "publish", null]);
    });

    it("splits long passages into parts without changing the words", async () => {
      const admin_ = await rpc<Json>(as(publisher), "memory_admin_collection", [church]);
      const ps = (admin_.items as Json[]).find((i) => i.id === psalm)!.passage as Json;
      const parts = ps.segments as Array<{ n: number; label: string; words: number }>;
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.reduce((s, p) => s + p.words, 0)).toBe(ps.word_count);
      expect(parts.every((p) => p.words <= 32)).toBe(true);
      expect((ps.short_segments as Json[]).length).toBeGreaterThan(parts.length);
      expect(parts[0].label).toMatch(/^Part 1 of \d+ · verse/);
      // The poetry lines survive in the practice text.
      const [{ t }] = await db.raw<{ t: string }>("select memory.range_text(tokens, 0, 7) t from memory.passages where ref_key = 'WEB:PSA.23.1-23.6'");
      expect(t).toBe("Yahweh is my shepherd:\nI shall lack nothing.");
    });

    it("refuses passages that can't be practiced safely", async () => {
      await fails(as(publisher), "memory_admin_item_add", [church, j(P("JHN", 3, 1, 3, 36))], /at most 30 verses/);
      await fails(as(publisher), "memory_admin_item_add", [church, j(P("JHN", 3, 99))], /doesn't exist/);
      await fails(as(publisher), "memory_admin_item_add", [church, j({ book: "JHN", sc: 3, sv: null, ec: 3, ev: null })], /first and last verse/);
      const p = await rpc<Json>(as(m1), "memory_passage_preview", [api, j(P("JHN", 3, 16))]);
      expect(p).toMatchObject({ ok: false });
      expect(p.problem).toMatch(/outside service/);
      await fails(as(m1), "memory_card_add", [j({ translation_id: api, ...P("JHN", 3, 16) })], /outside service/);
    });

    it("leaves out omitted verses and says so", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Acts", translation_id: web }), null]);
      await rpc(as(publisher), "memory_admin_item_add", [c.id, j(P("ACT", 8, 36, 8, 38))]);
      const full = await rpc<Json>(as(publisher), "memory_admin_collection", [c.id]);
      const it0 = (full.items as Json[])[0];
      expect(((it0.passage as Json).verses as Json[]).map((v) => v.v)).toEqual([36, 38]);
      expect((it0.suitability as string[]).join(" ")).toMatch(/leaves out/);
    });

    it("previews a member's passage without saving anything", async () => {
      const p = await rpc<Json>(as(m3), "memory_passage_preview", [web, j(P("GEN", 1, 1))]);
      expect(p).toMatchObject({ ok: true, label: "Genesis 1:1" });
      expect((p.verses as Json[])[0].t).toBe("In the beginning, God created the heavens and the earth.");
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.cards where profile_id = $1", [m3]);
      expect(n).toBe(0);
    });
  });

  describe("collections and audiences", () => {
    it("shows the current assignment to members (and to nobody else)", async () => {
      const home = await rpc<Json>(as(m1), "memory_home");
      expect((home.assignments as Json[]).map((a) => a.id)).toEqual([john]);
      const card = await rpc<Json>(as(m1), "memory_home_card");
      expect(((card.item as Json).passage as Json).label).toBe("John 3:16–17");
      expect(JSON.stringify(card)).not.toContain("For God so loved");
      expect(await rpc(as(m3), "memory_home_card")).not.toBeNull();
    });

    it("returns no home card without a current assignment", async () => {
      await rpc(as(publisher), "memory_admin_item_save", [john, j({ starts_on: "2000-01-01", ends_on: "2000-01-07" })]);
      expect(await rpc(as(m1), "memory_home_card")).toBeNull();
      await rpc(as(publisher), "memory_admin_item_save", [john, j({ starts_on: await todayIn("America/Chicago", -2), ends_on: await todayIn("America/Chicago", 4) })]);
    });

    it("hides scheduled collections until their time and archived ones from browsing", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Coming soon", translation_id: web }), null]);
      await rpc(as(publisher), "memory_admin_item_add", [c.id, j(P("GEN", 1, 3))]);
      const s = await rpc<Json>(as(publisher), "memory_admin_collection_status", [c.id, "publish", new Date(Date.now() + 86_400_000).toISOString()]);
      expect(s.scheduled).toBe(true);
      const ids = async () => ((await rpc<Json>(as(m1), "memory_collections")).church as Json[]).map((x) => x.id);
      expect(await ids()).not.toContain(c.id);
      await fails(as(m1), "memory_collection", [c.id], /not found/);
      await db.raw("update memory.collections set publish_at = now() - interval '1 minute' where id = $1", [c.id]);
      expect(await ids()).toContain(c.id);
      await rpc(as(publisher), "memory_admin_collection_status", [c.id, "archive", null]);
      expect(await ids()).not.toContain(c.id);
    });

    it("limits group collections to the group's active members", async () => {
      await fails(as(leader), "memory_admin_collection_save", [null, j({ title: "Group", audience: "group", group_id: group, translation_id: web }), null], /permission/);
      await rpc(as(publisher), "memory_admin_group_authorize", [group, true, null]);
      const c = await rpc<Json>(as(leader), "memory_admin_collection_save", [null, j({ title: "Group verses", audience: "group", group_id: group, translation_id: web }), null]);
      // Only their own group, never church-wide or another group.
      await fails(as(leader), "memory_admin_collection_save", [null, j({ title: "Church", audience: "members", translation_id: web }), null], /permission/);
      await fails(as(leader), "memory_admin_collection_save", [null, j({ title: "Other", audience: "group", group_id: otherGroup, translation_id: web }), null], /permission/);
      await fails(as(leader), "memory_admin_collection", [church], /not found/);
      const home = await rpc<Json>(as(leader), "memory_admin_home");
      expect((home.collections as Json[]).map((x) => x.id)).toEqual([c.id]);
      await rpc(as(leader), "memory_admin_item_add", [c.id, j(P("JHN", 3, 18))]);
      await rpc(as(leader), "memory_admin_collection_status", [c.id, "publish", null]);
      const visible = async (who: string) => ((await rpc<Json>(as(who), "memory_collections")).church as Json[]).some((x) => x.id === c.id);
      expect(await visible(m1)).toBe(true);
      expect(await visible(otherLeader)).toBe(false);
      await fails(as(otherLeader), "memory_collection", [c.id], /not found/);
      // Revoking the authorization ends the leader's access.
      await rpc(as(publisher), "memory_admin_group_authorize", [group, false, null]);
      await fails(as(leader), "memory_admin_collection", [c.id], /not found/);
      await rpc(as(publisher), "memory_admin_group_authorize", [group, true, null]);
    });

    it("keeps personal collections private to their owner", async () => {
      const mine = await rpc<Json>(as(m2), "memory_my_collection_save", [null, j({ title: "My private set" })]);
      const card = await addCard(m2, { translation_id: web, ...P("GEN", 1, 1) });
      await rpc(as(m2), "memory_my_collection_add", [mine.id, card]);
      expect(((await rpc<Json>(as(m2), "memory_collection", [mine.id])).items as Json[]).length).toBe(1);
      for (const who of [m1, admin, publisher]) await fails(as(who), "memory_collection", [mine.id], /not found/);
      await fails(as(admin), "memory_admin_collection", [mine.id], /not found/);
      expect(JSON.stringify(await rpc(as(admin), "memory_admin_home"))).not.toContain("My private set");
    });

    it("duplicates into a new draft and deletes only unused drafts", async () => {
      const copy = await rpc<Json>(as(publisher), "memory_admin_collection_duplicate", [church, "Fall verses, next year"]);
      expect(copy).toMatchObject({ status: "draft", previous_collection_id: church, item_count: 2 });
      expect((await rpc<Json>(as(publisher), "memory_admin_collection_delete", [copy.id])).deleted).toBe(true);
      await fails(as(publisher), "memory_admin_collection_delete", [church], /archived, not deleted/);
    });

    it("fills a multiweek sequence and keeps ids when reordering", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Sequence", translation_id: web, kind: "sequence" }), null]);
      const a = (await rpc<Json>(as(publisher), "memory_admin_item_add", [c.id, j(P("GEN", 1, 1))])).id;
      const b = (await rpc<Json>(as(publisher), "memory_admin_item_add", [c.id, j(P("GEN", 1, 2))])).id;
      await rpc(as(publisher), "memory_admin_sequence_fill", [c.id, "2027-01-04", 7]);
      let items = (await rpc<Json>(as(publisher), "memory_admin_collection", [c.id])).items as Json[];
      expect(items.map((i) => [i.id, i.starts_on, i.ends_on])).toEqual([
        [a, "2027-01-04", "2027-01-10"],
        [b, "2027-01-11", "2027-01-17"],
      ]);
      await rpc(as(publisher), "memory_admin_item_move", [b, -1]);
      items = (await rpc<Json>(as(publisher), "memory_admin_collection", [c.id])).items as Json[];
      expect(items.map((i) => i.id)).toEqual([b, a]);
      await fails(as(publisher), "memory_admin_item_save", [a, j({ starts_on: "2027-01-10", ends_on: "2027-01-01" })], /ends before/);
    });
  });

  describe("activities and scoring", () => {
    let card: string;
    beforeAll(async () => {
      card = await addCard(m1, { item_id: john });
    });

    it("adds a verse idempotently", async () => {
      expect(await addCard(m1, { item_id: john })).toBe(card);
    });

    it("read & repeat: shows the verse and records practice without a score", async () => {
      const s = await start(m1, card, "read_repeat");
      const words = ((s.setup as Json).tokens as Json[]).map((t) => t.t).join(" ");
      expect(words).toContain("For God so loved the world,");
      const r = await submit(m1, s.id as string, { level: 2, reveals: 1 });
      expect(r).toMatchObject({ saved: true, completed: true, accuracy: null, hints: 1, quality: "none" });
    });

    it("flashcards: reference first, verse only when revealed, self-assessed", async () => {
      const s = await start(m1, card, "flashcards");
      expect((s.setup as Json).front).toBe("John 3:16–17");
      expect(JSON.stringify(s)).not.toContain("loved the world");
      await fails(as(m1), "memory_session_submit", [s.id, j({ confidence: "fully" })], /Reveal/);
      const shown = await rpc<Json>(as(m1), "memory_session_reveal", [s.id]);
      expect(shown.text).toBe(`${JOHN_3_16} ${JOHN_3_17}`);
      const r = await submit(m1, s.id as string, { confidence: "mostly" });
      expect(r).toMatchObject({ accuracy: null, confidence: "mostly", quality: "partial" });
      // Reference practice: the text on the front, the reference revealed.
      const t = await start(m1, card, "flashcards", "guided", 0, { direction: "text_to_ref" });
      expect((t.setup as Json).front).toContain("For God so loved");
      expect((await rpc<Json>(as(m1), "memory_session_reveal", [t.id])).text).toBeNull();
    });

    it("self-check: reference only, reveal, record what the member reports", async () => {
      const s = await start(m1, card, "self_check");
      expect(JSON.stringify(s)).not.toContain("loved");
      await fails(as(m1), "memory_session_submit", [s.id, j({ confidence: "fully" })], /Reveal/);
      const hint = await rpc<Json>(as(m1), "memory_session_hint", [s.id, "{}"]);
      expect(hint.words).toBe("For God so");
      await rpc(as(m1), "memory_session_reveal", [s.id]);
      const r = await submit(m1, s.id as string, { confidence: "fully" });
      // A hint means it wasn't fully from memory.
      expect(r).toMatchObject({ accuracy: null, hints: 1, quality: "partial" });
    });

    it("missing words: blanks never carry their answers, choices are unambiguous", async () => {
      const s = await start(m1, card, "missing_words", "guided");
      const setup = s.setup as { tokens: Json[]; bank: Array<{ text: string; count?: number }>; blank_count: number };
      const blanks = setup.tokens.filter((t) => t.blank);
      expect(blanks.length).toBe(setup.blank_count);
      expect(blanks.every((b) => !("t" in b))).toBe(true);
      const keys = setup.bank.map((b) => b.text.toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
      // Answer every blank from the hidden setup (as a member who knows it would).
      const [{ setup: hidden }] = await db.raw<{ setup: { blanks: number[] } }>("select setup from memory.sessions where id = $1", [s.id]);
      const [{ tokens }] = await db.raw<{ tokens: Array<{ t: string }> }>("select p.tokens from memory.sessions x join memory.passages p on p.id = x.passage_id where x.id = $1", [s.id]);
      const answers = Object.fromEntries(hidden.blanks.map((i) => [String(i), tokens[i].t.replace(/[^\p{L}\p{N}’']/gu, "").toUpperCase()]));
      const r = await submit(m1, s.id as string, { answers });
      // Case is ignored by default. Choosing from a list is a learning
      // activity: it can move a new verse to "learning", but no further.
      expect(r).toMatchObject({ accuracy: 1, quality: "strong", recall: false });
      expect((r.review as Json).step).toBeLessThanOrEqual(1);
      // A wrong answer is marked, not accepted.
      const s2 = await start(m1, card, "missing_words", "challenge");
      const [{ setup: h2 }] = await db.raw<{ setup: { blanks: number[]; typed: boolean } }>("select setup from memory.sessions where id = $1", [s2.id]);
      expect(h2.typed).toBe(true);
      expect((s2.setup as Json).bank).toBeNull();
      const wrong = Object.fromEntries(h2.blanks.map((i) => [String(i), "banana"]));
      const r2 = await submit(m1, s2.id as string, { answers: wrong });
      expect(r2).toMatchObject({ accuracy: 0, quality: "practice" });
    });

    it("word order: repeated words are interchangeable, every piece keeps its identity", async () => {
      // John 3:17 (one part) has "the world" three times.
      const c17 = await addCard(m4, { translation_id: web, ...P("JHN", 3, 17) });
      const s = await start(m4, c17, "word_order", "challenge");
      const chips = (s.setup as { chips: Array<{ id: string; text: string }> }).chips;
      expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length);
      expect(chips.map((c) => c.text).join(" ")).not.toBe(JOHN_3_17);
      // Build the correct order from the texts, but take the "world" pieces in reverse.
      const pool = [...chips];
      const words = JOHN_3_17.split(" ");
      const order: string[] = [];
      const worlds = chips.filter((c) => c.text.startsWith("world")).map((c) => c.id).reverse();
      for (const w of words) {
        if (w.startsWith("world")) {
          const id = worlds.find((x) => pool.some((p) => p.id === x && p.text === w))!;
          order.push(id);
          pool.splice(pool.findIndex((p) => p.id === id), 1);
        } else {
          const i = pool.findIndex((p) => p.text === w);
          order.push(pool[i].id);
          pool.splice(i, 1);
        }
      }
      const r = await submit(m4, s.id as string, { order });
      expect(r).toMatchObject({ accuracy: 1, quality: "strong", recall: true });
      // Incomplete or duplicated orders are refused.
      const s2 = await start(m4, c17, "word_order", "guided");
      const ids = (s2.setup as { chips: Array<{ id: string }> }).chips.map((c) => c.id);
      await fails(as(m4), "memory_session_submit", [s2.id, j({ order: ids.slice(1) })], /Place every/);
      await fails(as(m4), "memory_session_submit", [s2.id, j({ order: [ids[0], ...ids.slice(0, -1)] })], /Place every/);
      // A hint points to the first misplaced position.
      const hint = await rpc<Json>(as(m4), "memory_session_hint", [s2.id, j({ order: [] })]);
      expect(hint.position).toBe(1);
      expect(ids).toContain(hint.id);
    });

    describe("type the verse", () => {
      let c: string;
      beforeAll(async () => {
        c = await addCard(m3, { translation_id: web, ...P("JHN", 3, 17) });
      });

      it("never sends the text before submission", async () => {
        const s = await start(m3, c, "type_verse");
        expect(JSON.stringify(s)).not.toContain("judge");
        expect((s.setup as Json).words).toBe(22);
      });

      it("accepts case and punctuation differences only when configured, never different words", async () => {
        const lenient = await typedSession(m3, c, "for god didnt send his son into the world to judge the world but that the world should be saved through him");
        expect(lenient).toMatchObject({ accuracy: 1 });
        const strictPunct = await typedSession(m3, c, "For God didnt send his Son into the world to judge the world, but that the world should be saved through him.", { ignore_punctuation: false });
        expect(strictPunct.accuracy).toBeLessThan(1);
        const ops = (strictPunct.details as { ops: Json[] }).ops;
        expect(ops.find((o) => o.op === "changed")).toMatchObject({ expected: "didn’t", typed: "didnt" });
        // Straight and curly apostrophes are the same character to the comparison.
        expect((await typedSession(m3, c, "For God didn't send his Son into the world to judge the world, but that the world should be saved through him.", { ignore_punctuation: false, ignore_case: false })).accuracy).toBe(1);
        const strictCase = await typedSession(m3, c, "for god didn’t send his son into the world to judge the world, but that the world should be saved through him.", { ignore_case: false });
        expect(strictCase.accuracy).toBeLessThan(1);
        // A contraction expanded is a different wording.
        const expanded = await typedSession(m3, c, "For God did not send his Son into the world to judge the world, but that the world should be saved through him.");
        expect(expanded.accuracy).toBeLessThan(1);
        expect(expanded.quality).not.toBe("strong");
      });

      it("handles Unicode normalization", async () => {
        const [{ a, b }] = await db.raw<{ a: string; b: string }>("select memory.word_key($1, true, true) a, memory.word_key($2, true, true) b", ["Café", "CAFÉ"]);
        expect(a).toBe(b);
        const [{ k }] = await db.raw<{ k: string }>("select memory.word_key('Ἀβραὰμ,', true, true) k");
        expect(k).toBe("ἀβραὰμ");
      });

      it("sets aside typed verse numbers and the reference, and preserves the member's text", async () => {
        const text = "John 3:16–17 16 For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life. 17 For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.";
        const r = await typedSession(m1, card, text);
        expect(r).toMatchObject({ accuracy: 1 });
        expect(r.details).toMatchObject({ reference_detected: true, verse_numbers_ignored: 2, your_text: text });
      });

      it("marks missing, extra, and changed words", async () => {
        const r = await typedSession(m3, c, "For God sent his Son into the whole world to judge the world, but that the world should be saved through him.");
        const ops = (r.details as { ops: Array<{ op: string; expected?: string; typed?: string }> }).ops;
        expect(ops.filter((o) => o.op !== "match")).toEqual([
          { op: "changed", expected: "didn’t", typed: "sent" },
          { op: "missing", expected: "send" },
          { op: "extra", typed: "whole" },
        ]);
        // 20 matched ÷ (22 passage words + 2 unmatched typed words).
        expect(r.accuracy).toBe(Number((20 / 24).toFixed(3)));
      });

      it("counts hints on the server", async () => {
        const s = await start(m3, c, "type_verse");
        const h = await rpc<Json>(as(m3), "memory_session_hint", [s.id, j({ position: 3 })]);
        expect(h).toMatchObject({ word: "send", hints: 1 });
        const r = await submit(m3, s.id as string, { text: JOHN_3_17, hints: 0 });
        expect(r).toMatchObject({ accuracy: 1, hints: 1, quality: "partial" });
      });

      it("uses parts for long passages", async () => {
        const ps = await addCard(m3, { item_id: psalm });
        await fails(as(m3), "memory_session_start", [ps, "type_verse", "growing", 0, "{}"], /one part at a time/);
        const s = await start(m3, ps, "type_verse", "growing", 1);
        expect(s.segment_count).toBeGreaterThan(1);
        expect(s.label).toMatch(/^Part 1 of/);
        const kids = await start(m3, ps, "type_verse", "guided", 1, { short: true });
        expect(kids.segment_count).toBeGreaterThan(s.segment_count as number);
      });
    });
  });

  describe("submission safety", () => {
    let card: string;
    beforeAll(async () => {
      card = await addCard(m5, { translation_id: web, ...P("GEN", 1, 1) });
    });

    it("returns the same result for a retried submission and records one attempt", async () => {
      const s = await start(m5, card, "type_verse");
      const first = await submit(m5, s.id as string, { text: "In the beginning, God created the heavens and the earth." });
      const again = await submit(m5, s.id as string, { text: "something else entirely" });
      expect(again).toMatchObject({ ...first, replayed: true });
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where session_id = $1", [s.id]);
      expect(n).toBe(1);
    });

    it("records one attempt when two devices submit the same session at once", async () => {
      const s = await start(m5, card, "self_check");
      await rpc(as(m5), "memory_session_reveal", [s.id]);
      const [a, b] = [await db.connect(), await db.connect()];
      const run = async (c: typeof a) => {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: m5, role: "authenticated" })]);
        const r = await c.query("select public.memory_session_submit($1, $2) r", [s.id, j({ confidence: "fully" })]);
        await c.query("commit");
        return r.rows[0].r as Json;
      };
      const [ra, rb] = await Promise.all([run(a), run(b)]);
      await a.end();
      await b.end();
      expect([ra.replayed, rb.replayed].filter(Boolean)).toHaveLength(1);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where session_id = $1", [s.id]);
      expect(n).toBe(1);
    });

    it("refuses expired sessions and sessions whose verse was removed", async () => {
      const s = await start(m5, card, "type_verse");
      await db.raw("update memory.sessions set expires_at = now() - interval '1 minute' where id = $1", [s.id]);
      expect(await submit(m5, s.id as string, { text: "x" })).toEqual({ status: "expired", saved: false });
      const s2 = await start(m5, card, "type_verse");
      await rpc(as(m5), "memory_card_remove", [card, "remove", null]);
      expect(await submit(m5, s2.id as string, { text: "x" })).toEqual({ status: "conflict", saved: false });
      await rpc(as(m5), "memory_card_remove", [card, "restore", null]);
    });

    it("lets nobody else start, hint, reveal, or submit a member's practice", async () => {
      const s = await start(m5, card, "self_check");
      for (const who of [m1, admin, publisher, leader]) {
        await fails(as(who), "memory_session_start", [card, "type_verse", "guided", 0, "{}"], /not found/);
        await fails(as(who), "memory_session_reveal", [s.id], /wasn't found/);
        await fails(as(who), "memory_session_hint", [s.id, "{}"], /wasn't found/);
        await fails(as(who), "memory_session_submit", [s.id, j({ confidence: "fully" })], /wasn't found/);
      }
    });

    it("rate-limits submissions", async () => {
      await db.raw("insert into community.rate_events (profile_id, action) select $1, 'memory_submit' from generate_series(1, 120)", [m5]);
      const s = await start(m5, card, "read_repeat");
      await fails(as(m5), "memory_session_submit", [s.id, j({ level: 0 })], /too often/);
      await db.raw("delete from community.rate_events where profile_id = $1", [m5]);
    });
  });

  describe("review schedule", () => {
    let card: string;
    const review = async (r: Json) => r.review as { change: string; step: number; due_on: string; stage: string };
    beforeAll(async () => {
      await rpc(as(m4), "memory_settings_save", [j({ timezone: "America/New_York" })]);
      card = await addCard(m4, { translation_id: web, ...P("GEN", 1, 3) });
    });
    const exact = "God said, “Let there be light,” and there was light.";

    it("starts new verses as due today", async () => {
      const queue = await rpc<Json>(as(m4), "memory_review_queue");
      expect((queue.due as Json[]).some((c) => c.id === card)).toBe(true);
    });

    it("advances once per day on strong recall when due", async () => {
      const today = await todayIn("America/New_York");
      const r1 = await review(await typedSession(m4, card, exact));
      expect(r1).toMatchObject({ change: "advanced", step: 1, due_on: await todayIn("America/New_York", 1), stage: "learning" });
      const r2 = await review(await typedSession(m4, card, exact));
      expect(r2).toMatchObject({ change: "already_today", step: 1 });
      const [{ d }] = await db.raw<{ d: string }>("select local_date::text d from memory.attempts where card_id = $1 order by created_at desc limit 1", [card]);
      expect(d).toBe(today);
    });

    it("counts early reviews as practice without moving the schedule", async () => {
      await age(card, 1); // as if yesterday; now due today
      await db.raw("update memory.cards set due_on = due_on + 3 where id = $1", [card]); // not due yet
      expect((await review(await typedSession(m4, card, exact))).change).toBe("early");
    });

    it("keeps the step on partial recall and eases back one step on a hard day", async () => {
      await db.raw("update memory.cards set due_on = current_date - 1, last_scheduled_on = current_date - 2, step = 3, best_step = 3 where id = $1", [card]);
      const partial = await review(await typedSession(m4, card, "God said, Let there be light, and there was"));
      expect(partial).toMatchObject({ change: "kept", step: 3 });
      await age(card, 2);
      await db.raw("update memory.cards set due_on = current_date - 1 where id = $1", [card]);
      const hard = await review(await typedSession(m4, card, "light"));
      expect(hard).toMatchObject({ change: "eased", step: 2 });
      // Review-ready is kept: it was earned and isn't taken away.
      const c = await rpc<Json>(as(m4), "memory_card", [card]);
      expect(c).toMatchObject({ review_ready: true, best_step: 3 });
    });

    it("never lowers a step for missed days", async () => {
      await db.raw("update memory.cards set step = 4, due_on = current_date - 40, last_scheduled_on = current_date - 47 where id = $1", [card]);
      const r = await review(await typedSession(m4, card, exact));
      expect(r).toMatchObject({ change: "advanced", step: 5 });
      expect(r.due_on).toBe(await todayIn("America/New_York", 14));
    });

    it("uses the member's own calendar when their time zone changes", async () => {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
        await rpc(as(m4), "memory_settings_save", [j({ timezone: zone })]);
        const q = await rpc<Json>(as(m4), "memory_review_queue");
        expect(q).toMatchObject({ timezone: zone, today: await todayIn(zone) });
      }
      // Due dates are calendar dates: a reviewed verse due "tomorrow" stays tomorrow's.
      const [{ d }] = await db.raw<{ d: string }>("select ('2026-03-07'::date + 1)::text d");
      expect(d).toBe("2026-03-08"); // across the US spring-forward weekend
      await rpc(as(m4), "memory_settings_save", [j({ timezone: "America/New_York" })]);
    });

    it("moves a new verse to learning after a strong learning activity, but no further", async () => {
      const c2 = await addCard(m4, { translation_id: web, ...P("GEN", 1, 4) });
      const s = await start(m4, c2, "word_order", "guided");
      const chips = (s.setup as { chips: Array<{ id: string; text: string }> }).chips;
      const ordered = [...chips].sort((a, b) => "God saw the light, and saw that it was good. God divided the light from the darkness.".indexOf(a.text) - "God saw the light, and saw that it was good. God divided the light from the darkness.".indexOf(b.text));
      const r = await review(await submit(m4, s.id as string, { order: ordered.map((c) => c.id) }));
      expect(r).toMatchObject({ change: "advanced", step: 1 });
    });
  });

  describe("progress and badges", () => {
    it("awards badges once, from the server's own records", async () => {
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.awards where profile_id = $1 and badge_key = 'first_steps'", [m1]);
      expect(n).toBe(1);
      const p = await rpc<Json>(as(m1), "memory_progress");
      const first = (p.badges as Json[]).find((b) => b.key === "first_steps")!;
      expect(first).toMatchObject({ earned: true, times: 1 });
      expect((p.badges as Json[]).find((b) => b.key === "faithful_fifty")).toMatchObject({ earned: false });
    });

    it("awards Explorer after all six activities", async () => {
      const p = await rpc<Json>(as(m1), "memory_progress");
      const used = Object.keys(p.activities as Json);
      expect(used.sort()).toEqual(["flashcards", "missing_words", "read_repeat", "self_check", "type_verse"]);
      const c17 = (await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: web, ...P("JHN", 3, 15) })])).id as string;
      const s = await start(m1, c17, "word_order", "growing");
      const chips = (s.setup as { chips: Array<{ id: string }> }).chips;
      const r = await submit(m1, s.id as string, { order: chips.map((c) => c.id) });
      expect((r.badges as Json[]).map((b) => b.key)).toContain("explorer");
      const again = await start(m1, c17, "word_order", "growing");
      const r2 = await submit(m1, again.id as string, { order: (again.setup as { chips: Array<{ id: string }> }).chips.map((c) => c.id) });
      expect((r2.badges as Json[]).map((b) => b.key)).not.toContain("explorer");
    });

    it("explains progress with separate measures and no mastery claim", async () => {
      const p = await rpc<Json>(as(m1), "memory_progress");
      expect(p).toHaveProperty("verses_practiced");
      expect(p).toHaveProperty("review_ready");
      expect(p).toHaveProperty("days_28");
      expect(JSON.stringify(p)).not.toMatch(/master/i);
    });
  });

  describe("privacy", () => {
    it("keeps results owner-only: not administrators, staff, leaders, or household members", async () => {
      const mine = ((await rpc<Json>(as(m1), "memory_cards")).active as Json[])[0].id;
      for (const who of [m2 /* household */, admin, publisher, editor, leader]) {
        await fails(as(who), "memory_card", [mine], /not found/);
        await fails(as(who), "memory_card_remove", [mine, "delete", "delete"], /not found/);
        expect(((await rpc<Json>(as(who), "memory_cards")).active as Json[]).some((c) => c.id === mine)).toBe(false);
      }
      const adminView = JSON.stringify(await rpc(as(publisher), "memory_admin_collection", [church]));
      expect(adminView).not.toMatch(/"(accuracy|sessions|confidence|hints|step|due_on|best_step|attempts)"/);
    });

    it("exports the member's own data only", async () => {
      const e = await rpc<Json>(as(m1), "memory_export");
      const verses = e.verses as Json[];
      expect(verses.length).toBeGreaterThan(0);
      expect(verses.every((v) => Array.isArray(v.attempts))).toBe(true);
      // WEB doesn't allow export in this setup, so no scripture text is included.
      expect(verses.every((v) => v.text === null)).toBe(true);
    });
  });

  describe("challenges", () => {
    let challenge: string;
    let groupCollection: string;

    beforeAll(async () => {
      groupCollection = church; // members-wide collections may be used by a group
      const ch = await rpc<Json>(as(leader), "memory_admin_challenge_save", [null, j({
        group_id: group, collection_id: groupCollection, title: "Fall challenge", starts_on: await todayIn("America/Chicago", -3),
        ends_on: await todayIn("America/Chicago", 20), goal_sessions: 20, min_participants: 3,
      })]);
      challenge = ch.id as string;
    });

    it("lets only publishers and authorized leaders of the group run challenges", async () => {
      await fails(as(otherLeader), "memory_admin_challenge_save", [null, j({ group_id: group, collection_id: church, title: "x", starts_on: "2026-01-01", ends_on: "2030-01-10", goal_sessions: 5 })], /permission/);
      await fails(as(m1), "memory_admin_challenge_save", [null, j({ group_id: group, collection_id: church, title: "x", starts_on: "2026-01-01", ends_on: "2030-01-10", goal_sessions: 5 })], /permission/);
      await fails(as(leader), "memory_admin_challenge_save", [null, j({ group_id: group, collection_id: church, title: "x", starts_on: await todayIn("America/Chicago"), ends_on: await todayIn("America/Chicago", 10), goal_sessions: 5, min_participants: 2 })], /at least 3/);
    });

    it("is visible only to the group and requires explicit opt-in", async () => {
      await fails(as(otherLeader), "memory_challenge", [challenge], /not found/);
      await fails(as(m1), "memory_challenge_join", [challenge, false], /confirm/);
      const c = await rpc<Json>(as(m1), "memory_challenge", [challenge]);
      expect(c.me).toBeNull();
      expect(c.aggregate).toMatchObject({ visible: false, min_participants: 3 });
    });

    it("hides totals until enough people share, then shows only rounded totals", async () => {
      await db.raw("delete from memory.attempts where profile_id = any($1)", [[m1, m2, m3]]);
      for (const who of [m1, m2]) await rpc(as(who), "memory_challenge_join", [challenge, true]);
      expect(((await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json).visible).toBe(false);
      await rpc(as(m3), "memory_challenge_join", [challenge, true]);
      // Practice before joining doesn't count; practice "yesterday" since joining does.
      for (const who of [m1, m2, m3]) {
        const card = await addCard(who, { item_id: john });
        for (let i = 0; i < 4; i++) {
          const s = await start(who, card, "read_repeat");
          await submit(who, s.id as string, { level: 1 });
        }
      }
      await db.raw("update memory.attempts set local_date = local_date - 1 where profile_id = any($1)", [[m1, m2, m3]]);
      const agg = (await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json;
      expect(agg).toMatchObject({ visible: true, participants: 3, sessions: 10, goal: 20, percent: 50 });
      expect(JSON.stringify(await rpc(as(m1), "memory_challenge", [challenge]))).not.toMatch(/Alpha|Bravo|Charlie|accuracy/);
      // Leaders see the same totals, never people.
      expect(((await rpc<Json>(as(leader), "memory_admin_challenges")) as unknown as Json[])[0].aggregate).toEqual(agg);
    });

    it("removes contributions on revoking sharing or leaving, and on losing the group", async () => {
      await rpc(as(m3), "memory_challenge_sharing", [challenge, false]);
      expect(((await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json).visible).toBe(false);
      await rpc(as(m3), "memory_challenge_sharing", [challenge, true]);
      // Resuming counts only from now.
      expect(((await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json).sessions).toBe(5);
      await rpc(as(m4), "memory_challenge_join", [challenge, true]);
      await db.raw("update community.group_members set state = 'left', ended_at = now() where group_id = $1 and profile_id = $2", [group, m4]);
      const [{ left }] = await db.raw<{ left: boolean }>("select left_at is not null as left from memory.challenge_participants where challenge_id = $1 and profile_id = $2", [challenge, m4]);
      expect(left).toBe(true);
      await fails(as(m4), "memory_challenge", [challenge], /not found/);
      await db.raw("update community.group_members set state = 'active', ended_at = null where group_id = $1 and profile_id = $2", [group, m4]);
      await rpc(as(m2), "memory_challenge_leave", [challenge]);
      expect(((await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json).visible).toBe(false);
      await rpc(as(m2), "memory_challenge_join", [challenge, true]);
    });

    it("ends participation on suspension; reinstated members choose again", async () => {
      await db.setStatus(m2, "suspended");
      expect(((await rpc<Json>(as(m1), "memory_challenge", [challenge])).aggregate as Json).visible).toBe(false);
      await db.setStatus(m2, "approved");
      expect(((await rpc<Json>(as(m2), "memory_challenge", [challenge])).me as Json).joined).toBe(false);
      await rpc(as(m2), "memory_challenge_join", [challenge, true]);
    });
  });

  describe("text versions", () => {
    it("asks for an explicit decision when the source text changes and keeps earlier results", async () => {
      const card = await addCard(m3, { translation_id: web, ...P("JHN", 3, 18) });
      await typedSession(m3, card, "He who believes in him is not judged.");
      // A reviewed re-import changes the wording of John 3:18.
      await db.raw("update bible.verses set text = text || ' (revised)' where translation_id = $1 and book_code = 'JHN' and chapter = 3 and verse = 18", [web]);
      await db.raw("update bible.translations set text_version = text_version + 1 where id = $1", [web]);
      const before = await rpc<Json>(as(m3), "memory_card", [card]);
      expect(before.update_available).toMatchObject({ source: "bible" });
      const fresh = await rpc<Json>(as(m3), "memory_card_switch_version", [card]);
      expect(fresh).toMatchObject({ step: 0, sessions: 0, previous_card_id: card });
      expect((fresh.passage as Json).version).toBe(2);
      const old = await rpc<Json>(as(m3), "memory_card", [card]);
      expect(old.status).toBe("superseded");
      expect((old.history as Json[]).length).toBe(1);
      await fails(as(m3), "memory_card_switch_version", [fresh.id], /current text/);
    });

    it("updates a collection verse with a reason; members decide when to switch", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Versioned", translation_id: web }), null]);
      const item = await rpc<Json>(as(publisher), "memory_admin_item_add", [c.id, j(P("JHN", 3, 15))]);
      await rpc(as(publisher), "memory_admin_collection_status", [c.id, "publish", null]);
      const card = await addCard(m5, { item_id: item.id });
      await fails(as(publisher), "memory_admin_item_update_text", [item.id, "No change"], /already uses/);
      await db.raw("update bible.verses set text = text || ' (revised)' where translation_id = $1 and book_code = 'JHN' and chapter = 3 and verse = 15", [web]);
      await fails(as(editor), "memory_admin_item_update_text", [item.id, "Corrected source text"], /publisher/);
      await rpc(as(publisher), "memory_admin_item_update_text", [item.id, "The church corrected this verse's source text."]);
      const k = await rpc<Json>(as(m5), "memory_card", [card]);
      expect(k.update_available).toMatchObject({ source: "collection", reason: "The church corrected this verse's source text." });
      // Practice continues on the earlier text until the member chooses.
      const s = await start(m5, card, "read_repeat");
      expect(JSON.stringify(s.setup)).not.toContain("(revised)");
      const n = await rpc<Json>(as(m5), "memory_card_switch_version", [card]);
      const full = await rpc<Json>(as(m5), "memory_card", [n.id]);
      expect(((full.passage as Json).verses as Json[])[0].t).toContain("(revised)");
    });
  });

  describe("removal and deletion", () => {
    it("removes (keeping history), restores, and deletes one verse without touching scripture", async () => {
      const card = await addCard(m2, { translation_id: web, ...P("GEN", 1, 2) });
      await typedSession(m2, card, "The earth was formless");
      await rpc(as(m2), "memory_card_remove", [card, "remove", null]);
      expect(((await rpc<Json>(as(m2), "memory_cards")).removed as Json[]).some((c) => c.id === card)).toBe(true);
      await rpc(as(m2), "memory_card_remove", [card, "restore", null]);
      await fails(as(m2), "memory_card_remove", [card, "delete", null], /Confirm/);
      const [{ passage }] = await db.raw<{ passage: string }>("select passage_id passage from memory.cards where id = $1", [card]);
      await rpc(as(m2), "memory_card_remove", [card, "delete", "delete"]);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where card_id = $1", [card]);
      expect(n).toBe(0);
      const [{ p }] = await db.raw<{ p: number }>("select count(*)::int p from memory.passages where id = $1", [passage]);
      expect(p).toBe(1);
    });

    it("deletes all practice history only with the typed confirmation", async () => {
      await fails(as(m2), "memory_history_delete", ["yes", false], /confirmation/);
      await rpc(as(m2), "memory_history_delete", ["delete my practice history", true]);
      const [{ cards, awards, cols }] = await db.raw<{ cards: number; awards: number; cols: number }>(
        `select (select count(*)::int from memory.cards where profile_id = $1) cards,
                (select count(*)::int from memory.awards where profile_id = $1) awards,
                (select count(*)::int from memory.collections where owner_id = $1) cols`, [m2]);
      expect({ cards, awards, cols }).toEqual({ cards: 0, awards: 0, cols: 0 });
    });

    it("removes everything with the account", async () => {
      const id = await db.createAuthUser("mv.leaving@example.test", { fullName: "Leaving Member" });
      await db.setStatus(id, "approved");
      const card = await addCard(id, { translation_id: web, ...P("GEN", 1, 1) });
      await typedSession(id, card, "In the beginning");
      await db.raw("delete from auth.users where id = $1", [id]);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where profile_id = $1", [id]);
      expect(n).toBe(0);
    });
  });

  describe("reminders", () => {
    const tick = () => db.raw("select community.tick()");
    const memoryNotices = async (who: string) => ((await rpc<Json>(as(who), "community_notifications", [null, 50])).items as Json[]).filter((n) => n.category === "memory");
    const remindNow = async (who: string, extra: Json) => {
      const [{ t }] = await db.raw<{ t: string }>("select to_char((now() at time zone 'America/New_York') - interval '2 minutes', 'HH24:MI') t");
      await rpc(as(who), "memory_settings_save", [j({ timezone: "America/New_York", reminder_time: t, ...extra })]);
      await db.raw("update memory.member_settings set last_weekly_on = null, last_review_on = null, last_practice_on = null where profile_id = $1", [who]);
    };

    it("sends nothing unless the member asked", async () => {
      await tick();
      expect(await memoryNotices(m5)).toEqual([]);
    });

    it("sends one review reminder a day with generic email text", async () => {
      await remindNow(m5, { remind_review: true });
      await db.raw("update memory.cards set due_on = current_date - 1 where profile_id = $1 and status = 'active'", [m5]);
      await tick();
      await tick();
      const mine = await memoryNotices(m5);
      expect(mine.map((n) => n.kind)).toEqual(["memory_review_due"]);
      const [{ item }] = await db.raw<{ item: Json }>("select community.notification_email_item(n) item from community.notifications n where n.id = $1", [mine[0].id]);
      expect(item.title).toBe("You have memory verses ready to review");
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from community.email_outbox where notification_id = $1", [mine[0].id]);
      expect(n).toBe(1);
    });

    it("holds reminders while paused and drops them on suspension", async () => {
      await rpc(as(m5), "memory_settings_save", [j({ paused: true })]);
      expect(await memoryNotices(m5)).toEqual([]); // rechecked on read
      await rpc(as(m5), "memory_settings_save", [j({ paused: false })]);
      expect((await memoryNotices(m5)).length).toBe(1);
      await db.setStatus(m5, "suspended");
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from community.notifications where profile_id = $1 and category = 'memory' and read_at is null", [m5]);
      expect(n).toBe(0);
      await db.setStatus(m5, "approved");
    });

    it("announces a new weekly verse once", async () => {
      await remindNow(m3, { remind_weekly: true });
      await db.raw("update memory.member_settings set last_weekly_on = current_date - 3 where profile_id = $1", [m3]);
      await tick();
      await tick();
      const mine = (await memoryNotices(m3)).filter((n) => n.kind === "memory_weekly_verse");
      expect(mine.length).toBe(1);
      expect(mine[0].title).toMatch(/^A new memory verse is ready: John 3:16–17$/);
      const [{ item }] = await db.raw<{ item: Json }>("select community.notification_email_item(n) item from community.notifications n where n.id = $1", [mine[0].id]);
      expect(item.title).toBe("A new memory verse is ready");
    });

    it("announces challenge milestones once, only to sharing participants who asked", async () => {
      await rpc(as(m1), "memory_settings_save", [j({ remind_challenge: true })]);
      // m1 practices the challenge's verse (counted from yesterday).
      const card = await addCard(m1, { item_id: john });
      for (let i = 0; i < 6; i++) {
        const s = await start(m1, card, "read_repeat");
        await submit(m1, s.id as string, { level: 1 });
      }
      await db.raw("update memory.attempts set local_date = local_date - 1 where profile_id = $1 and local_date = (now() at time zone 'America/New_York')::date", [m1]);
      await tick();
      await tick();
      const m1n = (await memoryNotices(m1)).filter((n) => n.kind === "memory_challenge_milestone");
      expect(m1n.length).toBeGreaterThan(0);
      expect(new Set(m1n.map((n) => n.title)).size).toBe(m1n.length);
      expect((await memoryNotices(m3)).filter((n) => n.kind === "memory_challenge_milestone")).toEqual([]);
    });

    it("never repeats across two overlapping scheduler runs", async () => {
      await remindNow(m4, { remind_practice: true });
      await db.raw("delete from memory.attempts where profile_id = $1 and local_date >= current_date - 1", [m4]);
      const [a, b] = [await db.connect(), await db.connect()];
      await Promise.all([a.query("select community.tick()"), b.query("select community.tick()")]);
      await a.end();
      await b.end();
      await tick();
      expect((await memoryNotices(m4)).filter((n) => n.kind === "memory_practice_reminder").length).toBe(1);
    });
  });

  /** Today's date in a time zone (with an optional day offset), from the database clock. */
  async function todayIn(zone: string, offset = 0): Promise<string> {
    const [{ d }] = await db.raw<{ d: string }>("select ((now() at time zone $1)::date + $2::int)::text d", [zone, offset]);
    return d;
  }
});
