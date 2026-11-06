import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, service, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Prayer Library link catalogues (20261130000100) against a real database:
 * the staged import (begin → topics → rows → apply) with its all-or-nothing
 * checks; imported links arriving unpublished so members see nothing until a
 * settings manager publishes; what members may read (published catalogues,
 * topics and links only) and the searching, filtering, and paging they get;
 * who may manage and import (settings.manage only — members, prayer
 * moderators, youth, pending, suspended, and signed-out accounts refused);
 * a re-import keeping publishing decisions, archiving dropped topics, and
 * retiring links the source no longer lists; the audit records; and that
 * members' own library prayers, their collections, and prayer requests are
 * untouched. Every person, prayer, and address here is synthetic.
 */
type Json = Record<string, unknown>;
type LinkRow = { id: string; title: string; source_url: string; topics: Array<{ id: string; name: string }>; is_published?: boolean; retired?: boolean; source_id?: string };
type LinkPage = { items: LinkRow[]; total: number; has_more: boolean };
type Catalog = {
  id: string;
  key: string;
  name: string;
  description: string;
  source_name: string;
  count: number;
  rights_statement: string;
  topics?: Array<{ id: string; name: string; count: number; source_url: string | null }>;
};
type AdminCatalog = Omit<Catalog, "topics"> & {
  status: string;
  archived_at: string | null;
  counts: { total: number; published: number; unpublished: number; retired: number };
  topic_counts: { active: number; archived: number };
  topics: Array<{ id: string; name: string; archived: boolean; total: number; published: number }>;
  imports: Array<{ id: string; status: string; result: Json | null; error: string | null }>;
};

const KEY = "synthetic-source";
const META = {
  key: KEY,
  name: "Synthetic Source Prayers",
  description: "A synthetic catalogue for tests.",
  source_name: "Synthetic Source",
  source_url: "https://example.test/prayers/",
  rights_statement: "Titles, labels, and links only.",
  source_path: "data/prayers/synthetic/prayers.json",
  source_sha256: "a".repeat(64),
};
const OK_REPORT = { ok: true, counts: { links: 0 } };

const topic = (name: string, order: number) => ({ name, source_url: `https://example.test/prayers/?s=${order}`, sort_order: order * 10 });
const link = (n: number, title: string, topics: string[]) => ({
  source_id: `synthetic-${n}`,
  title,
  source_url: `https://example.test/prayers/prayer.php?p=${n}`,
  topics,
});

describeDb("prayer link catalogue", () => {
  let db: TestDb;
  let admin: string; // super administrator (settings.manage)
  let mod: string; // prayer moderator, no settings.manage
  let alice: string; // approved adult member
  let pending: string;
  let suspended: string;
  let kid: string; // youth account
  let catalogId: string;
  let topics: Record<string, string>; // name → id

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

  /** One whole import, as the admin action runs it. */
  const runImport = async (
    who: string,
    links: ReturnType<typeof link>[],
    topicRows: ReturnType<typeof topic>[],
    opts: { expected?: number; skipApply?: boolean; batch?: number } = {},
  ) => {
    const begun = await rpc<{ import_id: string; catalog_id: string }>(as(who), "prayer_link_import_begin", [
      META,
      { ...OK_REPORT, counts: { links: links.length } },
      opts.expected ?? links.length,
    ]);
    await rpc<number>(as(who), "prayer_link_import_topics", [begun.import_id, JSON.stringify(topicRows)]);
    const batch = opts.batch ?? 200;
    for (let i = 0; i < links.length; i += batch) {
      await rpc<number>(as(who), "prayer_link_import_rows", [begun.import_id, JSON.stringify(links.slice(i, i + batch))]);
    }
    if (opts.skipApply) return { ...begun, result: null as Json | null };
    const result = await rpc<Json>(as(who), "prayer_link_import_apply", [begun.import_id]);
    return { ...begun, result };
  };

  const adminCatalog = (who: string, id = catalogId) => rpc<AdminCatalog>(as(who), "prayer_link_admin_catalog", [id]);
  const adminList = (who: string, opts: { q?: string | null; topic?: string | null; state?: string; limit?: number; offset?: number } = {}) =>
    rpc<LinkPage>(as(who), "prayer_link_admin_list", [catalogId, opts.q ?? null, opts.topic ?? null, opts.state ?? "all", opts.limit ?? 200, opts.offset ?? 0]);
  const list = (who: string, opts: { q?: string | null; topic?: string | null; limit?: number; offset?: number } = {}) =>
    rpc<LinkPage>(as(who), "prayer_link_list", [catalogId, opts.q ?? null, opts.topic ?? null, opts.limit ?? 100, opts.offset ?? 0]);
  const titles = async (who: string, opts: Parameters<typeof list>[1] = {}) => (await list(who, opts)).items.map((l) => l.title);
  const publishAll = (who: string, opts: { topic?: string | null; on?: boolean } = {}) =>
    rpc<{ changed: number }>(as(who), "prayer_link_publish_all", [catalogId, opts.topic ?? null, opts.on ?? true]);
  const auditCount = async (action: string) =>
    Number((await db.raw<{ n: string }>("select count(*) as n from public.audit_log where action = $1", [action]))[0].n);

  const SEED_TOPICS = [topic("Morning Prayers", 1), topic("Marian (Mary) Prayers", 2), topic("en Español Prayers", 3)];
  const SEED_LINKS = [
    link(1, "A Morning Offering", ["Morning Prayers"]),
    link(2, "Ave María", ["Marian (Mary) Prayers", "en Español Prayers"]),
    link(3, "Benedictus", ["Morning Prayers"]),
    link(4, "Memorare", ["Marian (Mary) Prayers"]),
    link(5, "Oración de la mañana", ["en Español Prayers", "Morning Prayers"]),
  ];

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, status: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (status !== "pending") await db.setStatus(id, "approved");
      if (status === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("lc.admin@example.test", "Synthetic Admin");
    mod = await mk("lc.mod@example.test", "Synthetic Moderator");
    alice = await mk("lc.alice@example.test", "Alice Member");
    pending = await mk("lc.pending@example.test", "Pending Person", "pending");
    suspended = await mk("lc.suspended@example.test", "Suspended Person", "suspended");
    kid = await mk("lc.kid@example.test", "Kit Young");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [kid]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(mod, "prayer_moderator");

    const imported = await runImport(admin, SEED_LINKS, SEED_TOPICS);
    catalogId = imported.catalog_id;
    expect(imported.result).toMatchObject({ staged: 5, inserted: 5, updated: 0, retired: 0, topics_added: 3, published: 0 });
    const c = await adminCatalog(admin);
    topics = Object.fromEntries(c.topics.map((t) => [t.name, t.id]));
  });

  afterAll(async () => {
    await db?.destroy();
  });

  // --- the import ---------------------------------------------------------

  it("creates the catalogue as a draft, with every link unpublished", async () => {
    const c = await adminCatalog(admin);
    expect(c).toMatchObject({
      key: KEY,
      name: META.name,
      source_name: META.source_name,
      rights_statement: META.rights_statement,
      status: "draft",
      counts: { total: 5, published: 0, unpublished: 5, retired: 0 },
      topic_counts: { active: 3, archived: 0 },
    });
    expect(c.imports[0]).toMatchObject({ status: "applied" });
    expect(await auditCount("prayer.link_catalog_created")).toBe(1);
    expect(await auditCount("prayer.link_imported")).toBe(1);
  });

  it("keeps the source's topics, labels, and addresses", async () => {
    const c = await adminCatalog(admin);
    expect(c.topics.map((t) => t.name)).toEqual(["Morning Prayers", "Marian (Mary) Prayers", "en Español Prayers"]);
    expect(c.topics.map((t) => t.total)).toEqual([3, 2, 2]);
    const rows = await adminList(admin);
    expect(rows.total).toBe(5);
    expect(rows.items.map((l) => l.title)).toEqual(["A Morning Offering", "Ave María", "Benedictus", "Memorare", "Oración de la mañana"]);
    expect(rows.items.find((l) => l.title === "Ave María")?.topics.map((t) => t.name).sort()).toEqual(["Marian (Mary) Prayers", "en Español Prayers"]);
    expect(rows.items.every((l) => l.is_published === false && l.retired === false)).toBe(true);
    expect(rows.items.find((l) => l.source_id === "synthetic-1")?.source_url).toBe("https://example.test/prayers/prayer.php?p=1");
  });

  it("stores no prayer text: the link tables have no body column", async () => {
    const cols = await db.raw<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'prayer' and table_name in ('link_prayers', 'link_import_rows')",
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("body");
    expect(names).not.toContain("text");
    expect(names).toContain("source_url");
  });

  it("refuses an import whose dry run reported problems, or whose rows went missing", async () => {
    await fails(as(admin), "prayer_link_import_begin", [META, { ok: false }, 5], /dry run reported problems/i);
    const staged = await runImport(admin, SEED_LINKS.slice(0, 2), SEED_TOPICS, { expected: 5, skipApply: true });
    await fails(as(admin), "prayer_link_import_apply", [staged.import_id], /Only 2 of 5/);
    await rpc(as(admin), "prayer_link_import_close", [staged.import_id, "discarded", "Test cleanup."]);
    // Nothing changed: the catalogue still holds its five links.
    expect((await adminList(admin)).total).toBe(5);
  });

  it("refuses a link whose topic was never staged", async () => {
    const begun = await rpc<{ import_id: string }>(as(admin), "prayer_link_import_begin", [META, OK_REPORT, 1]);
    await rpc(as(admin), "prayer_link_import_topics", [begun.import_id, JSON.stringify([topic("Morning Prayers", 1)])]);
    await rpc(as(admin), "prayer_link_import_rows", [begun.import_id, JSON.stringify([link(9, "A stray prayer", ["Unlisted Prayers"])])]);
    await fails(as(admin), "prayer_link_import_apply", [begun.import_id], /topics that were not staged/i);
    await rpc(as(admin), "prayer_link_import_close", [begun.import_id, "discarded", "Test cleanup."]);
    expect((await adminList(admin)).total).toBe(5);
  });

  it("lets only settings managers import", async () => {
    for (const who of [alice, mod, kid, pending, suspended]) {
      await fails(as(who), "prayer_link_import_begin", [META, OK_REPORT, 1]);
    }
    await fails(anon, "prayer_link_import_begin", [META, OK_REPORT, 1]);
    await fails(service, "prayer_link_import_begin", [META, OK_REPORT, 1]);
  });

  // --- what members can see ----------------------------------------------

  it("shows members nothing while the catalogue is a draft", async () => {
    expect(await rpc<Json[]>(as(alice), "prayer_link_catalogs")).toEqual([]);
    await fails(as(alice), "prayer_link_catalog", [catalogId], /wasn't found/i);
    await fails(as(alice), "prayer_link_list", [catalogId, null, null, 50, 0], /wasn't found/i);
  });

  it("refuses to publish a catalogue with no published link", async () => {
    await fails(as(admin), "prayer_link_catalog_status", [catalogId, "published"], /at least one prayer link/i);
  });

  it("publishes links and the catalogue, and then members see both", async () => {
    expect(await publishAll(admin)).toEqual({ changed: 5 });
    expect(await publishAll(admin)).toEqual({ changed: 0 }); // idempotent
    const c = await rpc<AdminCatalog>(as(admin), "prayer_link_catalog_status", [catalogId, "published"]);
    expect(c.status).toBe("published");
    expect(c.counts).toMatchObject({ published: 5, unpublished: 0 });

    const shelves = await rpc<Catalog[]>(as(alice), "prayer_link_catalogs");
    expect(shelves).toHaveLength(1);
    expect(shelves[0]).toMatchObject({ id: catalogId, name: META.name, count: 5, source_name: META.source_name, rights_statement: META.rights_statement });
    const detail = await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId]);
    expect(detail.topics?.map((t) => [t.name, t.count])).toEqual([
      ["Morning Prayers", 3],
      ["Marian (Mary) Prayers", 2],
      ["en Español Prayers", 2],
    ]);
    expect(detail.topics?.[0].source_url).toBe("https://example.test/prayers/?s=1");
  });

  it("lists links alphabetically, with their topics and their address", async () => {
    const page = await list(alice);
    expect(page.total).toBe(5);
    expect(page.has_more).toBe(false);
    expect(page.items.map((l) => l.title)).toEqual(["A Morning Offering", "Ave María", "Benedictus", "Memorare", "Oración de la mañana"]);
    expect(page.items[0].source_url).toBe("https://example.test/prayers/prayer.php?p=1");
    expect(Object.keys(page.items[0]).sort()).toEqual(["id", "source_url", "title", "topics"]);
  });

  it("filters by one topic and searches titles, topics, and the source's name", async () => {
    expect(await titles(alice, { topic: topics["Morning Prayers"] })).toEqual(["A Morning Offering", "Benedictus", "Oración de la mañana"]);
    expect(await titles(alice, { q: "morning" })).toEqual(["A Morning Offering", "Benedictus", "Oración de la mañana"]);
    expect(await titles(alice, { q: "benedic" })).toEqual(["Benedictus"]); // prefix
    expect(await titles(alice, { q: "Synthetic Source" })).toHaveLength(5); // the source's name
    expect(await titles(alice, { q: "memorare", topic: topics["Morning Prayers"] })).toEqual([]); // combined
    expect(await titles(alice, { q: "the" })).toEqual([]); // only stop words: falls back to the title
    expect(await titles(alice, { q: "!& |" })).toEqual([]); // query syntax is never interpreted
  });

  it("pages with a total", async () => {
    const first = await list(alice, { limit: 2 });
    expect([first.total, first.has_more, first.items.length]).toEqual([5, true, 2]);
    const last = await list(alice, { limit: 2, offset: 4 });
    expect([last.total, last.has_more, last.items.map((l) => l.title)]).toEqual([5, false, ["Oración de la mañana"]]);
    await fails(as(alice), "prayer_link_list", [catalogId, null, "00000000-0000-0000-0000-000000000000", 50, 0], /topic wasn't found/i);
  });

  it("refuses youth, pending, suspended, and signed-out readers", async () => {
    for (const who of [kid, pending, suspended]) {
      await fails(as(who), "prayer_link_catalogs", []);
      await fails(as(who), "prayer_link_list", [catalogId, null, null, 50, 0]);
    }
    await fails(anon, "prayer_link_catalogs", []);
    await fails(anon, "prayer_link_list", [catalogId, null, null, 50, 0]);
  });

  it("keeps the tables themselves closed to every API role", async () => {
    for (const table of ["link_catalogs", "link_topics", "link_prayers", "link_prayer_topics", "link_imports", "link_import_rows", "link_import_topics"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [{ ok }] = await db.raw<{ ok: boolean }>("select has_table_privilege($1, $2, 'select') as ok", [role, `prayer.${table}`]);
        expect(ok, `${role} can read prayer.${table}`).toBe(false);
      }
      const [{ rls }] = await db.raw<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`prayer.${table}`]);
      expect(rls, `RLS off on prayer.${table}`).toBe(true);
    }
    for (const fn of ["prayer.link_count(uuid, uuid)", "prayer.link_visible_catalog(uuid)", "prayer.link_reindex_catalog(uuid)", "prayer.link_catalog_admin_json(prayer.link_catalogs)"]) {
      const [{ ok }] = await db.raw<{ ok: boolean }>("select has_function_privilege('authenticated', $1, 'execute') as ok", [fn]);
      expect(ok, `authenticated can call ${fn}`).toBe(false);
    }
    for (const fn of ["public.prayer_link_catalogs()", "public.prayer_link_list(uuid, text, uuid, integer, integer)"]) {
      const [{ ok }] = await db.raw<{ ok: boolean }>("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
      expect(ok, `anon can call ${fn}`).toBe(false);
    }
  });

  // --- managing -----------------------------------------------------------

  it("unpublishes one link, and members stop seeing it", async () => {
    const target = (await adminList(admin, { q: "memorare" })).items[0];
    expect(await rpc(as(admin), "prayer_link_set_published", [[target.id], false])).toEqual({ changed: 1 });
    expect(await titles(alice)).not.toContain("Memorare");
    expect((await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId])).count).toBe(4);
    expect(await rpc(as(admin), "prayer_link_set_published", [[target.id], true])).toEqual({ changed: 1 });
    expect(await titles(alice)).toContain("Memorare");
  });

  it("publishes and unpublishes one topic at a time", async () => {
    expect(await publishAll(admin, { topic: topics["Marian (Mary) Prayers"], on: false })).toEqual({ changed: 2 });
    expect(await titles(alice)).toEqual(["A Morning Offering", "Benedictus", "Oración de la mañana"]);
    const detail = await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId]);
    expect(detail.topics?.map((t) => t.name)).toEqual(["Morning Prayers", "en Español Prayers"]); // Marian holds nothing published
    expect(detail.topics?.find((t) => t.name === "en Español Prayers")?.count).toBe(1);
    expect(await publishAll(admin, { topic: topics["Marian (Mary) Prayers"], on: true })).toEqual({ changed: 2 });
    expect(await titles(alice)).toHaveLength(5);
  });

  it("renames and describes a catalogue, and refuses a name another one has", async () => {
    const saved = await rpc<AdminCatalog>(as(admin), "prayer_link_catalog_save", [catalogId, "  Synthetic   Source Prayers ", "Now with a longer description.", 20]);
    expect(saved).toMatchObject({ name: "Synthetic Source Prayers", description: "Now with a longer description.", sort_order: 20 });
    await fails(as(admin), "prayer_link_catalog_save", [catalogId, "x", ""], /at least 2 characters|The name/i);
    await fails(as(admin), "prayer_link_catalog_save", [catalogId, "Synthetic Source Prayers", "x".repeat(501)], /500 characters/i);
    expect(await auditCount("prayer.link_catalog_saved")).toBeGreaterThan(0);
  });

  it("archives a topic, which leaves the member filters and the links' labels", async () => {
    const id = topics["en Español Prayers"];
    expect(await rpc(as(admin), "prayer_link_topic_archive", [id, true])).toEqual({ id, archived: true });
    const detail = await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId]);
    expect(detail.topics?.map((t) => t.name)).toEqual(["Morning Prayers", "Marian (Mary) Prayers"]);
    expect((await list(alice)).items.find((l) => l.title === "Ave María")?.topics.map((t) => t.name)).toEqual(["Marian (Mary) Prayers"]);
    await fails(as(alice), "prayer_link_list", [catalogId, null, id, 50, 0], /topic wasn't found/i);
    // The links themselves are untouched.
    expect((await adminList(admin)).total).toBe(5);
    expect(await rpc(as(admin), "prayer_link_topic_archive", [id, false])).toEqual({ id, archived: false });
    expect((await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId])).topics).toHaveLength(3);
  });

  it("archives the catalogue, and members stop seeing it", async () => {
    await rpc(as(admin), "prayer_link_catalog_status", [catalogId, "archived"]);
    expect(await rpc<Json[]>(as(alice), "prayer_link_catalogs")).toEqual([]);
    await fails(as(alice), "prayer_link_catalog", [catalogId], /wasn't found/i);
    const c = await rpc<AdminCatalog>(as(admin), "prayer_link_catalog_status", [catalogId, "published"]);
    expect([c.status, c.archived_at]).toEqual(["published", null]);
    expect((await rpc<Catalog[]>(as(alice), "prayer_link_catalogs"))).toHaveLength(1);
  });

  it("lets only settings managers manage", async () => {
    const target = (await adminList(admin, { limit: 1 })).items[0];
    for (const who of [alice, mod, kid, pending, suspended]) {
      await fails(as(who), "prayer_link_admin_catalogs", []);
      await fails(as(who), "prayer_link_admin_catalog", [catalogId]);
      await fails(as(who), "prayer_link_admin_list", [catalogId, null, null, "all", 50, 0]);
      await fails(as(who), "prayer_link_catalog_save", [catalogId, "Taken over", ""]);
      await fails(as(who), "prayer_link_catalog_status", [catalogId, "draft"]);
      await fails(as(who), "prayer_link_set_published", [[target.id], false]);
      await fails(as(who), "prayer_link_publish_all", [catalogId, null, false]);
      await fails(as(who), "prayer_link_topic_archive", [topics["Morning Prayers"], true]);
    }
    await fails(anon, "prayer_link_admin_catalogs", []);
    // Nothing above changed anything.
    expect((await adminCatalog(admin)).counts).toMatchObject({ published: 5, total: 5 });
  });

  it("reviews by state and searches in the admin list", async () => {
    const target = (await adminList(admin, { q: "benedictus" })).items[0];
    await rpc(as(admin), "prayer_link_set_published", [[target.id], false]);
    expect((await adminList(admin, { state: "unpublished" })).items.map((l) => l.title)).toEqual(["Benedictus"]);
    expect((await adminList(admin, { state: "published" })).total).toBe(4);
    expect((await adminList(admin, { state: "retired" })).total).toBe(0);
    await fails(as(admin), "prayer_link_admin_list", [catalogId, null, null, "nonsense", 50, 0], /valid list/i);
    await rpc(as(admin), "prayer_link_set_published", [[target.id], true]);
  });

  // --- re-importing -------------------------------------------------------

  it("re-imports: keeps publishing decisions, updates titles, archives dropped topics, retires missing links", async () => {
    const unpublished = (await adminList(admin, { q: "memorare" })).items[0];
    await rpc(as(admin), "prayer_link_set_published", [[unpublished.id], false]);

    const result = await runImport(
      admin,
      [
        link(1, "A Morning Offering (revised)", ["Morning Prayers"]), // title changed
        link(2, "Ave María", ["Marian (Mary) Prayers"]), // dropped a topic
        link(4, "Memorare", ["Marian (Mary) Prayers"]), // still unpublished afterwards
        link(6, "A new evening prayer", ["Evening Prayers"]), // new link, new topic
      ],
      [topic("Morning Prayers", 1), topic("Marian (Mary) Prayers", 2), topic("Evening Prayers", 4)],
    );
    expect(result.result).toMatchObject({ staged: 4, inserted: 1, updated: 1, retired: 2, topics_added: 1, topics_archived: 1 });

    const c = await adminCatalog(admin);
    expect(c.counts).toMatchObject({ total: 6, retired: 2 });
    expect(c.topics.find((t) => t.name === "en Español Prayers")?.archived).toBe(true);
    expect(c.topics.find((t) => t.name === "Evening Prayers")?.published).toBe(0);
    // Publishing decisions survived: Memorare still unpublished, the rest still published, the new one unpublished.
    expect((await adminList(admin, { state: "published" })).items.map((l) => l.title)).toEqual(["A Morning Offering (revised)", "Ave María"]);
    expect((await adminList(admin, { state: "unpublished" })).items.map((l) => l.title)).toEqual(["A new evening prayer", "Memorare"]);
    expect((await adminList(admin, { state: "retired" })).items.map((l) => l.title)).toEqual(["Benedictus", "Oración de la mañana"]);
    // Retired links are gone from the member list and can't be published.
    expect(await titles(alice)).toEqual(["A Morning Offering (revised)", "Ave María"]);
    const retired = (await adminList(admin, { state: "retired" })).items[0];
    expect(await rpc(as(admin), "prayer_link_set_published", [[retired.id], true])).toEqual({ changed: 0 });
    // Labels follow the source: Ave María lost its second topic.
    expect((await list(alice)).items.find((l) => l.title === "Ave María")?.topics.map((t) => t.name)).toEqual(["Marian (Mary) Prayers"]);
    // Search follows the new title.
    expect(await titles(alice, { q: "revised" })).toEqual(["A Morning Offering (revised)"]);
  });

  it("brings a retired link back when the source lists it again", async () => {
    const before = (await adminList(admin, { state: "retired" })).total;
    expect(before).toBeGreaterThan(0);
    const result = await runImport(
      admin,
      [
        link(1, "A Morning Offering (revised)", ["Morning Prayers"]),
        link(2, "Ave María", ["Marian (Mary) Prayers"]),
        link(3, "Benedictus", ["Morning Prayers"]),
        link(4, "Memorare", ["Marian (Mary) Prayers"]),
        link(6, "A new evening prayer", ["Evening Prayers"]),
      ],
      [topic("Morning Prayers", 1), topic("Marian (Mary) Prayers", 2), topic("Evening Prayers", 4)],
    );
    expect(result.result).toMatchObject({ restored: 1, retired: 0, inserted: 0 });
    // It comes back with the publishing decision it had when it was retired
    // (Benedictus was published then, so members see it again at once).
    expect((await adminList(admin, { state: "retired" })).items.map((l) => l.title)).toEqual(["Oración de la mañana"]);
    expect((await adminList(admin, { state: "published" })).items.map((l) => l.title)).toContain("Benedictus");
    expect(await titles(alice)).toContain("Benedictus");
  });

  it("allows only one import in progress at a time", async () => {
    const first = await rpc<{ import_id: string }>(as(admin), "prayer_link_import_begin", [META, OK_REPORT, 1]);
    const second = await rpc<{ import_id: string }>(as(admin), "prayer_link_import_begin", [META, OK_REPORT, 1]);
    expect(second.import_id).not.toBe(first.import_id);
    await fails(as(admin), "prayer_link_import_rows", [first.import_id, JSON.stringify([link(7, "Stale", ["Morning Prayers"])])], /isn't open/i);
    await rpc(as(admin), "prayer_link_import_close", [second.import_id, "discarded", "Test cleanup."]);
    const [{ n }] = await db.raw<{ n: string }>("select count(*) as n from prayer.link_imports where status = 'staging'");
    expect(Number(n)).toBe(0);
  });

  // --- the rest of prayer is untouched ------------------------------------

  it("leaves members' own library prayers, collections, and requests alone", async () => {
    const meta = await rpc<{ collections: Array<{ id: string; is_general: boolean }> }>(as(alice), "prayer_library_meta");
    const general = meta.collections.find((c) => c.is_general)!.id;
    const prayerId = await rpc<string>(as(alice), "prayer_library_save", [
      null,
      "A synthetic member prayer",
      "Synthetic words of prayer.",
      "original",
      null,
      null,
      [],
      [],
      true,
      null,
      general,
    ]);
    const page = await rpc<{ items: Array<{ id: string; title: string }> }>(as(alice), "prayer_library_list", ["library", null, null, null, null, null, null, 50, null]);
    expect(page.items.map((p) => p.id)).toEqual([prayerId]);
    // Catalogue links never appear in the library's own list or search.
    expect(page.items.map((p) => p.title)).not.toContain("Ave María");
    const searched = await rpc<{ items: Array<{ title: string }> }>(as(alice), "prayer_library_list", ["library", "Ave", null, null, null, null, null, 50, null]);
    expect(searched.items).toEqual([]);
    const [{ n }] = await db.raw<{ n: string }>("select count(*) as n from prayer.requests");
    expect(Number(n)).toBe(0);
  });

  it("sends no notifications and keeps no prayer text in the audit log", async () => {
    const [{ n }] = await db.raw<{ n: string }>("select count(*) as n from community.notifications");
    expect(Number(n)).toBe(0);
    const rows = await db.raw<{ details: Json }>("select details from public.audit_log where action like 'prayer.link%'");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(JSON.stringify(row.details)).not.toMatch(/example\.test\/prayers\/prayer\.php/);
  });
});
