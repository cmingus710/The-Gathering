import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Licensed API versions in church and group memory collections
 * (20261111000100) against a real database: one eligibility rule for every
 * selector (published stored text; published licensed versions only with
 * their memory permission; drafts never listed); collection creation,
 * passage assignment without stored text, publishing, member practice in
 * the collection's version or the member's own; restricted modes refused;
 * permission withdrawn; staff wording updates; challenges and awards
 * without duplicate credit; youth accounts kept out; public-domain
 * collections unchanged.
 *
 * The provider's text never reaches the database, so these tests send what
 * the app's server sends: a fingerprint, verse numbers, and a word count.
 * Every person is synthetic.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const NIV_TEXT = "Synthetic licensed wording standing in for NIV John three sixteen.";
const NIV_317 = "Synthetic licensed wording standing in for NIV John three seventeen.";
const NIV_REVISED = "Synthetic licensed wording standing in for NIV John three sixteen, revised.";
const fp = (text: string) => createHash("sha256").update(text).digest("hex");
const provider = (text: string, verses: Array<[number, number]> = [[3, 16]], passageId = "JHN.3.16") => ({
  fingerprint: fp(text),
  verses,
  words: text.split(/\s+/).length,
  passage_id: passageId,
});

describeDb("Licensed versions in memory collections", () => {
  let db: TestDb;
  let sources: string;
  let publisher: string;
  let leader: string;
  let m1: string;
  let m2: string;
  let m3: string;
  let youthUser: string;
  let group: string;
  let web: string;
  let niv: string;
  let nasb: string;
  let amp: string;
  let draft: string;
  let fixed: string; // NIV collection, NIV required
  let choice: string; // NIV collection, members may choose
  let john: string; // item in `fixed`
  let choiceItem: string;
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
  const today = async (offset = 0) =>
    (await db.raw<{ d: string }>("select ((now() at time zone 'America/Chicago')::date + $1::int)::text d", [offset]))[0].d;
  const permit = (t: string, on: boolean) => rpc(as(sources), "memory_admin_provider_permission_save", [t, on, "Dashboard and license checked for memory verses (synthetic)."]);

  beforeAll(async () => {
    db = await TestDb.create();
    sources = await mk("lc.sources@example.test");
    publisher = await mk("lc.publisher@example.test");
    leader = await mk("lc.leader@example.test");
    m1 = await mk("lc.m1@example.test");
    m2 = await mk("lc.m2@example.test");
    m3 = await mk("lc.m3@example.test");
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
    const api = async (code: string, status = "active") =>
      (await db.raw<{ id: string }>(
        `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days)
         values ($1, $1 || ' licensed', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), $2::bible.translation_status, true, 1) returning id`, [code, status],
      ))[0].id;
    niv = await api("NIV");
    nasb = await api("NASB");
    amp = await api("AMP");
    draft = await api("DRF", "draft");
    const admin = await mk("lc.admin@example.test");
    await db.grantRole(admin, "super_admin");
    group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Memory Group", summary: "s", about: "a", visibility: "discoverable", leader_id: leader })]);
    for (const id of [m1, m2, m3]) await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, id]);
    await rpc(as(publisher), "memory_admin_group_authorize", [group, true, null]);
    // An independent youth account (synthetic), under an approved policy.
    youthUser = await mk("lc.youth@example.test");
    // Test setup stands in for the youth and family process.
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youthUser]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.raw(
      `insert into youth.policies (version, status, title, settings, approval_reference, approved_at)
       values (1, 'approved', 'Synthetic policy', '{"independent_accounts": true}', 'Synthetic approval', now())`,
    );
    await db.raw("insert into youth.children (display_name, account_id) values ('Synthetic Youth', $1)", [youthUser]);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("eligibility", () => {
    it("lists published versions only, and a licensed one as eligible only with its memory permission", async () => {
      const list = await rpc<Json[]>(as(publisher), "memory_translation_options");
      const by = (code: string) => list.find((t) => t.code === code);
      expect(by("DRF")).toBeUndefined();
      expect(by("WEB")).toMatchObject({ memory_eligible: true, memory_reason: null, credential_env: null });
      for (const code of ["NIV", "NASB", "AMP"]) expect(by(code)).toMatchObject({ source_kind: "api", memory_eligible: false, memory_reason: "not_confirmed", memory_modes: [] });
      await permit(niv, true);
      await permit(nasb, true);
      await permit(amp, true);
      const after = await rpc<Json[]>(as(publisher), "memory_translation_options");
      for (const code of ["NIV", "NASB", "AMP"])
        expect(after.find((t) => t.code === code)).toMatchObject({ memory_eligible: true, memory_modes: ["flashcards", "self_check"], credential_env: "API_BIBLE_KEY" });
      // The same list on the administrator's page; the church default stays stored text.
      const home = await rpc<Json>(as(publisher), "memory_admin_home");
      expect((home.translations as Json[]).map((t) => t.code).sort()).toEqual(["AMP", "NASB", "NIV", "WEB"]);
      expect(home.default_translation_id).toBe(web);
    });

    it("never treats a draft version as eligible, even with a permission recorded", async () => {
      await permit(draft, true);
      expect((await rpc<Json[]>(as(publisher), "memory_translation_options")).map((t) => t.code)).not.toContain("DRF");
      await fails(as(publisher), "memory_admin_collection_save", [null, j({ title: "Draft version", translation_id: draft }), null], /published Bible version/);
    });
  });

  describe("administrator flow", () => {
    it("creates collections in NIV, NASB, and AMP, but not in a licensed version without permission", async () => {
      await permit(amp, false);
      await fails(as(publisher), "memory_admin_collection_save", [null, j({ title: "AMP verses", translation_id: amp }), null], /AMP isn't confirmed for memory verses/);
      await permit(amp, true);
      for (const t of [nasb, amp]) {
        const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Licensed", translation_id: t }), null]);
        expect((c.translation as Json).source_kind).toBe("api");
      }
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Fall verses (NIV)", translation_id: niv }), null]);
      fixed = c.id as string;
      expect(c).toMatchObject({ translation_choice: false, translation: { code: "NIV", source_kind: "api", memory_available: true, memory_modes: ["flashcards", "self_check"] } });
      choice = (await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Choose your version", translation_id: niv, translation_choice: true }), null])).id as string;
      // A draft can move between eligible versions while it has no verses.
      const moved = await rpc<Json>(as(publisher), "memory_admin_collection_save", [choice, j({ title: "Choose your version", translation_id: web }), null]);
      expect((moved.translation as Json).code).toBe("WEB");
      await rpc(as(publisher), "memory_admin_collection_save", [choice, j({ title: "Choose your version", translation_id: niv }), null]);
    });

    it("adds verses from the app's fetch, keeping no text", async () => {
      await fails(as(publisher), "memory_admin_item_add", [fixed, j(P("JHN", 3, 16))], /couldn't be checked/);
      const item = await rpc<Json>(as(publisher), "memory_admin_item_add", [fixed, j({ ...P("JHN", 3, 16), title: "God's love", hint: "For God so", provider: provider(NIV_TEXT) })]);
      john = item.id as string;
      expect(item.passage).toMatchObject({ source_kind: "api", fingerprint: fp(NIV_TEXT), provider_passage_id: "JHN.3.16", verse_numbers: [[3, 16]], verses: null });
      choiceItem = (await rpc<Json>(as(publisher), "memory_admin_item_add", [choice, j({ ...P("JHN", 3, 17), provider: provider(NIV_317, [[3, 17]], "JHN.3.17") })])).id as string;
      const detail = await rpc<Json>(as(publisher), "memory_admin_collection", [fixed]);
      const i = (detail.items as Json[])[0];
      expect(i.suitability).toEqual(expect.arrayContaining([expect.stringMatching(/flashcards and self-check/)]));
      // Only the activities the version permits can be previewed (unchanged text only here).
      await fails(as(publisher), "memory_admin_preview", [john, "missing_words", "guided", 0, false], /isn't permitted for this version/);
      // Verse counts and length limits still apply.
      await fails(as(publisher), "memory_admin_item_add", [fixed, j({ ...P("JHN", 3, 16), provider: { ...provider(NIV_TEXT), words: 901 } })], /too long/);
    });

    it("publishes, and duplicates by reference", async () => {
      await rpc(as(publisher), "memory_admin_collection_status", [fixed, "publish", null]);
      await rpc(as(publisher), "memory_admin_collection_status", [choice, "publish", null]);
      const dup = await rpc<Json>(as(publisher), "memory_admin_collection_duplicate", [fixed, null]);
      const d = await rpc<Json>(as(publisher), "memory_admin_collection", [dup.id]);
      const [orig] = await db.raw<{ passage_id: string }>("select passage_id from memory.items where id = $1", [john]);
      expect(((d.items as Json[])[0].passage as Json).id).toBe(orig.passage_id);
    });

    it("lets an authorized group leader use a licensed version for the group", async () => {
      const g = await rpc<Json>(as(leader), "memory_admin_collection_save", [null, j({ title: "Group NIV", audience: "group", group_id: group, translation_id: niv }), null]);
      expect((g.translation as Json).code).toBe("NIV");
    });
  });

  describe("member practice", () => {
    it("shows the collection with its licensed version available", async () => {
      const c = await rpc<Json>(as(m1), "memory_collection", [fixed]);
      expect(c.translation).toMatchObject({ code: "NIV", memory_available: true });
      expect(((c.items as Json[])[0].passage as Json).verses).toBeNull();
    });

    it("practices an assigned verse in the collection's version with unchanged-text modes only", async () => {
      const k = await rpc<Json>(as(m1), "memory_card_add", [j({ item_id: john })]);
      card = k.id as string;
      expect(k).toMatchObject({ provider: true, modes: ["flashcards", "self_check"], assignment: { choice: false, own_translation: false } });
      for (const a of ["read_repeat", "missing_words", "word_order", "type_verse"]) {
        await fails(as(m1), "memory_session_start", [card, a, "guided", 0, j({ fingerprint: fp(NIV_TEXT) })], /flashcards or self-check/);
      }
      await fails(as(m1), "memory_session_start", [card, "flashcards", "guided", 0, j({ direction: "text_to_ref", fingerprint: fp(NIV_TEXT) })], /Reference practice/);
      const s = await start(m1, card, "self_check", { fingerprint: fp(NIV_TEXT) });
      // The church's editorial hint stays on the verse page; text hints stay off.
      await fails(as(m1), "memory_session_hint", [s.id, "{}"], /Hints aren't available/);
      await rpc(as(m1), "memory_session_reveal", [s.id]);
      const done = await rpc<Json>(as(m1), "memory_session_submit", [s.id, j({ confidence: "fully" })]);
      expect(done).toMatchObject({ saved: true });
      // Every verse in the collection practiced: the award, once.
      expect((done.badges as Json[]).map((b) => b.key)).toEqual(expect.arrayContaining(["first_steps", "collection_explored"]));
      const again = await start(m1, card, "flashcards", { fingerprint: fp(NIV_TEXT) });
      await rpc(as(m1), "memory_session_reveal", [again.id]);
      const second = await rpc<Json>(as(m1), "memory_session_submit", [again.id, j({ confidence: "mostly" })]);
      expect((second.badges as Json[]).map((b) => b.key)).not.toContain("collection_explored");
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.awards where profile_id = $1 and badge_key = 'collection_explored'", [m1]);
      expect(n).toBe(1);
    });

    it("refuses a fetch that doesn't match the assigned wording", async () => {
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, j({ fingerprint: fp(NIV_REVISED) })], /has changed since you added it/);
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, "{}"], /temporarily unavailable/);
    });

    it("keeps the collection's version when members may not choose", async () => {
      await fails(as(m2), "memory_card_add", [j({ item_id: john, translation_id: web })], /assigned in NIV/);
      const k = await rpc<Json>(as(m2), "memory_card_add", [j({ item_id: john })]);
      expect(k.can_change_translation).toBe(false);
      await fails(as(m2), "memory_card_change_translation", [k.id, web, true], /assigned in NIV/);
    });

    it("lets each member choose another eligible version when allowed, without changing the collection", async () => {
      const own = await rpc<Json>(as(m2), "memory_card_add", [j({ item_id: choiceItem, translation_id: web })]);
      expect(own).toMatchObject({ provider: false, assignment: { choice: true, own_translation: true } });
      expect((own.modes as string[]).length).toBe(6);
      const other = await rpc<Json>(as(m3), "memory_card_add", [j({ item_id: choiceItem, translation_id: nasb, provider: provider("Synthetic NASB wording.", [[3, 17]], "JHN.3.17") })]);
      expect(other).toMatchObject({ provider: true, assignment: { own_translation: true } });
      const c = await rpc<Json>(as(m1), "memory_collection", [choice]);
      expect(((c.items as Json[])[0].passage as Json)).toMatchObject({ source_kind: "api", fingerprint: fp(NIV_317) });
      expect((c.translation as Json).code).toBe("NIV");
      // The member's default translation is untouched by these choices.
      const s = await rpc<Json>(as(m2), "memory_settings");
      expect(s.default_translation_id).toBeNull();
    });

    it("counts practice in a group challenge once per attempt", async () => {
      const ch = await rpc<Json>(as(publisher), "memory_admin_challenge_save", [null, j({
        group_id: group, collection_id: fixed, title: "NIV challenge", starts_on: await today(-3), ends_on: await today(20), goal_sessions: 10, min_participants: 3,
      })]);
      await db.raw("delete from memory.attempts where profile_id = any($1)", [[m1, m2, m3]]);
      for (const who of [m1, m2, m3]) await rpc(as(who), "memory_challenge_join", [ch.id, true]);
      for (const who of [m1, m2, m3]) {
        const k = (await rpc<Json>(as(who), "memory_card_add", [j({ item_id: john })])).id as string;
        for (let n = 0; n < 2; n++) {
          const s = await start(who, k, "self_check", { fingerprint: fp(NIV_TEXT) });
          await rpc(as(who), "memory_session_reveal", [s.id]);
          await rpc(as(who), "memory_session_submit", [s.id, j({ confidence: "mostly" })]);
          // A replayed submit counts nothing more.
          await rpc(as(who), "memory_session_submit", [s.id, j({ confidence: "mostly" })]);
        }
      }
      await db.raw("update memory.attempts set local_date = local_date - 1 where profile_id = any($1)", [[m1, m2, m3]]);
      const agg = (await rpc<Json>(as(m1), "memory_challenge", [ch.id])).aggregate as Json;
      expect(agg).toMatchObject({ visible: true, participants: 3, sessions: 5 }); // 6 attempts, shown rounded down to 5
    });

    it("shows current assignments, with reminders' inputs, for licensed verses", async () => {
      await rpc(as(publisher), "memory_admin_item_save", [john, j({ starts_on: await today(-1), ends_on: await today(5) })]);
      const a = await rpc<Json>(as(m1), "memory_assignments");
      expect((a.current as Json[]).map((i) => i.id)).toContain(john);
      const item = (a.current as Json[]).find((i) => i.id === john)!;
      expect(item.card).toMatchObject({ current_version: true, modes: ["flashcards", "self_check"] });
    });
  });

  describe("no permanent licensed text", () => {
    it("keeps the wording out of every memory table and the audit log", async () => {
      const dump = await db.raw<{ t: string }>(
        `select coalesce(string_agg(x, ' '), '') t from (
           select to_jsonb(p)::text x from memory.passages p
           union all select to_jsonb(i)::text from memory.items i
           union all select to_jsonb(c)::text from memory.collections c
           union all select to_jsonb(s)::text from memory.sessions s
           union all select to_jsonb(a)::text from memory.attempts a
           union all select to_jsonb(l)::text from public.audit_log l) q`,
      );
      expect(dump[0].t).not.toMatch(/Synthetic licensed wording|Synthetic NASB wording/);
      const [row] = await db.raw<Json>("select verses, tokens, segments, short_segments from memory.passages p join memory.items i on i.passage_id = p.id where i.id = $1", [john]);
      expect(row).toEqual({ verses: null, tokens: null, segments: null, short_segments: null });
    });
  });

  describe("wording updates", () => {
    it("lets staff point a verse at the new wording; members are asked, never switched", async () => {
      await fails(as(publisher), "memory_admin_item_update_text", [john, "Publisher revision.", j(provider(NIV_TEXT))], /already uses the current wording/);
      await fails(as(publisher), "memory_admin_item_update_text", [john, "Publisher revision."], /couldn't be checked/);
      // m3 starts the new wording on their own first.
      const m3card = (await rpc<Json>(as(m3), "memory_card_add", [j({ item_id: john })])).id as string;
      const refreshed = await rpc<Json>(as(m3), "memory_card_provider_refresh", [m3card, j(provider(NIV_REVISED))]);
      expect(refreshed.update_available).toBeNull(); // not offered the church's (older) wording
      const updated = await rpc<Json>(as(publisher), "memory_admin_item_update_text", [john, "The publisher revised this verse.", j(provider(NIV_REVISED))]);
      expect((updated.passage as Json).fingerprint).toBe(fp(NIV_REVISED));
      const mine = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(mine.update_available).toEqual({ source: "collection", reason: "The publisher revised this verse." });
      expect((mine.passage as Json).fingerprint).toBe(fp(NIV_TEXT));
      const switched = await rpc<Json>(as(m1), "memory_card_switch_version", [card]);
      expect((switched.passage as Json).fingerprint).toBe(fp(NIV_REVISED));
      expect(((await rpc<Json>(as(m1), "memory_card", [card])).history as Json[]).length).toBeGreaterThan(0);
      card = switched.id as string;
      expect((await rpc<Json>(as(m3), "memory_card", [refreshed.id])).update_available).toBeNull();
    });
  });

  describe("permission withdrawn", () => {
    it("stops new practice, keeps references and progress, and substitutes nothing", async () => {
      await permit(niv, false);
      const c = await rpc<Json>(as(m1), "memory_collection", [fixed]);
      expect(c.translation).toMatchObject({ code: "NIV", memory_available: false, memory_modes: [] });
      expect((c.items as Json[]).map((i) => i.id)).toContain(john);
      const k = await rpc<Json>(as(m1), "memory_card", [card]);
      expect(k).toMatchObject({ status: "active", modes: [], provider: true, passage: { translation: { code: "NIV" } } });
      await fails(as(m1), "memory_session_start", [card, "self_check", "guided", 0, j({ fingerprint: fp(NIV_REVISED) })], /flashcards or self-check/);
      const fresh = await mk("lc.fresh@example.test");
      await fails(as(fresh), "memory_card_add", [j({ item_id: john })], /NIV isn't available for memory practice right now. No other version/);
      // Staff can't add verses, publish, duplicate, or create collections in it.
      const draftCol = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "Plain", translation_id: web }), null]);
      await fails(as(publisher), "memory_admin_collection_save", [draftCol.id, j({ title: "Plain", translation_id: niv }), null], /NIV isn't confirmed/);
      await fails(as(publisher), "memory_admin_item_add", [fixed, j({ ...P("JHN", 3, 17), provider: provider("Synthetic.", [[3, 17]], "JHN.3.17") })], /outside service|isn't confirmed/);
      const nivDraft = (await db.raw<{ id: string }>("select id from memory.collections where title = 'Group NIV'"))[0].id;
      await db.raw("insert into memory.items (collection_id, passage_id, position) select $1, passage_id, 1 from memory.items where id = $2", [nivDraft, john]);
      await fails(as(publisher), "memory_admin_collection_status", [nivDraft, "publish", null], /NIV isn't confirmed for memory verses/);
      await fails(as(publisher), "memory_admin_collection_duplicate", [fixed, null], /NIV isn't confirmed/);
      // History is kept.
      const [{ n }] = await db.raw<{ n: number }>("select count(*)::int n from memory.attempts where profile_id = $1", [m1]);
      expect(n).toBeGreaterThan(0);
      // Restored permission resumes practice on the same cards.
      await permit(niv, true);
      expect((await rpc<Json>(as(m1), "memory_card", [card])).modes).toEqual(["flashcards", "self_check"]);
    });
  });

  describe("youth", () => {
    it("keeps licensed collections closed to youth accounts and out of youth assignments", async () => {
      const web1 = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "WEB for all", translation_id: web }), null]);
      await rpc(as(publisher), "memory_admin_item_add", [web1.id, j(P("JHN", 3, 16))]);
      await rpc(as(publisher), "memory_admin_collection_status", [web1.id, "publish", null]);
      const seen = await rpc<Json>(as(youthUser), "memory_collections");
      const ids = (seen.church as Json[]).map((c) => c.id);
      expect(ids).toContain(web1.id);
      expect(ids).not.toContain(fixed);
      await fails(as(youthUser), "memory_collection", [fixed], /not found/);
      await fails(as(youthUser), "memory_card_add", [j({ item_id: john })], /isn't available/);
      const [{ ok }] = await db.raw<{ ok: boolean }>(
        "select not exists (select 1 from memory.collections c where c.id = $1 and c.audience = 'members' and c.status = 'published' and not memory.licensed(c.translation_id)) ok",
        [fixed],
      );
      expect(ok).toBe(true);
    });
  });

  describe("public-domain collections", () => {
    it("work as before: stored text, all six activities, previews", async () => {
      const c = await rpc<Json>(as(publisher), "memory_admin_collection_save", [null, j({ title: "WEB verses", translation_id: web }), null]);
      const i = await rpc<Json>(as(publisher), "memory_admin_item_add", [c.id, j(P("JHN", 3, 16))]);
      expect(((i.passage as Json).verses as Json[]).length).toBe(1);
      expect(await rpc<Json>(as(publisher), "memory_admin_preview", [i.id, "missing_words", "guided", 0, false])).toMatchObject({ activity: "missing_words" });
      await rpc(as(publisher), "memory_admin_collection_status", [c.id, "publish", null]);
      const k = await rpc<Json>(as(m1), "memory_card_add", [j({ item_id: i.id })]);
      expect(k).toMatchObject({ provider: false });
      expect((k.modes as string[]).length).toBe(6);
      const s = await start(m1, k.id as string, "missing_words");
      expect(s.activity).toBe("missing_words");
    });
  });
});
