import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MORNING_EVENING, normalizeMorningEvening, type Reading } from "@/lib/devotionals/morning-evening";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Imported devotional collections (20261118000100) with the real pinned
 * Morning & Evening file: staging and the all-or-nothing apply, reruns that
 * create no duplicates and never overwrite an editor's correction, the read
 * rule (draft / hidden / audience / youth), search, direct links, the
 * caller's own time zone, My Journal reflections, no notices, and removal
 * that keeps members' journal text. Synthetic people only.
 */
type Json = Record<string, unknown>;

const bytes = readFileSync(path.resolve(__dirname, "../..", MORNING_EVENING.localPath));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const normalized = normalizeMorningEvening(JSON.parse(bytes.toString("utf8")), { sha256 });

const meta = {
  key: MORNING_EVENING.key,
  title: MORNING_EVENING.title,
  subtitle: MORNING_EVENING.subtitle,
  author: MORNING_EVENING.author,
  description: MORNING_EVENING.description,
  attribution: "Charles Spurgeon",
  rights: "public_domain",
  rights_statement: MORNING_EVENING.text.statement,
  text_source_url: MORNING_EVENING.text.url,
  upstream_url: MORNING_EVENING.text.upstream,
  source_repository: MORNING_EVENING.source.repository,
  source_commit: MORNING_EVENING.source.commit,
  source_path: MORNING_EVENING.source.path,
  source_sha256: MORNING_EVENING.source.sha256,
  source_license: MORNING_EVENING.source.license,
  source_license_notice: MORNING_EVENING.source.licenseNotice,
};

describeDb("devotional collections: Morning & Evening", () => {
  let db: TestDb;
  let admin: string;
  let publisher: string;
  let editor: string;
  let m1: string;
  let m2: string;
  let pending: string;
  let youth: string;
  let collection: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const j = (v: unknown) => JSON.stringify(v);
  const one = async <T = number>(sql: string, params: unknown[] = []) => Object.values((await db.raw(sql, params))[0])[0] as T;
  const reading = (key: string) => db.raw<{ id: string; body: string; revision: number }>("select id, body, revision from media.collection_readings where source_key = $1", [key]).then((r) => r[0]);
  const noticeCounts = () =>
    db.raw<Json>(`select (select count(*) from community.notifications)::int n, (select count(*) from community.email_outbox)::int e,
                         (select count(*) from community.push_outbox)::int p`).then((r) => r[0]);

  /** The same three calls the admin import action makes. */
  const runImport = async (actor: Actor, readings: Reading[], opts: { report?: Json; expected?: number; stop?: number } = {}) => {
    const begun = await rpc<{ import_id: string; collection_id: string }>(actor, "media_admin_collection_import_begin", [
      j(meta),
      j(opts.report ?? normalized.report),
      opts.expected ?? readings.length,
    ]);
    const rows = readings.slice(0, opts.stop ?? readings.length);
    for (let i = 0; i < rows.length; i += 200) await rpc(actor, "media_admin_collection_import_rows", [begun.import_id, j(rows.slice(i, i + 200))]);
    const result = await rpc<Json>(actor, "media_admin_collection_import_apply", [begun.import_id]);
    return { ...begun, result };
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, approve = true) => {
      const id = await db.createAuthUser(email, { fullName: email.split("@")[0] });
      if (approve) await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("me.admin@example.test");
    publisher = await mk("me.publisher@example.test");
    editor = await mk("me.editor@example.test");
    m1 = await mk("me.m1@example.test");
    m2 = await mk("me.m2@example.test");
    pending = await mk("me.pending@example.test", false);
    youth = await mk("me.youth@example.test");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(publisher, "content_publisher");
    await db.grantRole(editor, "content_editor");
    // A youth account (approved, account_kind youth): adult-only content stays closed to it.
    await db.raw("alter table public.profiles disable trigger user");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [youth]);
    await db.raw("alter table public.profiles enable trigger user");
  }, 120_000);
  afterAll(async () => db?.destroy());

  it("the dry run of the pinned file is complete: 732 readings, February 29 included", () => {
    expect(normalized.report.ok).toBe(true);
    expect(normalized.readings).toHaveLength(732);
  });

  it("only content publishers import; a failed dry run or a partial staging imports nothing", async () => {
    await expect(rpc(as(editor), "media_admin_collection_import_begin", [j(meta), j(normalized.report), 732])).rejects.toThrow(/permission/);
    await expect(rpc(as(m1), "media_admin_collection_import_begin", [j(meta), j(normalized.report), 732])).rejects.toThrow(/permission/);
    await expect(rpc(anon, "media_admin_collection_import_begin", [j(meta), j(normalized.report), 732])).rejects.toThrow(/permission denied/);
    await expect(rpc(as(publisher), "media_admin_collection_import_begin", [j(meta), j({ ...normalized.report, ok: false }), 732])).rejects.toThrow(/dry run reported problems/);

    // Only 400 of 732 staged: the apply refuses and nothing reaches the readings.
    await expect(runImport(as(publisher), normalized.readings, { stop: 400 })).rejects.toThrow(/Only 400 of 732 readings were staged/);
    expect(await one("select count(*)::int from media.collection_readings")).toBe(0);
    const [{ import_id }] = await db.raw<{ import_id: string }>("select id import_id from media.collection_imports where status = 'staging'");
    await rpc(as(publisher), "media_admin_collection_import_close", [import_id, "failed", "Only 400 of 732 readings were staged."]);
    expect(await one("select status from media.collection_imports where id = $1", [import_id])).toBe("failed");
    expect(await one("select count(*)::int from media.collection_import_rows where import_id = $1", [import_id])).toBe(0);

    // A malformed staged row is refused by the table's own checks.
    const bad = await rpc<{ import_id: string }>(as(publisher), "media_admin_collection_import_begin", [j(meta), j(normalized.report), 1]);
    await expect(rpc(as(publisher), "media_admin_collection_import_rows", [bad.import_id, j([{ source_key: "02-30-morning", month: 2, day: 30, slot: "morning", key_verse: "x", scripture_ref: "y", body: "z" }])])).rejects.toThrow(/import_rows_calendar|violates/);
    await rpc(as(publisher), "media_admin_collection_import_close", [bad.import_id, "discarded"]);
  });

  it("imports 732 readings into an unpublished, hidden collection, without a single notice", async () => {
    const before = await noticeCounts();
    const auditBefore = await one("select count(*)::int from public.audit_log");
    const { collection_id, result } = await runImport(as(publisher), normalized.readings);
    collection = collection_id;
    expect(result).toMatchObject({ staged: 732, inserted: 732, updated: 0, unchanged: 0, kept_edits: 0, conflicts: [], not_in_source: [], total: 732 });
    expect(await noticeCounts()).toEqual(before);
    // One audit entry for the import (the collection was created by an earlier attempt).
    expect(await one("select count(*)::int from public.audit_log") - auditBefore).toBe(1);
    expect(await one("select count(*)::int from media.collections")).toBe(1);
    const c = (await db.raw<Json>("select status, enabled, source_commit, source_sha256, rights from media.collections"))[0];
    expect(c).toEqual({ status: "draft", enabled: false, source_commit: MORNING_EVENING.source.commit, source_sha256: sha256, rights: "public_domain" });
    const coverage = await db.raw<Json>("select slot, count(*)::int n, count(distinct (month, day))::int days from media.collection_readings group by slot order by slot");
    expect(coverage).toEqual([
      { slot: "evening", n: 366, days: 366 },
      { slot: "morning", n: 366, days: 366 },
    ]);
    const jan1 = (await db.raw<Json>("select key_verse, scripture_ref, left(body, 60) b from media.collection_readings where source_key = '01-01-morning'"))[0];
    expect(jan1).toEqual({ key_verse: '"They did eat of the fruit of the land of Canaan that year."', scripture_ref: "Joshua 5:12", b: "Israel's weary wanderings were all over, and the promised re" });
    expect(await one("select count(*)::int from media.collection_readings where month = 2 and day = 29")).toBe(2);
  });

  it("keeps an unpublished collection away from members, search, direct links, and the journal", async () => {
    const id = (await reading("01-01-morning")).id;
    await expect(rpc(as(m1), "media_collection_day", [MORNING_EVENING.key, null, null])).rejects.toThrow(/Not found/);
    await expect(rpc(as(m1), "media_collection_reading", [id])).rejects.toThrow(/Not found/);
    await expect(rpc(as(m1), "media_collection_search", [MORNING_EVENING.key, "Canaan", 10, 0])).rejects.toThrow(/Not found/);
    expect((await rpc<{ collections: Json[] }>(as(m1), "media_collections")).collections).toEqual([]);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "", "x", j({ kind: "collection_reading", reading_id: id, reading_date: "2026-01-01" })])).rejects.toThrow(/can't be linked/);
    // Editors review it before publishing.
    const admin1 = await rpc<Json>(as(editor), "media_admin_collection", [collection]);
    expect(admin1).toMatchObject({ state: "draft", readings: 732, mornings: 366, evenings: 366, edited: 0 });
    await expect(rpc(as(editor), "media_admin_collection_status", [collection, "publish"])).rejects.toThrow(/permission/);
    await expect(rpc(as(m1), "media_admin_collection", [collection])).rejects.toThrow(/permission/);
  });

  it("a rerun of the same file changes nothing and creates no duplicates", async () => {
    const before = await db.raw<{ id: string }>("select id from media.collection_readings order by source_key");
    const { result } = await runImport(as(publisher), normalized.readings);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 732, kept_edits: 0, conflicts: [], total: 732 });
    expect(await db.raw<{ id: string }>("select id from media.collection_readings order by source_key")).toEqual(before);
    await expect(db.raw("insert into media.collection_readings (collection_id, source_key, month, day, slot, key_verse, scripture_ref, body, imported_key_verse, imported_scripture_ref, imported_body) values ($1, '01-01-morning', 1, 1, 'morning', '', '', 'x', '', '', 'x')", [collection])).rejects.toThrow(/duplicate key/);
  });

  it("never overwrites an editor's correction: a changed source is reported as a conflict", async () => {
    const edited = await reading("03-04-morning");
    const untouched = await reading("03-05-morning");
    const saved = await rpc<Json>(as(editor), "media_admin_collection_reading_save", [edited.id, '"My grace is sufficient for thee."', "2 Corinthians 12:9", edited.body.replace("ultimately spring", "ultimately spring (corrected)"), edited.revision]);
    expect(saved).toMatchObject({ changed: true, revision: 2 });
    // A stale revision is refused.
    await expect(rpc(as(editor), "media_admin_collection_reading_save", [edited.id, "x", "y", "z", 1])).rejects.toThrow(/changed this reading/);

    const changed = normalized.readings.map((r) =>
      r.source_key === "03-04-morning" || r.source_key === "03-05-morning" ? { ...r, body: `${r.body}\n\nNew upstream paragraph.` } : r,
    );
    const { import_id, result } = await runImport(as(publisher), changed);
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 730, kept_edits: 0, conflicts: ["03-04-morning"], total: 732 });
    expect((await reading("03-04-morning")).body).toContain("(corrected)");
    expect((await reading("03-04-morning")).body).not.toContain("New upstream paragraph.");
    expect((await reading("03-05-morning")).body).toContain("New upstream paragraph.");
    expect((await reading("03-05-morning")).id).toBe(untouched.id);
    const detail = await rpc<Json>(as(editor), "media_admin_collection_reading", [edited.id]);
    expect(detail).toMatchObject({ edited: true, incoming: { import_id } });
    expect((detail.revisions as Json[])[0]).toMatchObject({ revision: 1, replaced_by: "edit" });

    // Rerun with the original file: March 5 goes back to it; the March 4 correction is kept (its
    // source is again the text the correction was made on, so it's a kept edit, not a conflict).
    const back = await runImport(as(publisher), normalized.readings);
    expect(back.result).toMatchObject({ updated: 1, kept_edits: 1, conflicts: [] });
    expect((await reading("03-04-morning")).body).toContain("(corrected)");
  });

  it("publishes; members read today's readings in their own time zone, search, and open direct links", async () => {
    await rpc(as(publisher), "media_admin_collection_status", [collection, "publish"]);
    // m2 keeps readings on Pacific/Kiritimati time (UTC+14), m1 on the church's.
    await db.raw("insert into community.member_settings (profile_id, timezone) values ($1, 'Pacific/Kiritimati') on conflict (profile_id) do update set timezone = excluded.timezone", [m2]);
    const tzToday = (tz: string) => one<string>("select to_char((now() at time zone $1)::date, 'YYYY-MM-DD')", [tz]);
    const church = await one<string>("select coalesce((select timezone from public.church_settings), 'America/Chicago')");

    for (const [who, tz] of [[m1, church], [m2, "Pacific/Kiritimati"]] as const) {
      const list = await rpc<{ today: string; collections: Array<{ key: string; title: string; subtitle: string; today: Json[] }> }>(as(who), "media_collections");
      expect(list.today).toBe(await tzToday(tz));
      expect(list.collections).toHaveLength(1);
      expect(list.collections[0]).toMatchObject({ key: "morning-evening", title: "Morning & Evening", subtitle: "Daily readings by Charles Spurgeon" });
      const [y, m, d] = list.today.split("-").map(Number);
      expect(list.collections[0].today.map((r) => r.slot)).toEqual(["morning", "evening"]);
      expect(list.collections[0].today[0]).toMatchObject({ id: (await reading(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}-morning`)).id });
      expect(y).toBeGreaterThan(2000);
    }

    const day = await rpc<Json>(as(m1), "media_collection_day", [MORNING_EVENING.key, "2026-12-31", "evening"]);
    expect(day).toMatchObject({ date: "2026-12-31", slot: "evening", reading: { source_key: "12-31-evening", label: "December 31 · Evening" }, leap_day: null });
    expect(await rpc<Json>(as(m1), "media_collection_day", [MORNING_EVENING.key, "2027-01-01", "morning"])).toMatchObject({ reading: { source_key: "01-01-morning" } });
    // Leap years: February 29 is its own day in 2028, and offered beside February 28 in 2027.
    expect(await rpc<Json>(as(m1), "media_collection_day", [MORNING_EVENING.key, "2028-02-29", "morning"])).toMatchObject({ reading: { source_key: "02-29-morning" }, leap_day: null });
    const feb28 = await rpc<{ reading: Json; leap_day: Json[] }>(as(m1), "media_collection_day", [MORNING_EVENING.key, "2027-02-28", "evening"]);
    expect(feb28.reading).toMatchObject({ source_key: "02-28-evening" });
    expect(feb28.leap_day.map((r) => r.slot)).toEqual(["morning", "evening"]);
    expect((await rpc<Json>(as(m1), "media_collection_day", [MORNING_EVENING.key, "2028-02-28", "evening"])).leap_day).toBeNull();

    const search = await rpc<{ total: number; items: Json[] }>(as(m1), "media_collection_search", [MORNING_EVENING.key, "land of Canaan", 10, 0]);
    expect(search.total).toBeGreaterThan(0);
    expect(search.items[0]).toMatchObject({ month: 1, day: 1, slot: "morning", label: "January 1 · Morning", scripture_ref: "Joshua 5:12" });
    expect(String(search.items[0].snippet)).toMatch(/land of Canaan/i);
    expect((await rpc<{ total: number }>(as(m1), "media_collection_search", [MORNING_EVENING.key, "100%_", 10, 0])).total).toBe(0);
    expect((await rpc<{ total: number }>(as(m1), "media_collection_search", [MORNING_EVENING.key, "Psalm 39:12", 10, 0])).total).toBeGreaterThan(0);

    const direct = await rpc<Json>(as(m1), "media_collection_reading", [(await reading("03-16-morning")).id]);
    expect(direct).toMatchObject({ reading: { key_verse: '"I am a stranger with thee."', scripture_ref: "Psalm 39:12" }, collection: { key: "morning-evening", rights: "public_domain", source: { commit: MORNING_EVENING.source.commit } } });

    for (const who of [pending, youth]) {
      await expect(rpc(as(who), "media_collection_day", [MORNING_EVENING.key, null, null])).rejects.toThrow(/approved members/);
    }
    await expect(rpc(anon, "media_collections")).rejects.toThrow(/permission denied/);
    await expect(rpc(anon, "media_collection_reading", [(await reading("01-01-morning")).id])).rejects.toThrow(/permission denied/);
  });

  it("member reads work the way PostgREST calls them (stable functions run read-only)", async () => {
    const id = (await reading("01-01-morning")).id;
    const calls: Array<[string, unknown[]]> = [
      ["media_collections", []],
      ["media_collection_day", [MORNING_EVENING.key, "2026-01-01", "morning"]],
      ["media_collection_reading", [id]],
      ["media_collection_search", [MORNING_EVENING.key, "Canaan", 5, 0]],
      ["journal_reading_reflection", [id, "2026-01-01"]],
    ];
    for (const [fn, args] of calls) {
      const [{ volatile }] = await db.raw<{ volatile: string }>("select provolatile volatile from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn]);
      await db.client.query("begin");
      try {
        if (volatile !== "v") await db.client.query("set transaction read only");
        await db.client.query("set local role authenticated");
        await db.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: m1, role: "authenticated" })]);
        await db.client.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args);
      } finally {
        await db.client.query("rollback");
      }
    }
  });

  it("a live collection's readings are corrected by publishers only; the correction applies to every year", async () => {
    const r = await reading("01-02-morning");
    await expect(rpc(as(editor), "media_admin_collection_reading_save", [r.id, "x", "Colossians 4:2", r.body, r.revision])).rejects.toThrow(/content publisher corrects/);
    await rpc(as(publisher), "media_admin_collection_reading_save", [r.id, '"Continue in prayer."', "Colossians 4:2", `${r.body} `, r.revision]);
    // Trailing spaces only: no change, no revision.
    expect((await reading("01-02-morning")).revision).toBe(r.revision);
    const fixed = await rpc<Json>(as(publisher), "media_admin_collection_reading_save", [r.id, '"Continue in prayer."', "Colossians 4:2", r.body.replace("prayer", "prayer"), r.revision]);
    expect(fixed).toMatchObject({ changed: false });
    for (const date of ["2026-01-02", "2031-01-02"]) {
      expect(await rpc<Json>(as(m1), "media_collection_day", [MORNING_EVENING.key, date, "morning"])).toMatchObject({ reading: { id: r.id } });
    }
    // Restore the imported text of the edited March 4 reading.
    const edited = await reading("03-04-morning");
    await rpc(as(publisher), "media_admin_collection_reading_restore", [edited.id, edited.revision, null]);
    expect((await reading("03-04-morning")).body).not.toContain("(corrected)");
    expect((await reading("03-04-morning")).id).toBe(edited.id);
  });

  it("links one private reflection per reading and date, kept distinct across years", async () => {
    const r = await reading("01-01-morning");
    const leap = await reading("02-29-evening");
    const link = (date: string, id = r.id) => j({ kind: "collection_reading", reading_id: id, reading_date: date });
    const e1 = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "New Year", "My reflection", link("2026-01-01")]);
    expect(e1.link).toMatchObject({ kind: "collection_reading", available: true, reading_id: r.id, reading_date: "2026-01-01", label: "January 1 · Morning", title: "Morning & Evening", collection_key: "morning-evening" });
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "", "again", link("2026-01-01")])).rejects.toThrow(/already have a reflection/);
    expect(await rpc(as(m1), "journal_reading_reflection", [r.id, "2026-01-01"])).toBe(e1.id);
    expect(await rpc(as(m1), "journal_reading_reflection", [r.id, "2027-01-01"])).toBeNull();
    const e2 = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "", "A year later", link("2027-01-01")]);
    expect(e2.id).not.toBe(e1.id);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "", "x", link("2026-01-02")])).rejects.toThrow(/doesn't match/);
    // The February 29 reading in a common year is dated February 28; in a leap year, February 29.
    await rpc(as(m1), "journal_entry_create", [randomUUID(), "", "Leap", link("2027-02-28", leap.id)]);
    await rpc(as(m1), "journal_entry_create", [randomUUID(), "", "Leap", link("2028-02-29", leap.id)]);
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "", "x", link("2028-02-28", leap.id)])).rejects.toThrow(/doesn't match/);
    // Private: another member sees neither the entry nor that it exists.
    await expect(rpc(as(m2), "journal_entry", [e1.id])).rejects.toThrow(/not found/i);
    expect(await rpc(as(m2), "journal_reading_reflection", [r.id, "2026-01-01"])).toBeNull();
    expect(await rpc<Json[]>(as(m2), "journal_linked", [j({ collection_reading_id: r.id })])).toEqual([]);
    const mine = await rpc<Json[]>(as(m1), "journal_linked", [j({ collection_reading_id: r.id, reading_date: "2027-01-01" })]);
    expect(mine.map((x) => x.id)).toEqual([e2.id]);
    // Staff have no path to it either.
    await expect(rpc(as(admin), "journal_entry", [e1.id])).rejects.toThrow(/not found/i);
    expect(await one("select count(*)::int from public.audit_log where details::text like '%My reflection%'")).toBe(0);
  });

  it("hiding removes discovery and access; reflections keep their text and say the reading is unavailable", async () => {
    const r = await reading("01-01-morning");
    const [{ id: entry }] = await db.raw<{ id: string }>("select id from journal.entries where profile_id = $1 and reading_date = '2026-01-01'", [m1]);
    await rpc(as(publisher), "media_admin_collection_status", [collection, "hide"]);
    expect((await rpc<{ collections: Json[] }>(as(m1), "media_collections")).collections).toEqual([]);
    await expect(rpc(as(m1), "media_collection_reading", [r.id])).rejects.toThrow(/Not found/);
    await expect(rpc(as(m1), "media_collection_search", [MORNING_EVENING.key, "Canaan", 10, 0])).rejects.toThrow(/Not found/);
    const e = await rpc<Json>(as(m1), "journal_entry", [entry]);
    expect(e).toMatchObject({ body: "My reflection", link: { kind: "collection_reading", available: false, reading_id: null, title: null, label: null, scripture_ref: null, reading_date: "2026-01-01" } });
    await expect(rpc(as(m1), "journal_entry_create", [randomUUID(), "", "x", j({ kind: "collection_reading", reading_id: r.id, reading_date: "2028-01-01" })])).rejects.toThrow(/can't be linked/);
    await rpc(as(publisher), "media_admin_collection_status", [collection, "show"]);
    expect((await rpc<Json>(as(m1), "journal_entry", [entry])).link).toMatchObject({ available: true, reading_id: r.id });
  });

  it("a group collection is for that group's members only", async () => {
    const group = await rpc<string>(as(admin), "community_group_save", [j({ name: "Synthetic Readers", summary: "s", about: "a", visibility: "discoverable", leader_id: admin })]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, m2]);
    const c = await rpc<Json>(as(publisher), "media_admin_collection", [collection]);
    await rpc(as(publisher), "media_admin_collection_save", [collection, j({ title: c.title, subtitle: c.subtitle, description: c.description, audience: "group", group_id: group })]);
    await expect(rpc(as(m1), "media_collection_day", [MORNING_EVENING.key, null, null])).rejects.toThrow(/Not found/);
    expect(await rpc<Json>(as(m2), "media_collection_day", [MORNING_EVENING.key, null, "morning"])).toMatchObject({ slot: "morning" });
    await expect(rpc(as(editor), "media_admin_collection_save", [collection, j({ title: c.title, audience: "members" })])).rejects.toThrow(/content publisher/);
    await rpc(as(publisher), "media_admin_collection_save", [collection, j({ title: c.title, subtitle: c.subtitle, description: c.description, audience: "members" })]);
  });

  it("church devotionals keep working beside the collection", async () => {
    const id = (await rpc<Json>(as(publisher), "media_admin_item_save", [null, j({ kind: "devotional", title: "Church devotional", devotional_on: "2026-10-01", body: "Text" }), null])).id;
    await rpc(as(publisher), "media_admin_item_status", [id, "publish", null, null, null]);
    expect(await rpc<Json>(as(m1), "media_devotional_day", ["2026-10-01"])).toMatchObject({ item: { id, title: "Church devotional" } });
    const e = await rpc<Json>(as(m1), "journal_entry_create", [randomUUID(), "", "note", j({ kind: "devotional", media_item_id: id })]);
    expect(e.link).toMatchObject({ kind: "devotional", available: true, item_id: id });
  });

  it("removal is scoped to the collection, needs it hidden and its key typed, and keeps journal text", async () => {
    await expect(rpc(as(publisher), "media_admin_collection_remove", [collection, MORNING_EVENING.key])).rejects.toThrow(/Hide the collection first/);
    await rpc(as(publisher), "media_admin_collection_status", [collection, "hide"]);
    await expect(rpc(as(editor), "media_admin_collection_remove", [collection, MORNING_EVENING.key])).rejects.toThrow(/permission/);
    await expect(rpc(as(publisher), "media_admin_collection_remove", [collection, "yes"])).rejects.toThrow(/Type morning-evening/);
    const items = await one("select count(*)::int from media.items");
    const entries = await one("select count(*)::int from journal.entries");
    const removed = await rpc<Json>(as(publisher), "media_admin_collection_remove", [collection, MORNING_EVENING.key]);
    expect(removed).toEqual({ readings: 732 });
    expect(await one("select count(*)::int from media.collection_readings")).toBe(0);
    expect(await one("select count(*)::int from media.collection_imports")).toBe(0);
    expect(await one("select count(*)::int from media.items")).toBe(items);
    expect(await one("select count(*)::int from journal.entries")).toBe(entries);
    const kept = await db.raw<Json>("select body, link_kind, collection_reading_id, reading_date::text d from journal.entries where profile_id = $1 and link_kind = 'collection_reading' order by reading_date", [m1]);
    expect(kept.map((k) => [k.body, k.collection_reading_id])).toEqual([
      ["My reflection", null],
      ["A year later", null],
      ["Leap", null],
      ["Leap", null],
    ]);
  });
});
