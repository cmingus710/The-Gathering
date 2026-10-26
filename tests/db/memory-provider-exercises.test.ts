import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Verse } from "@/lib/bible/types";
import { parseSourceFile } from "@/lib/bible/source-import";
import { providerPayload, sourceVerses } from "@/lib/memory/provider";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * All six memory exercises for licensed API.Bible versions
 * (20261125000100) against a real database, with SYNTHETIC fixture text
 * standing in for NASB and AMP (no licensed wording is committed):
 *   - the second permission (all six exercises), recorded per version by a
 *     Bible source manager, audited, and off by default;
 *   - NIV's separate publisher feature approval, required before its
 *     exercises can be turned on, with its unchanged-text practice intact;
 *   - each of the six activities started, hinted, and checked from the
 *     app's fetch, with the same games as stored text;
 *   - no passage text, word bank, piece text, hint, typed answer, or answer
 *     feedback in any stored row;
 *   - changed wording, missing text, expiry, and permission withdrawn
 *     mid-activity record nothing;
 *   - public-domain practice unchanged.
 * Fingerprints are computed by the app's own providerPayload, so the app
 * and database hashing (including Unicode normalization) are checked too.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const v = (c: number, n: number, t: string): Verse => ({ c, v: n, t, o: false, h: null, p: false, q: false });
// Synthetic wording only. "café" is a decomposed é: the fingerprint
// normalizes it (NFC) on both sides; the display text keeps it as given.
const FIXTURE_TEXT: Record<string, Verse[]> = {
  NASB: [v(3, 16, "Synthetic fixture wording, verse sixteen: the quick learners “remember” every café word—exactly."), v(3, 17, "Synthetic fixture wording, verse seventeen, kept verbatim.")],
  AMP: [v(3, 16, "Synthetic fixture text for verse sixteen [amplified], with brackets and the same words twice: words, words."), v(3, 17, "Synthetic fixture text for verse seventeen.")],
  NIV: [v(3, 16, "Synthetic fixture standing in for verse sixteen in NIV.")],
};
const REF = { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 17 };
const MARKER = /Synthetic fixture/;

describeDb("All six memory exercises for licensed versions", () => {
  let db: TestDb;
  let sources: string;
  let publisher: string;
  let m1: string;
  let m2: string;
  let web: string;
  const ids: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const j = (x: unknown) => JSON.stringify(x);
  const mk = async (email: string) => {
    const id = await db.createAuthUser(email, { fullName: email.split("@")[0] });
    await db.setStatus(id, "approved");
    return id;
  };
  const verses = (code: string) => (code === "NIV" ? FIXTURE_TEXT.NIV : FIXTURE_TEXT[code]);
  const ref = (code: string) => (code === "NIV" ? { ...REF, ev: 16 } : REF);
  const src = (code: string) => sourceVerses(verses(code));
  const start = (who: string, card: string, activity: string, options: Json = {}, difficulty = "guided", segment = 0) =>
    rpc<Json>(as(who), "memory_session_start", [card, activity, difficulty, segment, j(options)]);
  const stored = async (session: string) => (await db.raw<{ setup: Json; result: Json | null }>("select setup, result from memory.sessions where id = $1", [session]))[0];
  /** The verified tokens of a licensed passage, built in memory by the database itself (superuser, for answers only). */
  const tokens = async (card: string, code: string) =>
    (await db.raw<{ t: Array<{ t: string }> }>(
      "select (memory.provider_text(p, $2::jsonb)).tokens t from memory.cards k join memory.passages p on p.id = k.passage_id where k.id = $1",
      [card, j(src(code))],
    ))[0].t;
  const exercises = (code: string, on: boolean, extra: Json = {}) =>
    rpc(as(sources), "memory_admin_provider_exercises_save", [ids[code], j({ exercise_modes: on, exercise_note: "API.Bible support written clarification, 2026-10-26 (synthetic test).", ...extra })]);

  beforeAll(async () => {
    db = await TestDb.create();
    sources = await mk("px.sources@example.test");
    publisher = await mk("px.publisher@example.test");
    m1 = await mk("px.m1@example.test");
    m2 = await mk("px.m2@example.test");
    await db.grantRole(sources, "bible_source_manager");
    await db.grantRole(publisher, "memory_verse_publisher");
    web = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
       values ('WEB', 'World English Bible', 'WEB, public domain.', 'Public domain', 'public_domain', now(), 'draft', 1) returning id`,
    ))[0].id;
    const rows = parseSourceFile(FIXTURE, "csv").filter((r) => r.book && r.chapter && r.verse);
    for (const r of rows) {
      await db.raw("insert into bible.verses (translation_id, book_code, chapter, verse, text, omitted, heading, para_start, poetry) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        web, r.book, r.chapter, r.verse, r.text, r.text.trim() === "", r.heading, r.para, r.poetry,
      ]);
    }
    await db.raw("update bible.translations set verse_count = $2, status = 'active' where id = $1", [web, rows.length]);
    await db.raw("update bible.settings set default_translation_id = $1", [web]);
    for (const code of ["NASB", "AMP", "NIV"]) {
      ids[code] = (await db.raw<{ id: string }>(
        `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days)
         values ($1, $1 || ' synthetic', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), 'active', true, 1) returning id`, [code],
      ))[0].id;
      await rpc(as(sources), "memory_admin_provider_permission_save", [ids[code], true, "Dashboard and license checked for unchanged display (synthetic)."]);
      cards[code] = (await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: ids[code], ...ref(code), provider: providerPayload(verses(code), ref(code)) })])).id as string;
    }
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("source controls", () => {
    it("starts with unchanged-text practice only, everywhere", async () => {
      for (const code of ["NASB", "AMP", "NIV"]) {
        expect((await rpc<Json>(as(m1), "memory_card", [cards[code]])).modes).toEqual(["flashcards", "self_check"]);
      }
      await fails(as(m1), "memory_session_start", [cards.NASB, "missing_words", "guided", 0, j({ source: src("NASB") })], /use flashcards or self-check/);
      await fails(as(m1), "memory_session_start", [cards.NASB, "flashcards", "guided", 0, j({ direction: "text_to_ref", source: src("NASB") })], /Reference practice/);
    });

    it("is recorded only by Bible source managers, on top of the unchanged-text permission, with a note, and audited", async () => {
      await fails(as(publisher), "memory_admin_provider_exercises_save", [ids.NASB, j({ exercise_modes: true, exercise_note: "Long enough note here." })], /permission/);
      await fails(as(sources), "memory_admin_provider_exercises_save", [ids.NASB, j({ exercise_modes: true })], /written permission you relied on/);
      await fails(as(sources), "memory_admin_provider_exercises_save", [web, j({ exercise_modes: true, exercise_note: "Long enough note here." })], /outside service/);
      const list = await exercises("NASB", true);
      expect((list as unknown as Json[]).find((x) => (x.translation as Json).code === "NASB")).toMatchObject({ exercise_modes: true, publisher_approval_required: false });
      await exercises("AMP", true);
      const audit = await db.raw<{ details: Json }>("select details from public.audit_log where action = 'memory.provider_exercises' order by created_at");
      expect(audit.map((a) => a.details)).toEqual([
        { exercise_modes: true, publisher_approval_required: false, publisher_approval_confirmed: false },
        { exercise_modes: true, publisher_approval_required: false, publisher_approval_confirmed: false },
      ]);
      for (const code of ["NASB", "AMP"]) expect((await rpc<Json>(as(m1), "memory_card", [cards[code]])).modes).toHaveLength(6);
      const options = await rpc<Json[]>(as(m1), "memory_translation_options");
      expect(options.find((t) => t.code === "AMP")!.memory_modes).toHaveLength(6);
      // The database refuses the combination without its record.
      await expect(db.raw("update memory.provider_permissions set exercise_modes = true, exercise_note = null where translation_id = $1", [ids.NIV])).rejects.toThrow(/provider_permissions_exercises/);
    });

    it("keeps NIV's exercises behind its separate publisher feature approval, and its unchanged-text practice as it was", async () => {
      const niv = ((await rpc<Json[]>(as(sources), "memory_admin_provider_permissions")) as Json[]).find((x) => (x.translation as Json).code === "NIV")!;
      expect(niv).toMatchObject({ unchanged_text: true, exercise_modes: false, publisher_approval_required: true, publisher_approval_confirmed_at: null });
      await fails(as(sources), "memory_admin_provider_exercises_save", [ids.NIV, j({ exercise_modes: true, exercise_note: "API.Bible clarification received (synthetic)." })], /direct publisher agreement/);
      await fails(as(sources), "memory_admin_provider_exercises_save", [ids.NIV, j({ publisher_approval_confirmed: true })], /publisher agreement you checked/);
      expect((await rpc<Json>(as(m1), "memory_card", [cards.NIV])).modes).toEqual(["flashcards", "self_check"]);
      const s = await start(m1, cards.NIV, "self_check", { source: src("NIV") });
      await fails(as(m1), "memory_session_hint", [s.id, j({ source: src("NIV") })], /Hints aren't available/);
      await rpc(as(m1), "memory_session_reveal", [s.id]);
      expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ confidence: "mostly" })])).toMatchObject({ saved: true });
      // Once Biblica's approval is recorded (synthetic here), it can be turned on, and off again.
      await exercises("NIV", true, { publisher_approval_confirmed: true, publisher_approval_note: "Biblica feature approval under section V.K (synthetic test)." });
      expect((await rpc<Json>(as(m1), "memory_card", [cards.NIV])).modes).toHaveLength(6);
      await exercises("NIV", false);
      expect((await rpc<Json>(as(m1), "memory_card", [cards.NIV])).modes).toEqual(["flashcards", "self_check"]);
    });
  });

  for (const code of ["NASB", "AMP"]) {
    describe(`the six activities in ${code} (synthetic fixture)`, () => {
      const card = () => cards[code];
      const source = () => src(code);

      it("read & repeat: the passage's words on screen, positions only stored", async () => {
        const s = await start(m1, card(), "read_repeat", { source: source() });
        const shown = (s.setup as { tokens: Array<{ t: string }> }).tokens.map((t) => t.t).join(" ");
        expect(shown).toMatch(MARKER);
        expect(s.provider).toBe(true);
        expect(JSON.stringify(await stored(s.id as string))).not.toMatch(MARKER);
        expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ level: 2, reveals: 1 })])).toMatchObject({ saved: true });
      });

      it("flashcards both ways", async () => {
        const f = await start(m1, card(), "flashcards", { source: source() });
        expect(f.setup).toMatchObject({ direction: "ref_to_text", front: expect.stringMatching(/^John 3:16.17$/) });
        const r = await start(m1, card(), "flashcards", { direction: "text_to_ref", source: source() });
        expect((r.setup as Json).front).toMatch(MARKER);
        expect(JSON.stringify(await stored(r.id as string))).not.toMatch(MARKER);
        await rpc(as(m1), "memory_session_reveal", [r.id]);
        expect(await rpc<Json>(as(m1), "memory_session_submit", [r.id, j({ confidence: "fully" })])).toMatchObject({ saved: true });
      });

      it("missing words: bank and blanks on screen, answers checked, feedback kept only as right or wrong", async () => {
        const s = await start(m1, card(), "missing_words", { source: source() }, "growing");
        expect((s.setup as { bank: unknown[] }).bank.length).toBeGreaterThan(0);
        const kept = await stored(s.id as string);
        expect(kept.setup).not.toHaveProperty("bank");
        expect(JSON.stringify(kept)).not.toMatch(MARKER);
        const hint = await rpc<Json>(as(m1), "memory_session_hint", [s.id, j({ blank: 1, source: source() })]);
        expect(typeof hint.word).toBe("string");
        const toks = await tokens(card(), code);
        const blanks = kept.setup.blanks as number[];
        const answers = Object.fromEntries(blanks.map((i) => [String(i), toks[i].t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")]));
        const done = await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ answers, source: source() })]);
        expect(done).toMatchObject({ saved: true, accuracy: 1 });
        expect(JSON.stringify(done.details)).toMatch(/"expected"/); // returned to the member once
        const after = await stored(s.id as string);
        expect(JSON.stringify(after)).not.toMatch(/"expected"|"answer"/);
        expect((after.result!.details as { results: Json[] }).results[0]).toEqual({ blank: 1, correct: true });
      });

      it("word order: pieces on screen, ranges stored, order checked", async () => {
        const s = await start(m1, card(), "word_order", { source: source() }, "growing");
        expect(JSON.stringify(s.setup)).toMatch(/Synthetic/);
        const kept = await stored(s.id as string);
        expect(JSON.stringify(kept)).not.toMatch(MARKER);
        await rpc(as(m1), "memory_session_hint", [s.id, j({ order: [], source: source() })]);
        const order = [...(kept.setup.chips as Array<{ id: string; from: number }>)].sort((a, b) => a.from - b.from).map((c) => c.id);
        expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ order, source: source() })])).toMatchObject({ saved: true, accuracy: 1 });
      });

      it("typed recall: compared word by word; neither the answer nor the comparison is kept", async () => {
        const s = await start(m1, card(), "type_verse", { source: source() });
        await rpc(as(m1), "memory_session_hint", [s.id, j({ position: 0, source: source() })]);
        const typed = verses(code).map((x) => x.t).join(" ");
        const done = await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ text: typed, source: source() })]);
        expect(done).toMatchObject({ saved: true, accuracy: 1 });
        expect((done.details as Json).your_text).toMatch(MARKER);
        const kept = await stored(s.id as string);
        expect(JSON.stringify(kept)).not.toMatch(MARKER);
        expect(kept.result!.details).not.toHaveProperty("ops");
        expect((kept.result!.details as Json).accuracy).toBe(1);
      });

      it("self-check with the opening-words hint", async () => {
        const s = await start(m1, card(), "self_check", { source: source() });
        const hint = await rpc<Json>(as(m1), "memory_session_hint", [s.id, j({ source: source() })]);
        expect(hint.words).toMatch(/^Synthetic fixture/);
        await rpc(as(m1), "memory_session_reveal", [s.id]);
        expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ confidence: "partly" })])).toMatchObject({ saved: true });
      });
    });
  }

  describe("no licensed text in any stored record", () => {
    it("keeps passages, sessions, results, attempts, cards, awards, and the audit log free of it", async () => {
      const [{ t }] = await db.raw<{ t: string }>(
        `select coalesce(string_agg(x, ' '), '') t from (
           select to_jsonb(p)::text x from memory.passages p
           union all select to_jsonb(s)::text from memory.sessions s
           union all select to_jsonb(a)::text from memory.attempts a
           union all select to_jsonb(k)::text from memory.cards k
           union all select to_jsonb(w)::text from memory.awards w
           union all select to_jsonb(l)::text from public.audit_log l) q`,
      );
      expect(t).not.toMatch(MARKER);
      expect(t).not.toMatch(/remember|amplified/);
    });

    it("counts the exercises toward the existing badges, once each", async () => {
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.awards where profile_id = $1 and badge_key = 'explorer'", [m1]);
      expect(n).toBe(1);
    });
  });

  describe("wording, availability, and expiry", () => {
    const changed = () => [{ ...src("NASB")[0], t: "Synthetic fixture wording, revised by the publisher." }, src("NASB")[1]];

    it("refuses to start on changed or missing wording, or text outside the reference", async () => {
      await fails(as(m1), "memory_session_start", [cards.NASB, "word_order", "guided", 0, j({ source: changed() })], /has changed since you added it/);
      await fails(as(m1), "memory_session_start", [cards.NASB, "word_order", "guided", 0, j({ source: [] })], /temporarily unavailable/);
      await fails(as(m1), "memory_session_start", [cards.NASB, "word_order", "guided", 0, j({ source: [{ c: 4, v: 1, t: "Synthetic fixture elsewhere." }] })], /temporarily unavailable/);
    });

    it("records nothing when the wording changes mid-activity, and keeps history", async () => {
      const before = (await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where card_id = $1", [cards.NASB]))[0].n;
      const s = await start(m1, cards.NASB, "type_verse", { source: src("NASB") });
      const r = await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ text: "anything", source: changed() })]);
      expect(r).toEqual({ status: "changed", saved: false });
      expect((await stored(s.id as string)).result).toBeNull();
      const after = (await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where card_id = $1", [cards.NASB]))[0].n;
      expect(after).toBe(before);
      // The activity is closed: no hints from it either.
      expect(await rpc<Json>(as(m1), "memory_session_hint", [s.id, j({ source: src("NASB") })])).toEqual({ status: "expired" });
    });

    it("treats an expired activity as expired", async () => {
      const s = await start(m1, cards.AMP, "missing_words", { source: src("AMP") });
      await db.raw("update memory.sessions set expires_at = now() - interval '1 minute' where id = $1", [s.id]);
      expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ answers: {}, source: src("AMP") })])).toMatchObject({ status: "expired", saved: false });
    });

    it("stops the exercises when the permission is withdrawn, keeping flashcards and self-check and all progress", async () => {
      const s = await start(m1, cards.AMP, "word_order", { source: src("AMP") });
      await exercises("AMP", false);
      expect(await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ order: [], source: src("AMP") })])).toEqual({ status: "unavailable", saved: false });
      await fails(as(m1), "memory_session_start", [cards.AMP, "word_order", "guided", 0, j({ source: src("AMP") })], /use flashcards or self-check/);
      expect((await rpc<Json>(as(m1), "memory_card", [cards.AMP])).modes).toEqual(["flashcards", "self_check"]);
      const hist = (await rpc<Json>(as(m1), "memory_card", [cards.AMP])).history as Json[];
      expect(hist.length).toBeGreaterThanOrEqual(6);
      // Turning off the unchanged-text permission turns the exercises off too.
      await exercises("AMP", true);
      await rpc(as(sources), "memory_admin_provider_permission_save", [ids.AMP, false, "Withdrawn pending review (synthetic)."]);
      const amp = ((await rpc<Json[]>(as(sources), "memory_admin_provider_permissions")) as Json[]).find((x) => (x.translation as Json).code === "AMP")!;
      expect(amp).toMatchObject({ unchanged_text: false, exercise_modes: false });
    });
  });

  describe("helpers for the app", () => {
    it("names the source of a licensed session only to its owner", async () => {
      const s = await start(m1, cards.NASB, "self_check", { source: src("NASB") });
      expect(await rpc<Json>(as(m1), "memory_session_source", [s.id])).toEqual({ translation_id: ids.NASB, book: "JHN", sc: 3, sv: 16, ec: 3, ev: 17 });
      await fails(as(m2), "memory_session_source", [s.id], /wasn't found/);
    });

    it("gives practice parts without text", async () => {
      const parts = await rpc<Json>(as(m1), "memory_card_parts", [cards.NASB, j(src("NASB"))]);
      expect(parts.word_count).toBeGreaterThan(10);
      expect((parts.segments as Json[])[0]).toMatchObject({ n: 1, words: expect.any(Number) });
      expect(JSON.stringify(parts)).not.toMatch(MARKER);
      await fails(as(m2), "memory_card_parts", [cards.NASB, j(src("NASB"))], /not found/);
    });

    it("previews permitted activities for staff from the fetch, recording nothing", async () => {
      const col = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "NASB verses", translation_id: ids.NASB }), null]);
      const item = await rpc<Json>(as(publisher), "memory_admin_item_add", [col.id, j({ ...REF, provider: providerPayload(verses("NASB"), REF) })]);
      const before = (await db.raw<{ n: number }>("select count(*)::int n from memory.sessions"))[0].n;
      const pv = await rpc<Json>(as(publisher), "memory_admin_preview", [item.id, "missing_words", "guided", 0, false, j(src("NASB"))]);
      expect(pv).toMatchObject({ activity: "missing_words", preview: true });
      expect(pv.answer_text).toMatch(MARKER);
      expect((await db.raw<{ n: number }>("select count(*)::int n from memory.sessions"))[0].n).toBe(before);
      await fails(as(publisher), "memory_admin_preview", [item.id, "missing_words", "guided", 0, false], /temporarily unavailable/);
    });
  });

  describe("public-domain practice", () => {
    it("is unchanged: stored text, typed answers kept as before", async () => {
      const k = (await rpc<Json>(as(m2), "memory_card_add", [j({ translation_id: web, book: "JHN", sc: 3, sv: 16, ec: 3, ev: 16 })])).id as string;
      expect(await rpc<Json>(as(m2), "memory_session_source", [(await start(m2, k, "self_check")).id])).toBeNull();
      const s = await start(m2, k, "type_verse");
      const done = await rpc<Json>(as(m2), "memory_session_submit", [s.id, j({ text: "For God so loved the world" })]);
      expect(done).toMatchObject({ saved: true });
      expect((await stored(s.id as string)).result!.details).toHaveProperty("your_text");
    });
  });
});
