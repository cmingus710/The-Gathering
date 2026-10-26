import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Scripture highlights (20261126000100) against a real database: all six
 * colors, single verses and ranges, overlaps, recoloring and removing part
 * of a range, repeated saves without duplicates, stale saves refused
 * instead of overwriting, translation-specific versification, the grouped
 * "Scripture Highlights" view in My Journal (filters, sorts, the last verse
 * removed), two-member isolation (and no administrator path), licensed
 * versions kept to references only, and memory verses left alone.
 *
 * Every verse is synthetic ("Synthetic verse 3:16."), and so is every person.
 */
type Json = Record<string, unknown>;
type Row = { verse: number; color: string; revision: number; updated_at: string };

describeDb("Scripture highlights", () => {
  let db: TestDb;
  let m1: string;
  let m2: string;
  let admin: string;
  let pending: string;
  let syn: string; // stored text, John 3 has 20 verses
  let alt: string; // stored text, John 3 has 18 verses (its own versification)
  let lic: string; // licensed API version, reference versification

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = (who: string, fn: string, args: unknown[], message: RegExp) => expect(rpc(as(who), fn, args)).rejects.toThrow(message);
  const j = (v: unknown) => JSON.stringify(v);
  const mk = async (email: string, status: "approved" | "pending" = "approved") => {
    const id = await db.createAuthUser(email, { fullName: email.split("@")[0] });
    await db.setStatus(id, status);
    return id;
  };
  const apply = (who: string, p: Json) => rpc<{ status: string; changed: number; highlights: Row[] }>(as(who), "bible_highlight_apply", [j(p)]);
  const chapter = (who: string, tr: string, book = "JHN", ch = 3) => rpc<Row[]>(as(who), "bible_highlights", [tr, book, ch]);
  const expectedOf = (rows: Row[], verses: number[]) => Object.fromEntries(verses.map((v) => [v, rows.find((r) => r.verse === v)?.revision ?? 0]));
  const colors = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.verse, r.color]));
  const passages = (who: string, p: Json = {}) =>
    rpc<{ total: number; items: Array<Json & { label: string; color: string; verses: Array<{ verse: number; revision: number }> }>; translations: Json[]; colors: string[] }>(
      as(who),
      "bible_highlight_passages",
      [j(p)],
    );

  const stored = async (code: string, chapters: Array<[string, number, number]>) => {
    const id = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
       values ($1, $1 || ' synthetic', 'Synthetic test text.', 'None', 'public_domain', now(), 'draft', 1) returning id`,
      [code],
    ))[0].id;
    let n = 0;
    for (const [book, ch, last] of chapters) {
      for (let v = 1; v <= last; v++, n++) {
        await db.raw("insert into bible.verses (translation_id, book_code, chapter, verse, text) values ($1, $2, $3, $4, $5)", [id, book, ch, v, `Synthetic verse ${ch}:${v}.`]);
      }
    }
    await db.raw("update bible.translations set verse_count = $2, status = 'active' where id = $1", [id, n]);
    return id;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    m1 = await mk("hl.m1@example.test");
    m2 = await mk("hl.m2@example.test");
    admin = await mk("hl.admin@example.test");
    await db.grantRole(admin, "super_admin");
    pending = await mk("hl.pending@example.test", "pending");
    syn = await stored("SYN", [["JHN", 3, 20], ["JHN", 4, 6], ["PSA", 23, 6], ["GEN", 1, 5]]);
    alt = await stored("ALT", [["JHN", 3, 18]]);
    await db.raw("update bible.settings set default_translation_id = $1", [syn]);
    lic = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days)
       values ('LIC', 'Licensed synthetic', 'api', 'api_bible', 'abc123', 'API_BIBLE_KEY', 'licensed', now(), 'active', true, 1) returning id`,
    ))[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("applies each of the six colors and reads it back", async () => {
    const names = ["yellow", "green", "blue", "pink", "purple", "orange"];
    for (const [i, color] of names.entries()) {
      // Orange recolors verse 5 (expected: purple's revision).
      const rows = await chapter(m1, syn, "GEN", 1);
      const verse = i === 5 ? 5 : i + 1;
      const r = await apply(m1, { translation_id: syn, book: "GEN", chapter: 1, verses: [verse], color, expected: expectedOf(rows, [verse]) });
      expect(r.status).toBe("saved");
    }
    expect(colors(await chapter(m1, syn, "GEN", 1))).toEqual({ 1: "yellow", 2: "green", 3: "blue", 4: "pink", 5: "orange" });
    await fails(m1, "bible_highlight_apply", [j({ translation_id: syn, book: "GEN", chapter: 1, verses: [1], color: "red" })], /Choose a highlight color/);
    await apply(m1, { translation_id: syn, book: "GEN", chapter: 1, verses: [1, 2, 3, 4, 5], color: null });
    expect(await chapter(m1, syn, "GEN", 1)).toEqual([]);
  });

  it("handles ranges, overlaps, partial recolor, and partial removal with one row per verse", async () => {
    let rows = (await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [14, 15, 16, 17], color: "yellow", expected: {} })).highlights;
    expect(colors(rows)).toEqual({ 14: "yellow", 15: "yellow", 16: "yellow", 17: "yellow" });
    // Overlapping selection, partly highlighted and partly not.
    rows = (await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [16, 17, 18], color: "green", expected: expectedOf(rows, [16, 17, 18]) })).highlights;
    expect(colors(rows)).toEqual({ 14: "yellow", 15: "yellow", 16: "green", 17: "green", 18: "green" });
    // Removing part of a range removes only those verses.
    rows = (await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [15, 16], color: null, expected: expectedOf(rows, [15, 16]) })).highlights;
    expect(colors(rows)).toEqual({ 14: "yellow", 17: "green", 18: "green" });
    const count = await db.raw<{ n: string }>("select count(*) n from bible.highlights where profile_id = $1 and book_code = 'JHN' and chapter = 3", [m1]);
    expect(Number(count[0].n)).toBe(3);
    // Ranges must be contiguous and in this translation's chapter.
    await fails(m1, "bible_highlight_apply", [j({ translation_id: syn, book: "JHN", chapter: 3, verses: [1, 3], color: "blue" })], /range of verses/);
    await fails(m1, "bible_highlight_apply", [j({ translation_id: syn, book: "JHN", chapter: 3, verses: [], color: "blue" })], /range of verses/);
    await fails(m1, "bible_highlight_apply", [j({ translation_id: syn, book: "JHN", chapter: 3, verses: [21], color: "blue" })], /Choose verses in this chapter/);
  });

  it("keeps the first-highlighted time and moves the revision only on a real change", async () => {
    const before = await chapter(m1, syn);
    const v17 = before.find((r) => r.verse === 17)!;
    const created = (await db.raw<{ c: string }>("select created_at::text c from bible.highlights where profile_id = $1 and translation_id = $2 and chapter = 3 and verse = 17", [m1, syn]))[0].c;
    const same = await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [17], color: "green", expected: { 17: v17.revision } });
    expect(same).toMatchObject({ status: "saved", changed: 0 });
    expect(same.highlights.find((r) => r.verse === 17)!.revision).toBe(v17.revision);
    const re = await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [17], color: "purple", expected: { 17: v17.revision } });
    expect(re.highlights.find((r) => r.verse === 17)!.revision).toBeGreaterThan(v17.revision);
    const after = (await db.raw<{ c: string }>("select created_at::text c from bible.highlights where profile_id = $1 and translation_id = $2 and chapter = 3 and verse = 17", [m1, syn]))[0].c;
    expect(after).toBe(created);
  });

  it("refuses a save made from an older view instead of overwriting, and accepts a retried save", async () => {
    const view = await chapter(m1, syn);
    // "Another device" recolors verse 18.
    await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [18], color: "blue", expected: expectedOf(view, [18]) });
    // The first device, still on the older view, tries to remove 17–18.
    const stale = await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [17, 18], color: null, expected: expectedOf(view, [17, 18]) });
    expect(stale.status).toBe("conflict");
    expect(colors(stale.highlights)).toMatchObject({ 17: "purple", 18: "blue" });
    // A save whose response was lost, sent again: the verse already has
    // that state, so it succeeds without another change.
    const fresh = await chapter(m1, syn);
    const first = await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [19, 20], color: "pink", expected: expectedOf(fresh, [19, 20]) });
    expect(first).toMatchObject({ status: "saved", changed: 2 });
    const retry = await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [19, 20], color: "pink", expected: expectedOf(fresh, [19, 20]) });
    expect(retry).toMatchObject({ status: "saved", changed: 0 });
    const n = await db.raw<{ n: string }>("select count(*) n from bible.highlights where profile_id = $1 and translation_id = $2 and verse in (19, 20) and chapter = 3", [m1, syn]);
    expect(Number(n[0].n)).toBe(2);
  });

  it("serializes two devices saving at once: the second sees the first and changes nothing", async () => {
    const view = await chapter(m1, syn, "JHN", 4);
    const body = (color: string) => j({ translation_id: syn, book: "JHN", chapter: 4, verses: [1, 2], color, expected: expectedOf(view, [1, 2]) });
    const [a, b] = [await db.connect(), await db.connect()];
    const begin = async (c: typeof a) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [j({ sub: m1, role: "authenticated" })]);
    };
    try {
      await begin(a);
      await begin(b);
      const first = (await a.query("select public.bible_highlight_apply($1::jsonb) r", [body("green")])).rows[0].r;
      expect(first.status).toBe("saved");
      // b waits for a's chapter lock, then checks against a's result.
      const second = b.query("select public.bible_highlight_apply($1::jsonb) r", [body("blue")]);
      await new Promise((r) => setTimeout(r, 200));
      await a.query("commit");
      const r2 = (await second).rows[0].r;
      await b.query("commit");
      expect(r2.status).toBe("conflict");
      expect(colors(r2.highlights)).toEqual({ 1: "green", 2: "green" });
    } finally {
      await a.end();
      await b.end();
    }
    expect(colors(await chapter(m1, syn, "JHN", 4))).toEqual({ 1: "green", 2: "green" });
    await apply(m1, { translation_id: syn, book: "JHN", chapter: 4, verses: [1, 2], color: null });
  });

  it("keeps translations apart and validates each against its own verses", async () => {
    await apply(m1, { translation_id: alt, book: "JHN", chapter: 3, verses: [16], color: "orange", expected: {} });
    expect(colors(await chapter(m1, alt))).toEqual({ 16: "orange" });
    expect(colors(await chapter(m1, syn))[16]).toBeUndefined();
    // ALT's John 3 ends at verse 18; SYN's has 20.
    await fails(m1, "bible_highlight_apply", [j({ translation_id: alt, book: "JHN", chapter: 3, verses: [19], color: "blue" })], /Choose verses in this chapter/);
    // A licensed version uses the reference versification (John 3 has 36).
    const r = await apply(m1, { translation_id: lic, book: "JHN", chapter: 3, verses: [35, 36], color: "blue", expected: {} });
    expect(colors(r.highlights)).toEqual({ 35: "blue", 36: "blue" });
    await fails(m1, "bible_highlight_apply", [j({ translation_id: lic, book: "JHN", chapter: 3, verses: [37], color: "blue" })], /Choose verses in this chapter/);
  });

  it("stores references and colors only, never scripture text", async () => {
    const cols = await db.raw<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'bible' and table_name = 'highlights' order by column_name",
    );
    expect(cols.map((c) => c.column_name)).toEqual(["book_code", "chapter", "color", "created_at", "profile_id", "revision", "translation_id", "updated_at", "verse"]);
    const dump = j(await db.raw("select * from bible.highlights"));
    expect(dump).not.toMatch(/Synthetic verse/);
  });

  it("groups adjacent verses into passages for My Journal, with filters and sorts", async () => {
    // m1 now has (JHN 3, SYN): 14 yellow; 17 purple; 18 blue; 19–20 pink.
    await apply(m1, { translation_id: syn, book: "PSA", chapter: 23, verses: [1, 2, 3], color: "green", expected: {} });
    const all = await passages(m1);
    const labels = all.items.map((i) => `${i.label} ${(i.translation as Json).code} ${i.color}`);
    expect(labels[0]).toBe("Psalm 23:1–3 SYN green"); // most recent first
    expect(labels).toEqual(
      expect.arrayContaining(["John 3:14 SYN yellow", "John 3:17 SYN purple", "John 3:18 SYN blue", "John 3:19–20 SYN pink", "John 3:16 ALT orange", "John 3:35–36 LIC blue"]),
    );
    expect(all.total).toBe(7);
    expect(all.items[0].verses.map((v) => v.verse)).toEqual([1, 2, 3]);
    const bible = await passages(m1, { sort: "bible", translation_id: syn });
    expect(bible.items.map((i) => i.label)).toEqual(["Psalm 23:1–3", "John 3:14", "John 3:17", "John 3:18", "John 3:19–20"]);
    expect((await passages(m1, { color: "blue" })).items.map((i) => `${i.label} ${(i.translation as Json).code}`).sort()).toEqual(["John 3:18 SYN", "John 3:35–36 LIC"]);
    expect((await passages(m1, { ref: { book: "JHN", sc: 3, sv: 18, ec: 3, ev: 19 }, translation_id: syn })).items.map((i) => i.label).sort()).toEqual(["John 3:18", "John 3:19–20"]);
    expect((await passages(m1, { ref: { book: "PSA" } })).items.map((i) => i.label)).toEqual(["Psalm 23:1–3"]);
    expect((await passages(m1, { limit: 2, offset: 0 })).items).toHaveLength(2);
    expect(all.translations.map((t) => t.code)).toEqual(["ALT", "LIC", "SYN"]);
    expect(all.colors).toEqual(expect.arrayContaining(["blue", "green", "orange", "pink", "purple", "yellow"]));
    await fails(m1, "bible_highlight_passages", [j({ color: "red" })], /Choose a highlight color/);
    await fails(m1, "bible_highlight_passages", [j({ sort: "random" })], /sort order/);
  });

  it("follows changes made from either place, and drops a passage when its last verse is removed", async () => {
    const psalm = (await passages(m1, { ref: { book: "PSA" } })).items[0];
    const expected = Object.fromEntries(psalm.verses.map((v) => [v.verse, v.revision]));
    // Recolor from My Journal: the reader sees it.
    await apply(m1, { translation_id: syn, book: "PSA", chapter: 23, verses: [1, 2, 3], color: "orange", expected });
    expect(colors(await chapter(m1, syn, "PSA", 23))).toEqual({ 1: "orange", 2: "orange", 3: "orange" });
    // Part removed in the reader: the journal shows the rest.
    const rows = await chapter(m1, syn, "PSA", 23);
    await apply(m1, { translation_id: syn, book: "PSA", chapter: 23, verses: [2], color: null, expected: expectedOf(rows, [2]) });
    expect((await passages(m1, { ref: { book: "PSA" } })).items.map((i) => i.label)).toEqual(["Psalm 23:1", "Psalm 23:3"]);
    // The last verses removed: gone from the collection.
    await apply(m1, { translation_id: syn, book: "PSA", chapter: 23, verses: [1, 2, 3], color: null });
    expect((await passages(m1, { ref: { book: "PSA" } })).total).toBe(0);
  });

  it("is private: other members, administrators, pending accounts, and anonymous callers get nothing", async () => {
    expect(await chapter(m2, syn)).toEqual([]);
    expect((await passages(m2)).total).toBe(0);
    expect((await passages(admin)).total).toBe(0);
    expect(await chapter(admin, syn)).toEqual([]);
    // m2's own changes never touch m1's rows.
    await apply(m2, { translation_id: syn, book: "JHN", chapter: 3, verses: [14], color: null });
    await apply(m2, { translation_id: syn, book: "JHN", chapter: 3, verses: [17], color: "yellow" });
    expect(colors(await chapter(m1, syn))).toMatchObject({ 14: "yellow", 17: "purple" });
    expect(colors(await chapter(m2, syn))).toEqual({ 17: "yellow" });
    await fails(pending, "bible_highlight_apply", [j({ translation_id: syn, book: "JHN", chapter: 3, verses: [1], color: "blue" })], /Only approved members/);
    await fails(pending, "bible_highlight_passages", [j({})], /Only approved members/);
    await expect(db.query(anon, "select public.bible_highlight_passages('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(db.query(anon, "select public.bible_highlight_apply('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(db.query(as(admin), "select * from bible.highlights")).rejects.toThrow(/permission denied/);
    await expect(db.query(as(m1), "select bible.highlight_rows($1, $2, 'JHN', 3)", [m2, syn])).rejects.toThrow(/permission denied/);
    // A suspended member keeps the data but can't reach it until reinstated.
    await db.setStatus(m2, "suspended");
    await fails(m2, "bible_highlights", [syn, "JHN", 3], /Only approved members/);
    await db.setStatus(m2, "approved");
    expect(colors(await chapter(m2, syn))).toEqual({ 17: "yellow" });
  });

  it("follows the reader's existing youth rule: an active youth account keeps its own private highlights", async () => {
    const youthUser = await mk("hl.youth@example.test");
    // Test setup stands in for the youth and family process (synthetic).
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youthUser]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.raw(
      `insert into youth.policies (version, status, title, settings, approval_reference, approved_at)
       values (1, 'approved', 'Synthetic policy', '{"independent_accounts": true}', 'Synthetic approval', now())`,
    );
    await db.raw("insert into youth.children (display_name, account_id) values ('Synthetic Youth', $1)", [youthUser]);
    await apply(youthUser, { translation_id: syn, book: "JHN", chapter: 3, verses: [1], color: "green" });
    expect(colors(await chapter(youthUser, syn))).toEqual({ 1: "green" });
    expect((await passages(youthUser)).total).toBe(1);
    // Not visible to anyone else, including the administrator.
    expect(colors(await chapter(m1, syn))[1]).toBeUndefined();
    expect((await passages(admin)).total).toBe(0);
  });

  it("lets a member remove (but not add) highlights in a retired translation", async () => {
    await db.raw("update bible.translations set status = 'retired' where id = $1", [alt]);
    const item = (await passages(m1, { translation_id: alt })).items[0];
    expect(item).toMatchObject({ label: "John 3:16", translation: { code: "ALT", available: false } });
    await fails(m1, "bible_highlight_apply", [j({ translation_id: alt, book: "JHN", chapter: 3, verses: [15], color: "blue" })], /isn't available/);
    const r = await apply(m1, { translation_id: alt, book: "JHN", chapter: 3, verses: [16], color: null, expected: { 16: item.verses[0].revision } });
    expect(r).toMatchObject({ status: "saved", changed: 1 });
    await db.raw("update bible.translations set status = 'active' where id = $1", [alt]);
  });

  it("leaves memory verses and their progress alone when highlights change", async () => {
    const card = await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: syn, book: "JHN", sc: 3, sv: 14, ec: 3, ev: 14 })]);
    // Adding the same passage again opens the same card, never a duplicate.
    const again = await rpc<Json>(as(m1), "memory_card_add", [j({ translation_id: syn, book: "JHN", sc: 3, sv: 14, ec: 3, ev: 14 })]);
    expect(again.id).toBe(card.id);
    await db.raw("update memory.cards set sessions = 3 where id = $1", [card.id]);
    await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [14], color: null });
    const k = await db.raw<{ status: string; sessions: number }>("select status, sessions from memory.cards where id = $1", [card.id]);
    expect(k[0]).toEqual({ status: "active", sessions: 3 });
    // And removing the memory verse leaves highlights in place.
    await apply(m1, { translation_id: syn, book: "JHN", chapter: 3, verses: [14], color: "yellow" });
    await rpc(as(m1), "memory_card_remove", [card.id, "remove", null]);
    expect(colors(await chapter(m1, syn))[14]).toBe("yellow");
  });

  it("keeps journal entries when highlights are removed", async () => {
    const entry = await rpc<Json>(as(m1), "journal_entry_create", [
      randomUUID(),
      "Synthetic reflection",
      "Synthetic note.",
      j({ kind: "passage", translation_id: syn, book: "JHN", chapter: 3, start_verse: 14, end_verse: 14 }),
    ]);
    await rpc(as(m1), "bible_annotations_clear", ["highlights", "highlights"]);
    expect(await chapter(m1, syn)).toEqual([]);
    const still = await rpc<Json>(as(m1), "journal_entry", [entry.id]);
    expect(still).toMatchObject({ title: "Synthetic reflection", body: "Synthetic note." });
  });
});
