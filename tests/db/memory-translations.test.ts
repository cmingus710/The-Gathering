import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Memory verse translation preferences (20261105000100) against a real
 * database: the member's default memory translation (its fallbacks, and
 * that changing it touches no existing verse), a translation per verse,
 * practice and scoring in the card's own wording, explicit translation
 * changes (history, awards, mastery, the daily limit), assignments that
 * require a version or let members choose, challenge credit, unavailable
 * text without substitution, verse numbering that differs between versions,
 * and existing cards kept exactly as they were by the migration.
 *
 * WEB comes from tests/fixtures/bible/web-sample.csv; KJV verses are the
 * public-domain King James text; SPARSE is a synthetic stored version with
 * a single verse. Every person is synthetic.
 */
type Json = Record<string, unknown>;
const MIGRATION = "20261105000100_memory_translation_preferences.sql";
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const WEB_3_16 = "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.";
const KJV: Array<[string, number, number, string]> = [
  ["GEN", 1, 1, "In the beginning God created the heaven and the earth."],
  ["JHN", 3, 16, "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."],
  ["JHN", 3, 17, "For God sent not his Son into the world to condemn the world; but that the world through him might be saved."],
  ["ACT", 8, 36, "And as they went on their way, they came unto a certain water: and the eunuch said, See, here is water; what doth hinder me to be baptized?"],
  ["ACT", 8, 37, "And Philip said, If thou believest with all thine heart, thou mayest. And he answered and said, I believe that Jesus Christ is the Son of God."],
  ["ACT", 8, 38, "And he commanded the chariot to stand still: and they went down both into the water, both Philip and the eunuch; and he baptized him."],
];
const KJV_3_16 = KJV[1][3];

async function loadWeb(db: TestDb) {
  const web = (await db.raw<{ id: string }>(
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
  return web;
}

async function stored(db: TestDb, code: string, name: string, verses: Array<[string, number, number, string]>) {
  const id = (await db.raw<{ id: string }>(
    `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
     values ($1, $2, $2 || ' (' || $1 || '), public domain.', 'Public domain', 'public_domain', now(), 'draft', 1) returning id`,
    [code, name],
  ))[0].id;
  for (const [b, c, v, t] of verses) {
    await db.raw("insert into bible.verses (translation_id, book_code, chapter, verse, text) values ($1,$2,$3,$4,$5)", [id, b, c, v, t]);
  }
  await db.raw("update bible.translations set verse_count = $2, status = 'active' where id = $1", [id, verses.length]);
  return id;
}

function helpers(getDb: () => TestDb) {
  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await getDb().query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message: RegExp) => {
    await expect(rpc(actor, fn, args)).rejects.toThrow(message);
  };
  const j = (v: unknown) => JSON.stringify(v);
  const P = (book: string, sc: number, sv: number, ec = sc, ev = sv) => ({ book, sc, sv, ec, ev });
  const mk = async (email: string) => {
    const id = await getDb().createAuthUser(email, { fullName: email.split("@")[0] });
    await getDb().setStatus(id, "approved");
    return id;
  };
  return { rpc, fails, j, P, mk };
}

describeDb("Memory verse translation preferences", () => {
  let db: TestDb;
  const { rpc, fails, j, P, mk } = helpers(() => db);
  let admin: string;
  let publisher: string;
  let leader: string; // leads `group`
  let m1: string;
  let m2: string;
  let m3: string;
  let m4: string;
  let group: string;
  let web: string;
  let kjv: string;
  let sparse: string;
  let api: string;
  let required: string; // church collection, WEB required
  let requiredItem: string; // John 3:16
  let choice: string; // church collection, members may choose
  let choiceItem: string; // John 3:16

  const card = (who: string, id: string) => rpc<Json>(as(who), "memory_card", [id]);
  const addCard = async (who: string, p: Json) => (await rpc<Json>(as(who), "memory_card_add", [j(p)])).id as string;
  const start = (who: string, id: string, activity: string, difficulty = "guided") =>
    rpc<Json>(as(who), "memory_session_start", [id, activity, difficulty, 0, "{}"]);
  const submit = (who: string, session: string, payload: Json) => rpc<Json>(as(who), "memory_session_submit", [session, j(payload)]);
  const passageOf = (c: Json) => c.passage as { id: string; translation: { code: string }; verses: Array<{ t: string }>; version: number };
  const tokensOf = async (session: string) =>
    (await db.raw<{ tokens: Array<{ t: string }> }>("select p.tokens from memory.sessions x join memory.passages p on p.id = x.passage_id where x.id = $1", [session]))[0].tokens;

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await mk("mt.admin@example.test");
    publisher = await mk("mt.publisher@example.test");
    leader = await mk("mt.leader@example.test");
    m1 = await mk("mt.m1@example.test");
    m2 = await mk("mt.m2@example.test");
    m3 = await mk("mt.m3@example.test");
    m4 = await mk("mt.m4@example.test");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(publisher, "memory_verse_publisher");
    group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Translation Group", summary: "s", about: "a", visibility: "discoverable", leader_id: leader })]);
    for (const id of [m1, m2, m3, m4]) await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    web = await loadWeb(db);
    kjv = await stored(db, "KJV", "King James Version", KJV);
    sparse = await stored(db, "SPARSE", "Synthetic Sparse Version", [["GEN", 1, 1, "In the beginning."]]);
    api = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status)
       values ('APIX', 'Licensed API version', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), 'active') returning id`,
    ))[0].id;

    required = ((await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Required WEB", translation_id: web }), null])).id) as string;
    requiredItem = ((await rpc<Json>(as(publisher), "memory_admin_item_add", [required, j(P("JHN", 3, 16))])).id) as string;
    await rpc(as(publisher), "memory_admin_collection_status", [required, "publish", null]);
    choice = ((await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Your version", translation_id: web, translation_choice: true }), null])).id) as string;
    choiceItem = ((await rpc<Json>(as(publisher), "memory_admin_item_add", [choice, j(P("JHN", 3, 16, 3, 17))])).id) as string;
    await rpc(as(publisher), "memory_admin_collection_status", [choice, "publish", null]);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("default memory verse translation", () => {
    it("offers only versions that can be memorized", async () => {
      const t = await rpc<Json>(as(m1), "memory_translations");
      const codes = (t.items as Json[]).map((x) => x.code);
      expect(codes).toEqual(expect.arrayContaining(["WEB", "KJV", "SPARSE"]));
      expect(codes).not.toContain("APIX");
      expect(codes[0]).toBe("WEB"); // the church's version first
      await fails(as(m1), "memory_settings_save", [j({ default_translation_id: api })], /available for memory practice/);
    });

    it("falls back to the Bible reading version, then the church's", async () => {
      expect((await rpc<Json>(as(m1), "memory_settings")).effective_translation).toMatchObject({ code: "WEB", source: "church" });
      await db.raw("insert into bible.reader_prefs (profile_id, translation_id) values ($1, $2)", [m1, kjv]);
      const s = await rpc<Json>(as(m1), "memory_settings");
      expect(s.default_translation_id).toBeNull();
      expect(s.effective_translation).toMatchObject({ code: "KJV", source: "reading" });
      // A reading version that can't be memorized is skipped.
      await db.raw("update bible.reader_prefs set translation_id = $2 where profile_id = $1", [m1, api]);
      expect((await rpc<Json>(as(m1), "memory_settings")).effective_translation).toMatchObject({ code: "WEB", source: "church" });
      await db.raw("update bible.reader_prefs set translation_id = $2 where profile_id = $1", [m1, kjv]);
    });

    it("saves to the account (every device and session) independently of the reading version", async () => {
      await rpc(as(m1), "memory_settings_save", [j({ default_translation_id: web })]);
      // Another "device": a fresh call reads the stored preference.
      const s = await rpc<Json>(as(m1), "memory_settings");
      expect(s).toMatchObject({ default_translation_id: web, default_translation_available: true });
      expect(s.effective_translation).toMatchObject({ code: "WEB", source: "memory" });
      // Saving other settings keeps it; the reading version is untouched.
      await rpc(as(m1), "memory_settings_save", [j({ difficulty: "growing" })]);
      expect((await rpc<Json>(as(m1), "memory_settings")).default_translation_id).toBe(web);
      expect((await db.raw<{ t: string }>("select translation_id t from bible.reader_prefs where profile_id = $1", [m1]))[0].t).toBe(kjv);
      // Clearing it follows the reading version again.
      await rpc(as(m1), "memory_settings_save", [j({ default_translation_id: "" })]);
      expect((await rpc<Json>(as(m1), "memory_settings")).effective_translation).toMatchObject({ code: "KJV", source: "reading" });
    });

    it("starts new personal verses in the default, and a per-verse choice affects only that verse", async () => {
      await rpc(as(m2), "memory_settings_save", [j({ default_translation_id: kjv })]);
      const a = await card(m2, await addCard(m2, P("GEN", 1, 1)));
      expect(passageOf(a).translation.code).toBe("KJV");
      expect(passageOf(a).verses[0].t).toBe(KJV[0][3]);
      const b = await card(m2, await addCard(m2, { translation_id: web, ...P("JHN", 3, 16) }));
      expect(passageOf(b).translation.code).toBe("WEB");
      expect(passageOf(b).verses[0].t).toBe(WEB_3_16);
      expect(passageOf(await card(m2, a.id as string)).translation.code).toBe("KJV");
    });

    it("never changes existing verses when the default changes", async () => {
      const before = (await rpc<Json>(as(m2), "memory_cards")).active as Json[];
      await rpc(as(m2), "memory_settings_save", [j({ default_translation_id: web })]);
      await rpc(as(m2), "memory_settings_save", [j({ default_translation_id: "" })]);
      const after = (await rpc<Json>(as(m2), "memory_cards")).active as Json[];
      expect(after.map((c) => [c.id, passageOf(c).id, passageOf(c).translation.code])).toEqual(before.map((c) => [c.id, passageOf(c).id, passageOf(c).translation.code]));
    });
  });

  describe("practice and scoring use the card's own wording", () => {
    let kcard: string;
    beforeAll(async () => {
      await rpc(as(m3), "memory_settings_save", [j({ default_translation_id: web })]);
      kcard = await addCard(m3, { translation_id: kjv, ...P("JHN", 3, 16) });
      // Changing the default afterwards must not leak into practice.
      await rpc(as(m3), "memory_settings_save", [j({ default_translation_id: web })]);
    });

    it("read & repeat and flashcards show the card's text and version", async () => {
      const r = await start(m3, kcard, "read_repeat");
      expect((r.translation as Json).code).toBe("KJV");
      expect(((r.setup as Json).tokens as Json[]).map((t) => t.t).join(" ")).toBe(KJV_3_16);
      await submit(m3, r.id as string, { level: 1 });
      const f = await start(m3, kcard, "flashcards");
      expect((await rpc<Json>(as(m3), "memory_session_reveal", [f.id])).text).toBe(KJV_3_16);
      await submit(m3, f.id as string, { confidence: "mostly" });
    });

    it("missing words and word order are built from and scored against that text", async () => {
      const s = await start(m3, kcard, "missing_words");
      const [{ setup: hidden }] = await db.raw<{ setup: { blanks: number[] } }>("select setup from memory.sessions where id = $1", [s.id]);
      const tokens = await tokensOf(s.id as string);
      expect(tokens.map((t) => t.t).join(" ")).toBe(KJV_3_16);
      const answers = Object.fromEntries(hidden.blanks.map((i) => [String(i), tokens[i].t.replace(/[^\p{L}\p{N}’']/gu, "")]));
      expect(await submit(m3, s.id as string, { answers })).toMatchObject({ accuracy: 1 });

      const w = await start(m3, kcard, "word_order", "challenge");
      const chips = (w.setup as { chips: Array<{ id: string; text: string }> }).chips;
      expect(chips.map((c) => c.text).join(" ")).toContain("begotten");
      // The correct order, from the server's hidden setup.
      const [{ hiddenChips }] = await db.raw<{ hiddenChips: Array<{ id: string; from: number }> }>("select setup -> 'chips' as \"hiddenChips\" from memory.sessions where id = $1", [w.id]);
      const order = [...hiddenChips].sort((a, b) => a.from - b.from).map((c) => c.id);
      expect(order.map((id) => chips.find((c) => c.id === id)!.text).join(" ")).toBe(KJV_3_16);
      expect(await submit(m3, w.id as string, { order })).toMatchObject({ accuracy: 1 });
    });

    it("typed recall accepts the card's wording and not the default version's", async () => {
      const ok = await start(m3, kcard, "type_verse", "growing");
      expect(await submit(m3, ok.id as string, { text: KJV_3_16 })).toMatchObject({ accuracy: 1 });
      const other = await start(m3, kcard, "type_verse", "growing");
      const r = await submit(m3, other.id as string, { text: WEB_3_16 });
      expect(r.accuracy as number).toBeLessThan(1);
      expect(((r.details as Json).text as string)).toBe(KJV_3_16);
    });

    it("self-check reveals the card's text, and history names the version", async () => {
      const s = await start(m3, kcard, "self_check");
      expect((await rpc<Json>(as(m3), "memory_session_reveal", [s.id])).text).toBe(KJV_3_16);
      await submit(m3, s.id as string, { confidence: "fully" });
      const history = (await card(m3, kcard)).history as Json[];
      expect(history.length).toBeGreaterThanOrEqual(6);
      expect(history.every((h) => h.translation === "KJV" && h.text_version === 1)).toBe(true);
    });
  });

  describe("changing a verse's translation", () => {
    let from: string;
    let openSession: string;
    beforeAll(async () => {
      from = await addCard(m4, { translation_id: web, ...P("JHN", 3, 16) });
      for (let i = 0; i < 2; i++) {
        const s = await start(m4, from, "type_verse", "growing");
        await submit(m4, s.id as string, { text: WEB_3_16 });
      }
      await db.raw("update memory.cards set step = 3, best_step = 3 where id = $1", [from]);
      openSession = (await start(m4, from, "self_check")).id as string;
    });

    it("previews the exact replacement text and its effect, saving nothing", async () => {
      const p = await rpc<Json>(as(m4), "memory_card_translation_preview", [from, kjv]);
      expect(p).toMatchObject({ ok: true, label: "John 3:16", only_current: [], only_new: [] });
      expect((p.translation as Json).code).toBe("KJV");
      expect((p.verses as Json[])[0].t).toBe(KJV_3_16);
      expect(((p.current as Json).verses as Json[])[0].t).toBe(WEB_3_16);
      expect(p.effects).toMatchObject({ sessions: 2, review_ready: true, restores: null });
      const c = await card(m4, from);
      expect(c.status).toBe("active");
      expect(passageOf(c).translation.code).toBe("WEB");
    });

    it("requires confirmation", async () => {
      await fails(as(m4), "memory_card_change_translation", [from, kjv, false], /Confirm/);
    });

    it("keeps history and awards, starts the new wording fresh, and keeps the daily limit", async () => {
      const awards = await db.raw("select badge_key, scope from memory.awards where profile_id = $1 order by 1, 2", [m4]);
      const [{ scheduled }] = await db.raw<{ scheduled: string | null }>("select last_scheduled_on::text scheduled from memory.cards where id = $1", [from]);
      const n = await rpc<Json>(as(m4), "memory_card_change_translation", [from, kjv, true]);
      expect(n.id).not.toBe(from);
      expect(n).toMatchObject({ status: "active", step: 0, sessions: 0, review_ready: false, previous_card_id: from });
      expect(passageOf(n).translation.code).toBe("KJV");
      const old = await card(m4, from);
      expect(old.status).toBe("superseded");
      expect((old.history as Json[]).length).toBe(2);
      expect((old.history as Json[]).every((h) => h.translation === "WEB")).toBe(true);
      expect(await db.raw("select badge_key, scope from memory.awards where profile_id = $1 order by 1, 2", [m4])).toEqual(awards);
      const [{ s2 }] = await db.raw<{ s2: string | null }>("select last_scheduled_on::text s2 from memory.cards where id = $1", [n.id]);
      expect(s2).toBe(scheduled);
      // A session started on the earlier text is never scored against the new one.
      expect(await submit(m4, openSession, { confidence: "fully" })).toEqual({ status: "conflict", saved: false });
      const detail = await card(m4, n.id as string);
      expect((detail.earlier as Json[]).map((e) => [e.id, e.translation, e.status])).toEqual([[from, "WEB", "superseded"]]);
    });

    it("switching back restores the earlier wording's own progress", async () => {
      const current = ((await rpc<Json>(as(m4), "memory_cards")).active as Json[]).find((c) => passageOf(c).translation.code === "KJV")!;
      const p = await rpc<Json>(as(m4), "memory_card_translation_preview", [current.id, web]);
      expect((p.effects as Json).restores).toMatchObject({ id: from, sessions: 2, review_ready: true });
      const back = await rpc<Json>(as(m4), "memory_card_change_translation", [current.id, web, true]);
      expect(back).toMatchObject({ id: from, status: "active", sessions: 2, review_ready: true });
      expect((await card(m4, current.id as string)).status).toBe("superseded");
    });

    it("reports text a version doesn't have and never substitutes another", async () => {
      const p = await rpc<Json>(as(m4), "memory_card_translation_preview", [from, sparse]);
      expect(p).toMatchObject({ ok: false });
      expect(p.problem).toMatch(/doesn't exist in this translation/);
      await fails(as(m4), "memory_card_change_translation", [from, sparse, true], /doesn't exist in this translation/);
      expect((await card(m4, from)).status).toBe("active");
      expect(passageOf(await card(m4, from)).translation.code).toBe("WEB");
      await fails(as(m4), "memory_card_add", [j({ translation_id: sparse, ...P("JHN", 3, 16) })], /doesn't exist in this translation/);
      // A verse the version leaves out of an existing chapter.
      expect((await rpc<Json>(as(m4), "memory_passage_preview", [sparse, j(P("GEN", 1, 2))])).problem).toMatch(/doesn't exist|no text/);
      await fails(as(m4), "memory_card_change_translation", [from, api, true], /outside service/);
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.passages p join bible.translations t on t.id = p.translation_id where t.code = 'SPARSE'");
      expect(n).toBe(0);
    });

    it("refuses a version the member already practices this verse in", async () => {
      await addCard(m4, { translation_id: kjv, ...P("JHN", 3, 17) });
      const other = await addCard(m4, { translation_id: web, ...P("JHN", 3, 17) });
      await fails(as(m4), "memory_card_change_translation", [other, kjv, true], /already practicing this verse in KJV/);
    });

    it("shows verses the two versions include or number differently", async () => {
      const acts = await addCard(m4, { translation_id: web, ...P("ACT", 8, 36, 8, 38) });
      expect(passageOf(await card(m4, acts)).verses.length).toBe(2); // WEB leaves out 8:37
      const p = await rpc<Json>(as(m4), "memory_card_translation_preview", [acts, kjv]);
      expect(p).toMatchObject({ ok: true, only_current: [], only_new: ["8:37"] });
    });

    it("counts a verse once for badges, whatever versions it was practiced in", async () => {
      // Four review-ready references plus the same reference in two versions.
      const ids: string[] = [];
      for (const [b, c, v] of [["GEN", 1, 2], ["GEN", 1, 3], ["GEN", 1, 4]] as const) ids.push(await addCard(m4, { translation_id: web, ...P(b, c, v) }));
      await db.raw("update memory.cards set best_step = 3 where profile_id = $1 and passage_id in (select id from memory.passages where memory.passage_ref(passages) like 'JHN.3.16%' or memory.passage_ref(passages) like 'GEN.1.%')", [m4]);
      const [{ refs }] = await db.raw<{ refs: number }>(
        "select count(distinct memory.passage_ref(p))::int refs from memory.cards c join memory.passages p on p.id = c.passage_id where c.profile_id = $1 and c.best_step >= 3", [m4]);
      expect(refs).toBe(4);
      const s = await start(m4, ids[0], "read_repeat");
      const r = await submit(m4, s.id as string, { level: 1 });
      expect((r.badges as Json[]).map((b) => b.key)).not.toContain("treasured_five");
    });
  });

  describe("assignments", () => {
    it("keeps a required version and says so", async () => {
      await fails(as(m1), "memory_card_add", [j({ item_id: requiredItem, translation_id: kjv })], /assigned in WEB/);
      const c = await card(m1, await addCard(m1, { item_id: requiredItem }));
      expect(passageOf(c).translation.code).toBe("WEB");
      expect(c).toMatchObject({ can_change_translation: false, assignment: { choice: false, own_translation: false, translation: { code: "WEB" } } });
      expect((await rpc<Json>(as(m1), "memory_card_translation_preview", [c.id, kjv])).problem).toMatch(/assigned in WEB/);
      await fails(as(m1), "memory_card_change_translation", [c.id, kjv, true], /assigned in WEB/);
    });

    it("lets members choose their version without changing the shared assignment", async () => {
      const c = await card(m1, await addCard(m1, { item_id: choiceItem, translation_id: kjv }));
      expect(passageOf(c).translation.code).toBe("KJV");
      expect(c).toMatchObject({ can_change_translation: true, update_available: null, assignment: { choice: true, own_translation: true } });
      expect((c.item as Json).id).toBe(choiceItem);
      // Everyone else still gets the church's version.
      const other = await card(m2, await addCard(m2, { item_id: choiceItem }));
      expect(passageOf(other).translation.code).toBe("WEB");
      const shared = await rpc<Json>(as(m2), "memory_collection", [choice]);
      expect(shared).toMatchObject({ translation_choice: true, translation: { code: "WEB" } });
      expect(((shared.items as Json[])[0].passage as Json).translation).toMatchObject({ code: "WEB" });
      // The member's own entry shows their card in their version.
      const mine = await rpc<Json>(as(m1), "memory_collection", [choice]);
      expect(((mine.items as Json[])[0].card as Json)).toMatchObject({ id: c.id, current_version: true, translation: { code: "KJV" } });
      // One card per assigned verse.
      await fails(as(m1), "memory_card_add", [j({ item_id: choiceItem, translation_id: web })], /already practicing this verse in KJV/);
      expect(await addCard(m1, { item_id: choiceItem, translation_id: kjv })).toBe(c.id);
      // Changing it later keeps the assignment link.
      const n = await rpc<Json>(as(m1), "memory_card_change_translation", [c.id, web, true]);
      expect((n.item as Json).id).toBe(choiceItem);
      expect(n.assignment).toMatchObject({ own_translation: false });
    });

    it("lets a published collection start allowing a choice but never stop", async () => {
      await rpc(as(publisher), "memory_admin_collection_save", [required, j({ title: "Required WEB", translation_choice: true })]);
      await fails(as(publisher), "memory_admin_collection_save", [required, j({ title: "Required WEB", translation_choice: false })], /can't be turned off/);
      const draft = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Draft", translation_id: web, translation_choice: true }), null]);
      expect((await rpc<Json>(as(publisher), "memory_admin_collection_save", [draft.id, j({ title: "Draft", translation_choice: false })])).translation_choice).toBe(false);
      // Restore the requirement for later tests (as a fresh duplicate would).
      await db.raw("update memory.collections set translation_choice = false where id = $1", [required]);
    });
  });

  describe("challenges", () => {
    const practiceYesterday = async (who: string, id: string, times: number) => {
      for (let i = 0; i < times; i++) await submit(who, (await start(who, id, "read_repeat")).id as string, { level: 1 });
      await db.raw("update memory.attempts set local_date = local_date - 1 where profile_id = $1 and card_id = $2", [who, id]);
    };
    const save = async (collection: string) =>
      (await rpc<Json>(as(publisher), "memory_admin_challenge_save", [null, j({
        group_id: group, collection_id: collection, title: "Translation challenge", starts_on: await shift(-3), ends_on: await shift(10), goal_sessions: 100, min_participants: 3,
      })])).id as string;
    const shift = async (d: number) => (await db.raw<{ d: string }>("select (((now() at time zone 'America/Chicago')::date) + $1::int)::text d", [d]))[0].d;
    const total = async (ch: string) => ((await rpc<Json>(as(m1), "memory_challenge", [ch])).aggregate as Json).sessions as number;

    it("counts practice in a member's own version when the collection allows it, once, and switching adds nothing", async () => {
      const ch = await save(choice);
      for (const who of [m1, m2, m3]) await rpc(as(who), "memory_challenge_join", [ch, true]);
      const k1 = ((await rpc<Json>(as(m1), "memory_cards")).active as Json[]).find((c) => (c.item as Json | null)?.id === choiceItem)!.id as string;
      // m1 practices in KJV, m2 in WEB, m3 in KJV.
      const k1kjv = (await rpc<Json>(as(m1), "memory_card_change_translation", [k1, kjv, true])).id as string;
      const k2 = ((await rpc<Json>(as(m2), "memory_cards")).active as Json[]).find((c) => (c.item as Json | null)?.id === choiceItem)!.id as string;
      const k3 = await addCard(m3, { item_id: choiceItem, translation_id: kjv });
      await practiceYesterday(m1, k1kjv, 4);
      await practiceYesterday(m2, k2, 3);
      await practiceYesterday(m3, k3, 3);
      expect(await total(ch)).toBe(10);
      // Switching translation (twice) creates no practice and no credit.
      const back = (await rpc<Json>(as(m1), "memory_card_change_translation", [k1kjv, web, true])).id as string;
      await rpc(as(m1), "memory_card_change_translation", [back, kjv, true]);
      expect(await total(ch)).toBe(10);
      for (const who of [m1, m2, m3]) await rpc(as(who), "memory_challenge_leave", [ch]);
    });

    it("counts only the required version when the collection requires one", async () => {
      const ch = await save(required);
      for (const who of [m1, m2, m3]) await rpc(as(who), "memory_challenge_join", [ch, true]);
      const own = await addCard(m3, { translation_id: kjv, ...P("JHN", 3, 16) });
      const assigned = await addCard(m2, { item_id: requiredItem });
      await practiceYesterday(m3, own, 5);
      await practiceYesterday(m2, assigned, 5);
      expect(await total(ch)).toBe(5);
    });
  });
});

describeDb("Memory translation migration keeps existing data", () => {
  let db: TestDb;
  const { rpc, j, P, mk } = helpers(() => db);

  beforeAll(async () => {
    db = await TestDb.create({ before: MIGRATION });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("adds the preference without relabeling, rewriting, or resetting anything", async () => {
    const web = await loadWeb(db);
    const member = await mk("mt.existing@example.test");
    const id = (await rpc<Json>(as(member), "memory_card_add", [j({ translation_id: web, ...P("JHN", 3, 16) })])).id as string;
    const s = await rpc<Json>(as(member), "memory_session_start", [id, "type_verse", "growing", 0, "{}"]);
    await rpc(as(member), "memory_session_submit", [s.id, j({ text: WEB_3_16 })]);
    await rpc(as(member), "memory_settings_save", [j({ difficulty: "challenge" })]);
    const snapshot = async () => ({
      cards: await db.raw("select id, passage_id, step, best_step, due_on, sessions, status from memory.cards order by id"),
      passages: await db.raw("select id, translation_id, ref_key, content_hash, verses from memory.passages order by id"),
      attempts: await db.raw("select id, passage_id, accuracy, quality from memory.attempts order by id"),
      awards: await db.raw("select profile_id, badge_key, scope from memory.awards order by 1, 2, 3"),
      settings: await db.raw("select profile_id, difficulty from memory.member_settings order by 1"),
      collections: await db.raw("select id, translation_id from memory.collections order by id"),
    });
    const before = await snapshot();

    // A KJV text appears later; the member reads in KJV. Nothing old moves.
    await db.applyMigrations({ from: MIGRATION });
    const kjv = await stored(db, "KJV", "King James Version", KJV);
    await db.raw("insert into bible.reader_prefs (profile_id, translation_id) values ($1, $2)", [member, kjv]);
    expect(await snapshot()).toEqual(before);
    const [{ dflt }] = await db.raw<{ dflt: string | null }>("select default_translation_id dflt from memory.member_settings where profile_id = $1", [member]);
    expect(dflt).toBeNull();
    const [{ choice }] = await db.raw<{ choice: boolean }>("select bool_or(translation_choice) choice from memory.collections");
    expect(choice ?? false).toBe(false);
    const c = await rpc<Json>(as(member), "memory_card", [id]);
    expect(c.passage).toMatchObject({ translation: { code: "WEB" }, verses: [expect.objectContaining({ t: WEB_3_16 })] });
    expect(c).toMatchObject({ sessions: 1, update_available: null });
    expect((c.history as Json[])[0]).toMatchObject({ translation: "WEB", text_version: 1, accuracy: 1 });
    // New verses now follow the reading version; the old one stays WEB.
    const n = await rpc<Json>(as(member), "memory_card_add", [j(P("GEN", 1, 1))]);
    expect((n.passage as Json).translation).toMatchObject({ code: "KJV" });
    expect(((await rpc<Json>(as(member), "memory_card", [id])).passage as Json).translation).toMatchObject({ code: "WEB" });
  });
});
