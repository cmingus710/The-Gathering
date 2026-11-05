import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_LIMITS, CATHOLIC_ONLINE, catalogMeta, normalizeCatalog, storedCatalogReport } from "../../src/lib/prayer/catalog";
import { TEST_DATABASE_URL, TestDb, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, "../..");

/**
 * The pinned Catholic Online catalogue, imported for real against a real
 * database, exactly as Admin → Prayer link catalogues does it: the dry run,
 * then begin → topics → rows in batches of 200 → one apply. It checks the
 * whole 2,304-prayer catalogue lands in its 111 topics, that members see
 * nothing until it is published, and that browsing, searching, filtering,
 * and paging work at that size.
 *
 * Nothing is fetched: the files under data/prayers/catholic-online/ are the
 * only input, and they carry no prayer text.
 */
type Json = Record<string, unknown>;
type LinkRow = { id: string; title: string; source_url: string; topics: Array<{ id: string; name: string }> };
type LinkPage = { items: LinkRow[]; total: number; has_more: boolean };
type Catalog = { id: string; name: string; count: number; topics: Array<{ id: string; name: string; count: number }> };

describeDb("catholic online catalogue import", () => {
  let db: TestDb;
  let admin: string;
  let alice: string;
  let catalogId: string;

  const bytes = readFileSync(path.join(ROOT, CATHOLIC_ONLINE.localPath));
  const coverageBytes = readFileSync(path.join(ROOT, CATHOLIC_ONLINE.coveragePath));
  const prepared = normalizeCatalog(JSON.parse(bytes.toString("utf8")), JSON.parse(coverageBytes.toString("utf8")), {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    coverageSha256: createHash("sha256").update(coverageBytes).digest("hex"),
  });

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const list = (opts: { q?: string | null; topic?: string | null; limit?: number; offset?: number } = {}) =>
    rpc<LinkPage>(as(alice), "prayer_link_list", [catalogId, opts.q ?? null, opts.topic ?? null, opts.limit ?? 50, opts.offset ?? 0]);

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await db.createAuthUser("co.admin@example.test", { fullName: "Synthetic Admin" });
    alice = await db.createAuthUser("co.alice@example.test", { fullName: "Alice Member" });
    await db.setStatus(admin, "approved");
    await db.setStatus(alice, "approved");
    await db.grantRole(admin, "super_admin");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("the dry run passes on the pinned files", () => {
    expect(prepared.report.ok).toBe(true);
    expect(prepared.report.problems).toEqual([]);
    expect(prepared.links).toHaveLength(2304);
    expect(prepared.topics).toHaveLength(111);
  });

  it("imports all 2,304 prayers into 111 topics, every one unpublished", async () => {
    const begun = await rpc<{ import_id: string; catalog_id: string }>(as(admin), "prayer_link_import_begin", [
      catalogMeta(),
      storedCatalogReport(prepared.report),
      prepared.links.length,
    ]);
    catalogId = begun.catalog_id;
    const staged = await rpc<number>(as(admin), "prayer_link_import_topics", [begun.import_id, JSON.stringify(prepared.topics)]);
    expect(staged).toBe(111);
    let rows = 0;
    for (let i = 0; i < prepared.links.length; i += CATALOG_LIMITS.batch) {
      rows += await rpc<number>(as(admin), "prayer_link_import_rows", [begun.import_id, JSON.stringify(prepared.links.slice(i, i + CATALOG_LIMITS.batch))]);
    }
    expect(rows).toBe(2304);
    const result = await rpc<Record<string, number>>(as(admin), "prayer_link_import_apply", [begun.import_id]);
    expect(result).toMatchObject({ staged: 2304, inserted: 2304, updated: 0, retired: 0, topics_added: 111, topics_archived: 0, total: 2304, published: 0 });

    const c = await rpc<{ name: string; status: string; counts: Json; topic_counts: Json }>(as(admin), "prayer_link_admin_catalog", [catalogId]);
    expect(c.name).toBe(CATHOLIC_ONLINE.name);
    expect(c.status).toBe("draft");
    expect(c.counts).toMatchObject({ total: 2304, published: 0, unpublished: 2304, retired: 0 });
    expect(c.topic_counts).toMatchObject({ active: 111, archived: 0 });
    // Every label the source gave is on a link.
    const [{ n }] = await db.raw<{ n: string }>("select count(*) as n from prayer.link_prayer_topics");
    expect(Number(n)).toBe(2304);
  }, 180_000);

  it("shows members nothing until it is published", async () => {
    expect(await rpc<Json[]>(as(alice), "prayer_link_catalogs")).toEqual([]);
  });

  it("publishes every link and the category, and members then browse all 2,304", async () => {
    expect(await rpc<{ changed: number }>(as(admin), "prayer_link_publish_all", [catalogId, null, true])).toEqual({ changed: 2304 });
    await rpc(as(admin), "prayer_link_catalog_status", [catalogId, "published"]);
    const shelves = await rpc<Catalog[]>(as(alice), "prayer_link_catalogs");
    expect(shelves).toHaveLength(1);
    expect(shelves[0]).toMatchObject({ name: CATHOLIC_ONLINE.name, count: 2304 });
    const detail = await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId]);
    expect(detail.topics).toHaveLength(111);
    expect(detail.topics.reduce((n, t) => n + t.count, 0)).toBe(2304);
    expect(detail.topics.find((t) => t.name === "Marian (Mary) Prayers")?.count).toBe(188);
    expect(detail.topics.find((t) => t.name === "en Español Prayers")?.count).toBe(91);
  }, 120_000);

  it("lists them alphabetically, 50 to a page, with a total", async () => {
    const first = await list();
    expect(first.total).toBe(2304);
    expect(first.has_more).toBe(true);
    expect(first.items).toHaveLength(50);
    const sorted = [...first.items].map((l) => l.title.toLowerCase()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(first.items.map((l) => l.title.toLowerCase())).toEqual(sorted);
    const last = await list({ offset: 2300 });
    expect([last.total, last.has_more, last.items.length]).toEqual([2304, false, 4]);
    // Every page together is every prayer, each one exactly once.
    const seen = new Set<string>();
    for (let offset = 0; offset < 2304; offset += 100) {
      const page = await list({ limit: 100, offset });
      for (const l of page.items) seen.add(l.id);
    }
    expect(seen.size).toBe(2304);
  }, 180_000);

  it("searches titles, topics, and the source's name, and filters by topic", async () => {
    const marian = (await rpc<Catalog>(as(alice), "prayer_link_catalog", [catalogId])).topics.find((t) => t.name === "Marian (Mary) Prayers")!;
    const filtered = await list({ topic: marian.id, limit: 100 });
    expect(filtered.total).toBe(188);
    expect(filtered.items.every((l) => l.topics.some((t) => t.id === marian.id))).toBe(true);
    const rosary = await list({ q: "rosary", limit: 100 });
    expect(rosary.total).toBeGreaterThan(10);
    expect(rosary.items.some((l) => /rosary/i.test(l.title) || l.topics.some((t) => /rosary/i.test(t.name)))).toBe(true);
    // A repaired title is searchable by its real spelling.
    const maria = await list({ q: "María" });
    expect(maria.items.some((l) => l.title.includes("María"))).toBe(true);
    // Combined: a search inside one topic.
    const both = await list({ q: "rosary", topic: marian.id, limit: 100 });
    expect(both.total).toBeLessThanOrEqual(rosary.total);
    expect(both.items.every((l) => l.topics.some((t) => t.id === marian.id))).toBe(true);
  }, 120_000);

  it("every link members see is one Catholic Online prayer page, and no text came with it", async () => {
    const page = await list({ limit: 100 });
    for (const l of page.items) {
      expect(l.source_url).toMatch(CATHOLIC_ONLINE.urlPattern);
      expect(Object.keys(l).sort()).toEqual(["id", "source_url", "title", "topics"]);
    }
    const [{ n }] = await db.raw<{ n: string }>(
      "select count(*) as n from information_schema.columns where table_schema = 'prayer' and table_name like 'link_%' and column_name in ('body', 'text', 'excerpt')",
    );
    expect(Number(n)).toBe(0);
  });

  it("a second import of the same files changes nothing but keeps everything published", async () => {
    const begun = await rpc<{ import_id: string }>(as(admin), "prayer_link_import_begin", [catalogMeta(), storedCatalogReport(prepared.report), prepared.links.length]);
    await rpc(as(admin), "prayer_link_import_topics", [begun.import_id, JSON.stringify(prepared.topics)]);
    for (let i = 0; i < prepared.links.length; i += CATALOG_LIMITS.batch) {
      await rpc(as(admin), "prayer_link_import_rows", [begun.import_id, JSON.stringify(prepared.links.slice(i, i + CATALOG_LIMITS.batch))]);
    }
    const result = await rpc<Record<string, number>>(as(admin), "prayer_link_import_apply", [begun.import_id]);
    expect(result).toMatchObject({ staged: 2304, inserted: 0, updated: 0, unchanged: 2304, retired: 0, restored: 0, topics_added: 0, topics_archived: 0, published: 2304 });
    expect((await list()).total).toBe(2304);
  }, 240_000);
});
