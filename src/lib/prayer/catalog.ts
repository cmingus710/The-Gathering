/**
 * Prayer link catalogs: a pinned list of prayers that live on someone else's
 * site, shown in the Prayer Library as titles, topic labels, and a link out.
 *
 * Nothing here holds a prayer's words. The catalogue records a title, the
 * topic labels the source lists it under, and the address of the page it is
 * on; members open the prayer on the source's own site. That is deliberate:
 * the church has no right to reproduce these texts, and this file's
 * `rights_statement` says so on every catalogue it creates.
 *
 * The first catalogue is Catholic Online (`CATHOLIC_ONLINE`), pinned under
 * `data/prayers/catholic-online/`. `normalizeCatalog` reads that pair of
 * files, repairs what is wrong in them, and reports everything it did or
 * could not do; the import refuses to run unless the report is `ok`. The
 * database is still the authority on who may import, publish, or read
 * (`prayer_link_*`); this file only prepares and describes the data.
 */

/** What the pinned Catholic Online catalogue is, and where it came from. */
export const CATHOLIC_ONLINE = {
  /** Stable key: the catalogue is created once and re-imported under this key. */
  key: "catholic-online",
  /** The prayer category members see in the Prayer Library. */
  name: "Catholic Online Prayers",
  description:
    "Prayers published by Catholic Online, listed by their own topics. Each one opens on catholic.org: the prayers' words stay on their site.",
  sourceName: "Catholic Online",
  sourceUrl: "https://www.catholic.org/prayers/",
  rightsStatement:
    "Titles, topic labels, and links only. The prayers' texts are not copied, stored, or shown here; they remain on catholic.org, and no right to reproduce them is claimed.",
  /** The pinned files, relative to the repository root. */
  localPath: "data/prayers/catholic-online/prayers.json",
  coveragePath: "data/prayers/catholic-online/coverage.json",
  /** SHA-256 of `prayers.json` as pinned (the dry run and the import check it). */
  sha256: "22410d8d8d9bde19b8f0985bab52886da64448b8c7b072a44e97c0bb4f60eb02",
  coverageSha256: "a156d718655bb938ee9ca69edeaed25ac9f483289be0c815b74fdfc3b384ba3c",
  /** When the catalogue was collected, from the source's own README. */
  collectedOn: "2026-11-05",
  /** Every link's `source_id` looks like this, and must agree with its address. */
  idPattern: /^catholic-online-(\d+)$/,
  urlPattern: /^https:\/\/www\.catholic\.org\/prayers\/prayer\.php\?p=(\d+)$/,
  topicUrlPattern: /^https:\/\/www\.catholic\.org\/prayers\/prayer\.php\?s=\d+$/,
} as const;

/** Hard limits the database also enforces (20261130000100). */
export const CATALOG_LIMITS = { title: 200, url: 500, topicName: 80, topicsPerLink: 10, links: 20000, batch: 200 } as const;

export type CatalogLink = {
  /** The source's own stable id, for de-duplication and later re-imports. */
  source_id: string;
  title: string;
  source_url: string;
  /** The source's topic labels, exactly as it lists them. */
  topics: string[];
};

/** A topic label as the source lists it, with the page it was collected from. */
export type CatalogTopic = { name: string; source_url: string | null; sort_order: number };

export type CatalogReport = {
  /** False when something below blocks the import; `problems` says what. */
  ok: boolean;
  source: {
    name: string;
    url: string;
    path: string;
    sha256: string;
    sha256_matches: boolean;
    coverage_sha256: string | null;
    coverage_matches: boolean | null;
    collected_on: string;
  };
  counts: { records: number; links: number; topics: number; topic_links: number; topics_without_links: number };
  /** What the normalizer changed, and why each is safe (see docs/prayer-catalog.md). */
  corrections: { mojibake: number; whitespace: number; nbsp: number };
  /** A few repaired titles, before and after, so a reviewer can check them. */
  samples: Array<{ source_id: string; from: string; to: string }>;
  /** Each source category: what it said it held, and how many links carry it. */
  coverage: Array<{ topic: string; source_url: string | null; extracted_count: number | null; linked_count: number }>;
  problems: string[];
  warnings: string[];
};

export type NormalizedCatalog = { links: CatalogLink[]; topics: CatalogTopic[]; report: CatalogReport };

/**
 * Windows code page 1250, bytes 0x80–0xFF. The pinned titles were written by
 * decoding UTF-8 bytes through this code page ("María" became "MarĂ­a"), so
 * encoding them back through it and reading the bytes as UTF-8 restores the
 * original letters. U+FFFD marks the five byte values the code page leaves
 * undefined; a text containing U+FFFD itself is never repaired.
 */
const CP1250_HIGH =
  "€�‚�„…†‡�‰Š‹ŚŤŽŹ�‘’“”•–—�™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙";

function cp1250Byte(ch: string): number | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return code;
  if (ch === "�") return null;
  const i = CP1250_HIGH.indexOf(ch);
  return i < 0 ? null : 0x80 + i;
}

/**
 * Restores a title that was mis-decoded through code page 1250, and leaves
 * every other text exactly as it is.
 *
 * It only tries when the text holds a character that stands for a byte a
 * UTF-8 sequence can start with (0xC2–0xF4) — so correctly written text such
 * as "Español" is never touched — and only keeps the result when the bytes
 * are valid UTF-8 (a strict decoder, so nothing is guessed).
 */
export function repairMojibake(text: string): string {
  if (!/[^\u0000-\u007f]/.test(text)) return text;
  const bytes: number[] = [];
  let lead = false;
  for (const ch of text) {
    const b = cp1250Byte(ch);
    if (b === null) return text;
    if (b >= 0xc2 && b <= 0xf4) lead = true;
    bytes.push(b);
  }
  if (!lead) return text;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

/** Collapses runs of whitespace (no-break spaces included) to single spaces. */
function tidy(text: string): string {
  return text.replace(/[\s ​﻿]+/g, " ").trim();
}

type RawLink = { source_id?: unknown; title?: unknown; source_url?: unknown; categories?: unknown; source_name?: unknown; content_type?: unknown };
type RawCoverage = { category?: unknown; url?: unknown; error?: unknown; extracted_count?: unknown };

/**
 * Reads the pinned files into the rows the import stages, and reports what it
 * found. Writes nothing and connects to nothing.
 *
 * It refuses (`ok: false`) on anything it cannot vouch for: a file of the
 * wrong shape, a record missing a title or address, an address that isn't one
 * of the source's prayer pages, an id that disagrees with its address, a
 * duplicate id, a topic label the coverage file doesn't list, or a category
 * the source reported an error for. Order is by title, then id, so a re-run
 * stages the same rows in the same order.
 */
export function normalizeCatalog(
  parsed: unknown,
  coverageParsed: unknown,
  opts: { sha256?: string; coverageSha256?: string } = {},
): NormalizedCatalog {
  const problems: string[] = [];
  const warnings: string[] = [];
  const corrections = { mojibake: 0, whitespace: 0, nbsp: 0 };
  const samples: CatalogReport["samples"] = [];
  const links: CatalogLink[] = [];
  const topics = new Map<string, CatalogTopic>();
  const coverage: CatalogReport["coverage"] = [];
  const linked = new Map<string, number>();

  // --- the source's own category list, which fixes the topic labels ---
  if (!Array.isArray(coverageParsed)) {
    problems.push("The coverage file isn't a list of categories.");
  } else {
    coverageParsed.forEach((row: RawCoverage, i) => {
      const name = typeof row?.category === "string" ? tidy(row.category) : "";
      const url = typeof row?.url === "string" ? row.url.trim() : "";
      if (!name || name.length > CATALOG_LIMITS.topicName) {
        problems.push(`Category ${i + 1} has no usable name.`);
        return;
      }
      if (row?.error) problems.push(`The source reported an error for "${name}": ${String(row.error).slice(0, 200)}`);
      if (topics.has(name.toLowerCase())) {
        problems.push(`"${name}" is listed twice in the coverage file.`);
        return;
      }
      const ok = CATHOLIC_ONLINE.topicUrlPattern.test(url);
      if (url && !ok) warnings.push(`The address listed for "${name}" isn't a Catholic Online category page; it is not stored.`);
      topics.set(name.toLowerCase(), { name, source_url: ok ? url : null, sort_order: (i + 1) * 10 });
      coverage.push({
        topic: name,
        source_url: ok ? url : null,
        extracted_count: Number.isInteger(row?.extracted_count) ? (row.extracted_count as number) : null,
        linked_count: 0,
      });
    });
  }

  // --- the links themselves ---
  const records = Array.isArray(parsed) ? parsed.length : 0;
  if (!Array.isArray(parsed)) {
    problems.push("The prayers file isn't a list of records.");
  } else if (!parsed.length) {
    problems.push("The prayers file is empty.");
  } else if (parsed.length > CATALOG_LIMITS.links) {
    problems.push(`The prayers file holds ${parsed.length.toLocaleString("en-US")} records; at most ${CATALOG_LIMITS.links.toLocaleString("en-US")} are imported at a time.`);
  }

  const seen = new Set<string>();
  if (Array.isArray(parsed)) {
    for (const [i, row] of (parsed as RawLink[]).entries()) {
      const where = `Record ${i + 1}`;
      const sourceId = typeof row?.source_id === "string" ? row.source_id.trim() : "";
      const idMatch = CATHOLIC_ONLINE.idPattern.exec(sourceId);
      if (!idMatch) {
        problems.push(`${where} has no usable source id.`);
        continue;
      }
      if (seen.has(sourceId)) {
        problems.push(`${sourceId} appears more than once.`);
        continue;
      }
      seen.add(sourceId);
      const url = typeof row?.source_url === "string" ? row.source_url.trim() : "";
      const urlMatch = CATHOLIC_ONLINE.urlPattern.exec(url);
      if (!urlMatch) {
        problems.push(`${sourceId} has no Catholic Online prayer address.`);
        continue;
      }
      if (urlMatch[1] !== idMatch[1]) {
        problems.push(`${sourceId} and its address ${url} name different prayers.`);
        continue;
      }
      if (url.length > CATALOG_LIMITS.url) {
        problems.push(`${sourceId}'s address is longer than ${CATALOG_LIMITS.url} characters.`);
        continue;
      }
      if (typeof row?.source_name === "string" && tidy(row.source_name) && tidy(row.source_name) !== CATHOLIC_ONLINE.sourceName) {
        problems.push(`${sourceId} names a different source (${tidy(row.source_name)}).`);
        continue;
      }
      if (typeof row?.content_type === "string" && row.content_type !== "external_link") {
        problems.push(`${sourceId} isn't an external link (${row.content_type}); no prayer text is imported here.`);
        continue;
      }

      const raw = typeof row?.title === "string" ? row.title : "";
      const repaired = repairMojibake(raw);
      if (repaired !== raw) {
        corrections.mojibake += 1;
        if (samples.length < 8) samples.push({ source_id: sourceId, from: raw, to: tidy(repaired) });
      }
      if (/[ ​﻿]/.test(repaired)) corrections.nbsp += 1;
      const title = tidy(repaired);
      if (title !== repaired) corrections.whitespace += 1;
      if (!title) {
        problems.push(`${sourceId} has no title.`);
        continue;
      }
      if (title.length > CATALOG_LIMITS.title) {
        problems.push(`${sourceId}'s title is longer than ${CATALOG_LIMITS.title} characters.`);
        continue;
      }

      const names = Array.isArray(row?.categories) ? (row.categories as unknown[]) : [];
      if (!names.length) {
        problems.push(`${sourceId} is in no category.`);
        continue;
      }
      if (names.length > CATALOG_LIMITS.topicsPerLink) {
        problems.push(`${sourceId} is in ${names.length} categories; at most ${CATALOG_LIMITS.topicsPerLink} are kept.`);
        continue;
      }
      const chosen: string[] = [];
      let bad = false;
      for (const value of names) {
        const name = typeof value === "string" ? tidy(value) : "";
        const topic = topics.get(name.toLowerCase());
        if (!topic) {
          problems.push(`${sourceId} is in "${name || String(value)}", which the coverage file doesn't list.`);
          bad = true;
          break;
        }
        if (!chosen.includes(topic.name)) chosen.push(topic.name);
      }
      if (bad) continue;
      for (const name of chosen) linked.set(name, (linked.get(name) ?? 0) + 1);
      links.push({ source_id: sourceId, title, source_url: url, topics: chosen });
    }
  }

  links.sort((a, b) => a.title.localeCompare(b.title, "en") || a.source_id.localeCompare(b.source_id));

  for (const row of coverage) {
    row.linked_count = linked.get(row.topic) ?? 0;
    if (!row.linked_count) warnings.push(`No prayer is listed under "${row.topic}"; the topic is imported but members won't see it until one is.`);
    else if (row.extracted_count !== null && row.extracted_count !== row.linked_count) {
      warnings.push(`"${row.topic}" was collected with ${row.extracted_count} prayers; ${row.linked_count} carry it (categories overlap, so counts can differ).`);
    }
  }

  const sha256 = opts.sha256 ?? "";
  const coverageSha256 = opts.coverageSha256 ?? null;
  const report: CatalogReport = {
    ok: problems.length === 0 && links.length > 0,
    source: {
      name: CATHOLIC_ONLINE.sourceName,
      url: CATHOLIC_ONLINE.sourceUrl,
      path: CATHOLIC_ONLINE.localPath,
      sha256,
      sha256_matches: sha256 === CATHOLIC_ONLINE.sha256,
      coverage_sha256: coverageSha256,
      coverage_matches: coverageSha256 === null ? null : coverageSha256 === CATHOLIC_ONLINE.coverageSha256,
      collected_on: CATHOLIC_ONLINE.collectedOn,
    },
    counts: {
      records,
      links: links.length,
      topics: topics.size,
      topic_links: links.reduce((n, l) => n + l.topics.length, 0),
      topics_without_links: coverage.filter((c) => !c.linked_count).length,
    },
    corrections,
    samples,
    coverage,
    problems: problems.slice(0, 50),
    warnings: warnings.slice(0, 200),
  };
  if (problems.length > 50) report.problems.push(`…and ${problems.length - 50} more problems.`);
  return { links, topics: [...topics.values()], report };
}

/* -------------------------------------------------------------------------
 * What the prayer_link_* functions return, and the wording its pages share.
 * The database is the authority for every rule (who may browse, manage, or
 * import); these only decide what to show.
 * ---------------------------------------------------------------------- */

export type CatalogTopicRef = { id: string; name: string };

/** One prayer in a catalogue: a title, its labels, and the page it is on. */
export type CatalogLinkRow = { id: string; title: string; source_url: string; topics: CatalogTopicRef[] };

export type CatalogShelf = {
  id: string;
  key: string;
  name: string;
  description: string;
  source_name: string;
  source_url: string;
  rights_statement: string;
  /** Published links members can see. */
  count: number;
  imported_at: string | null;
};

export type CatalogDetail = CatalogShelf & { topics: Array<CatalogTopicRef & { source_url: string | null; count: number }> };

export type CatalogLinkPage = { items: CatalogLinkRow[]; total: number; has_more: boolean };

export type AdminCatalogLink = CatalogLinkRow & { is_published: boolean; retired: boolean; source_id: string };
export type AdminCatalogLinkPage = { items: AdminCatalogLink[]; total: number; has_more: boolean };

export type AdminCatalogTopic = CatalogTopicRef & {
  source_url: string | null;
  sort_order: number;
  archived: boolean;
  /** Every link with this label, and how many of them are published. */
  total: number;
  published: number;
};

export type CatalogImport = {
  id: string;
  status: "staging" | "applied" | "failed" | "discarded";
  expected: number;
  source_sha256: string;
  result: Record<string, number> | null;
  error: string | null;
  by: string;
  created_at: string;
  finished_at: string | null;
};

export type AdminCatalogSummary = CatalogShelf & {
  sort_order: number;
  status: CatalogStatus;
  published_at: string | null;
  archived_at: string | null;
  source_path: string | null;
  source_sha256: string | null;
  updated_at: string;
  counts: { total: number; published: number; unpublished: number; retired: number };
  topic_counts: { active: number; archived: number };
};

export type AdminCatalogDetail = AdminCatalogSummary & { topics: AdminCatalogTopic[]; imports: CatalogImport[] };

export const CATALOG_STATUSES = ["draft", "published", "archived"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = {
  draft: "Draft",
  published: "Published to members",
  archived: "Archived",
};

export const CATALOG_REVIEW_STATES = ["all", "unpublished", "published", "retired"] as const;
export type CatalogReviewState = (typeof CATALOG_REVIEW_STATES)[number];

export const CATALOG_REVIEW_LABEL: Record<CatalogReviewState, string> = {
  all: "All",
  unpublished: "Not published",
  published: "Published",
  retired: "No longer listed",
};

/** How many links a page shows at a time (members, then the review list). */
export const CATALOG_PAGE = 50;
export const CATALOG_ADMIN_PAGE = 50;

export function catalogHref(id: string): string {
  return `/prayer/library/catalogs/${encodeURIComponent(id)}`;
}

export function adminCatalogHref(id: string): string {
  return `/admin/prayer/library/catalogs/${encodeURIComponent(id)}`;
}

/** "2,304 prayers" — the same wording the library uses for its own counts. */
export function catalogCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "prayer" : "prayers"}`;
}

/** The page number in the address bar (1-based) as a row offset. */
export function catalogOffset(page: unknown, perPage = CATALOG_PAGE): { page: number; offset: number } {
  const n = typeof page === "string" && /^\d{1,4}$/.test(page) ? Math.max(1, Number(page)) : 1;
  return { page: n, offset: (n - 1) * perPage };
}

/** A topic id from the address bar: one of this catalogue's own, or null. */
export function pickTopic(value: unknown, topics: CatalogTopicRef[]): string | null {
  return typeof value === "string" && topics.some((t) => t.id === value) ? value : null;
}

/** The shown range for "Showing 51–100 of 2,304". */
export function catalogRange(total: number, offset: number, shown: number): string {
  if (!total) return "No prayers";
  const from = offset + 1;
  const to = offset + shown;
  return `Showing ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

/** Said on every catalogue page and card, so nobody expects the text here. */
export const CATALOG_LINK_NOTE = "Opens on the source's own site in a new tab.";

/** The catalogue's details, as `prayer_link_import_begin` expects them. */
export function catalogMeta(): Record<string, string> {
  return {
    key: CATHOLIC_ONLINE.key,
    name: CATHOLIC_ONLINE.name,
    description: CATHOLIC_ONLINE.description,
    source_name: CATHOLIC_ONLINE.sourceName,
    source_url: CATHOLIC_ONLINE.sourceUrl,
    rights_statement: CATHOLIC_ONLINE.rightsStatement,
    source_path: CATHOLIC_ONLINE.localPath,
    source_sha256: CATHOLIC_ONLINE.sha256,
  };
}

/**
 * The report as it is stored with the import: counts, corrections, samples,
 * problems, and warnings, without the per-topic coverage table (which the
 * dry run prints in full and `coverage.json` keeps).
 */
export function storedCatalogReport(report: CatalogReport): Record<string, unknown> {
  const { coverage, ...rest } = report;
  return { ...rest, coverage_topics: coverage.length };
}
