import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Memory verses in licensed API versions (20261106000100) against a real
 * database: nothing until a Bible source manager records the version's
 * terms; only unchanged-text practice (flashcards reference → passage,
 * self-check without hints); no verse text in passages, sessions, results,
 * or attempts; sessions bound to the cache window; the app's fingerprint
 * checked at start (wording changes refuse practice until the member
 * explicitly starts the new wording, keeping history); one member's bad
 * fingerprint never affects another's verses; translation changes and
 * assignments; permission withdrawn keeps progress.
 *
 * The provider's text never reaches the database, so these tests send what
 * the app's server sends: a fingerprint, verse numbers, and a word count.
 * Every person is synthetic.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const LICENSED_SAMPLE = "Synthetic licensed wording of John three sixteen, never stored."; // stands in for fetched text
const fp = (text: string) => createHash("sha256").update(text).digest("hex");
const provider = (text: string, verses: Array<[number, number]> = [[3, 16]], passageId = "JHN.3.16") => ({
  fingerprint: fp(text),
  verses,
  words: text.split(/\s+/).length,
  passage_id: passageId,
});

describeDb("Memory practice in licensed API versions", () => {
  let db: TestDb;
  let sources: string; // bible_source_manager
  let publisher: string;
  let m1: string;
  let m2: string;
  let web: string;
  let lic: string; // licensed, permitted below
  let other: string; // licensed, never permitted
  let card: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = (actor: Actor, fn: string, args: unknown[], message: RegExp) => expect(rpc(actor, fn, args)).rejects.toThrow(message);
  const j = (v: unknown) => JSON.stringify(v);
  const P = (book: string, sc: number, sv: number, ec = sc, ev = sv) => ({ book, sc, sv, ec, ev });
  const start = (who: string, id: string, activity: string, options: Json = {}) =>
    rpc<Json>(as(who), "memory_session_start", [id, activity, "guided", 0, j(options)]);
  const mk = async (email: string) => {
    const id = await db.createAuthUser(email, { fullName: email.split("@")[0] });
    await db.setStatus(id, "approved");
    return id;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    sources = await mk("mp.sources@example.test");
    publisher = await mk("mp.publisher@example.test");
    m1 = await mk("mp.m1@example.test");
    m2 = await mk("mp.m2@example.test");
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
    const api = async (code: string) =>
      (await db.raw<{ id: string }>(
        `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days)
         values ($1, $1 || ' licensed', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), 'active', true, 1) returning id`, [code],
      ))[0].id;
    lic = await api("LIC");
    other = await api("OTH");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("permission per licensed version", () => {
    it("offers nothing until the version's own terms are recorded", async () => {
      const t = await rpc<Json>(as(m1), "memory_translations");
      expect((t.items as Json[]).map((x) => x.code)).not.toContain("LIC");
      await fails(as(m1), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16), provider: provider(LICENSED_SAMPLE) })], /outside service/);
    });

    it("is recorded only by Bible source managers, with a note of what was checked", async () => {
      await fails(as(m1), "memory_admin_provider_permission_save", [lic, true, "Checked the license."], /permission/);
      await fails(as(publisher), "memory_admin_provider_permission_save", [lic, true, "Checked the license."], /permission/);
      await fails(as(sources), "memory_admin_provider_permission_save", [lic, true, "ok"], /what you checked/);
      await fails(as(sources), "memory_admin_provider_permission_save", [web, true, "Checked the license."], /outside service/);
      const list = await rpc<Json[]>(as(sources), "memory_admin_provider_permission_save", [lic, true, "API.Bible dashboard and license reviewed 2026-10-22."]);
      expect(list.find((x) => (x.translation as Json).code === "LIC")).toMatchObject({ unchanged_text: true, cards: 0 });
      expect(list.find((x) => (x.translation as Json).code === "OTH")).toMatchObject({ unchanged_text: false });
      const audit = await db.raw<{ details: Json }>("select details from public.audit_log where action = 'memory.provider_permission'");
      expect(audit[0].details).toEqual({ unchanged_text: true });
    });

    it("then offers the version with unchanged-text modes only", async () => {
      const t = await rpc<Json>(as(m1), "memory_translations");
      const item = (t.items as Json[]).find((x) => x.code === "LIC")!;
      expect(item.memory_modes).toEqual(["flashcards", "self_check"]);
      expect((t.items as Json[]).find((x) => x.code === "WEB")!.memory_modes).toHaveLength(6);
      expect((t.items as Json[]).map((x) => x.code)).not.toContain("OTH");
      // It can be the member's default.
      await rpc(as(m2), "memory_settings_save", [j({ default_translation_id: lic })]);
      expect((await rpc<Json>(as(m2), "memory_settings")).effective_translation).toMatchObject({ code: "LIC", source: "memory" });
    });
  });

  describe("no stored text", () => {
    it("adds a verse from the app's fetch: reference, passage ID, verse numbers, word count, fingerprint", async () => {
      await fails(as(m1), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16) })], /couldn't be checked/);
      await fails(as(m1), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16), provider: { ...provider(LICENSED_SAMPLE), verses: [[4, 1]] } })], /couldn't be checked/);
      await fails(as(m1), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16), provider: { ...provider(LICENSED_SAMPLE), words: 901 } })], /too long/);
      const c = await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16), provider: provider(LICENSED_SAMPLE) })]);
      card = c.id as string;
      expect(c).toMatchObject({ provider: true, modes: ["flashcards", "self_check"] });
      expect(c.passage).toMatchObject({ source_kind: "api", fingerprint: fp(LICENSED_SAMPLE), provider_passage_id: "JHN.3.16", verse_numbers: [[3, 16]], verses: null, word_count: 9 });
      const [row] = await db.raw<Json>("select verses, tokens, segments, short_segments, content_hash from memory.passages where translation_id = $1", [lic]);
      expect(row).toEqual({ verses: null, tokens: null, segments: null, short_segments: null, content_hash: fp(LICENSED_SAMPLE) });
      // A licensed passage can't carry text.
      await expect(db.raw("update memory.passages set tokens = '[]' where translation_id = $1", [lic])).rejects.toThrow(/passages_source/);
    });

    it("shows the text only in unchanged form: flashcards (reference → passage) and self-check without hints", async () => {
      for (const a of ["read_repeat", "missing_words", "word_order", "type_verse"]) {
        await fails(as(m1), "memory_session_start", [card, a, "guided", 0, j({ fingerprint: fp(LICENSED_SAMPLE) })], /flashcards or self-check/);
      }
      await fails(as(m1), "memory_session_start", [card, "flashcards", "guided", 0, j({ direction: "text_to_ref", fingerprint: fp(LICENSED_SAMPLE) })], /Reference practice/);
      const s = await start(m1, card, "self_check", { fingerprint: fp(LICENSED_SAMPLE) });
      await fails(as(m1), "memory_session_hint", [s.id, "{}"], /Hints aren't available/);
      const r = await rpc<Json>(as(m1), "memory_session_reveal", [s.id]);
      expect(r).toMatchObject({ text: null, reference: "John 3:16", provider: { translation_id: lic, book: "JHN", sc: 3, sv: 16, fingerprint: fp(LICENSED_SAMPLE) } });
      const done = await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ confidence: "mostly" })]);
      expect(done).toMatchObject({ saved: true, accuracy: null, quality: "partial" });
      const f = await start(m1, card, "flashcards", { fingerprint: fp(LICENSED_SAMPLE) });
      expect(f.setup).toMatchObject({ direction: "ref_to_text", front: "John 3:16" });
    });

    it("keeps no text in sessions, results, or history, and ends sessions with the cache window", async () => {
      const rows = await db.raw<Json>("select setup, result, extract(epoch from expires_at - created_at)::int secs from memory.sessions where card_id = $1", [card]);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(JSON.stringify([r.setup, r.result])).not.toMatch(/Synthetic licensed wording/);
        expect(r.secs).toBeLessThanOrEqual(86_400);
      }
      const detail = await rpc<Json>(as(m1), "memory_card", [card]);
      expect((detail.passage as Json).verses).toBeNull();
      expect(detail.history).toEqual([expect.objectContaining({ translation: "LIC", activity: "self_check" })]);
      // Without caching permission a session lasts an hour.
      await db.raw("update bible.translations set allow_cache = false, cache_days = null where id = $1", [lic]);
      const s = await start(m1, card, "self_check", { fingerprint: fp(LICENSED_SAMPLE) });
      const [{ secs }] = await db.raw<{ secs: number }>("select extract(epoch from expires_at - created_at)::int secs from memory.sessions where id = $1", [s.id]);
      expect(secs).toBe(3600);
      await db.raw("update bible.translations set allow_cache = true, cache_days = 1 where id = $1", [lic]);
    });
  });

  describe("wording changes", () => {
    const CHANGED = "Synthetic licensed wording of John three sixteen, revised by the publisher.";

    it("refuses practice when the app can't fetch the text, or the fetched wording differs", async () => {
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, "{}"], /temporarily unavailable/);
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, j({ fingerprint: fp(CHANGED) })], /has changed since you added it/);
      const c = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(c.update_available).toBeNull(); // the database can't tell; the app compares
    });

    it("starts the new wording only when the member chooses, keeping the earlier history", async () => {
      await fails(as(m1), "memory_card_provider_refresh", [card, j(provider(LICENSED_SAMPLE))], /already uses the current wording/);
      const n = await rpc<Json>(as(m1), "memory_card_provider_refresh", [card, j(provider(CHANGED))]);
      expect(n).toMatchObject({ status: "active", sessions: 0, step: 0, previous_card_id: card });
      expect((n.passage as Json).fingerprint).toBe(fp(CHANGED));
      const old = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(old.status).toBe("superseded");
      expect((old.history as Json[]).length).toBe(1);
      card = n.id as string;
    });

    it("never lets one member's fingerprint affect another member's verse", async () => {
      // m2 sends a wrong fingerprint for the same reference: only m2's card uses it.
      const bogus = await rpc<Json>(as(m2), "memory_card_add", [j({ translation_id: lic, ...P("JHN", 3, 16), provider: provider("not the real text") })]);
      expect((bogus.passage as Json).fingerprint).toBe(fp("not the real text"));
      const mine = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(mine).toMatchObject({ status: "active", update_available: null });
      expect((mine.passage as Json).superseded).toBe(false);
      await expect(start(m1, card, "self_check", { fingerprint: fp(CHANGED) })).resolves.toMatchObject({ activity: "self_check" });
    });
  });

  describe("translations, assignments, and permission withdrawn", () => {
    it("changes a stored-text verse to a licensed version with the app's fetch", async () => {
      const w = (await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: web, ...P("JHN", 3, 17) })])).id as string;
      const text = "Synthetic licensed wording of John three seventeen.";
      const pv = await rpc<Json>(as(m1), "memory_card_translation_preview", [w, lic, fp(text)]);
      expect(pv).toMatchObject({ ok: true, provider: true, verses: null, only_new: null });
      await fails(as(m1), "memory_card_change_translation", [w, lic, true], /couldn't be checked/);
      const n = await rpc<Json>(as(m1), "memory_card_change_translation", [w, lic, true, j(provider(text, [[3, 17]], "JHN.3.17"))]);
      expect(n).toMatchObject({ provider: true, previous_card_id: w });
      // And back to stored text, restoring that progress.
      const back = await rpc<Json>(as(m1), "memory_card_change_translation", [n.id, web, true]);
      expect(back.id).toBe(w);
    });

    it("lets a member practice an assigned verse in a permitted licensed version when the collection allows a choice", async () => {
      const col = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Choice", translation_id: web, translation_choice: true }), null]);
      const item = await rpc<Json>(as(publisher), "memory_admin_item_add", [col.id, j(P("GEN", 1, 1))]);
      await rpc(as(publisher), "memory_admin_collection_status", [col.id, "publish", null]);
      const text = "Synthetic licensed wording of Genesis one one.";
      const c = await rpc<Json>(as(m1), "memory_card_add", [j({ item_id: item.id, translation_id: lic, provider: provider(text, [[1, 1]], "GEN.1.1") })]);
      expect(c).toMatchObject({ provider: true, assignment: { own_translation: true } });
      await fails(as(m2), "memory_card_add", [j({ item_id: item.id, translation_id: other, provider: provider(text, [[1, 1]], "GEN.1.1") })], /outside service/);
    });

    it("stops practice when permission is withdrawn, keeping verses and progress", async () => {
      await rpc(as(sources), "memory_admin_provider_permission_save", [lic, false, "Withdrawn pending publisher reply."]);
      const c = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(c).toMatchObject({ status: "active", modes: [] });
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, j({ fingerprint: fp("Synthetic licensed wording of John three sixteen, revised by the publisher.") })], /flashcards or self-check/);
      expect(((await rpc<Json>(as(m1), "memory_translations")).items as Json[]).map((x) => x.code)).not.toContain("LIC");
      // The member's default falls back.
      expect((await rpc<Json>(as(m2), "memory_settings")).effective_translation).toMatchObject({ code: "WEB", source: "church" });
    });
  });
});
