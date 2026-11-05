import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_LIMITS,
  CATHOLIC_ONLINE,
  catalogOffset,
  catalogRange,
  normalizeCatalog,
  pickTopic,
  repairMojibake,
  storedCatalogReport,
} from "./catalog";

const ROOT = path.resolve(__dirname, "../../..");

const topic = (name: string, order = 1, url = `https://www.catholic.org/prayers/prayer.php?s=${order}`) => ({
  category: name,
  url,
  error: null,
  extracted_count: 1,
});
const record = (n: number, title: string, categories: string[]) => ({
  source_id: `catholic-online-${n}`,
  title,
  categories,
  source_url: `https://www.catholic.org/prayers/prayer.php?p=${n}`,
  source_name: "Catholic Online",
  content_type: "external_link",
  rights_status: "link_only_text_not_imported",
  is_published: false,
});

describe("repairMojibake", () => {
  it("restores titles mis-decoded through code page 1250", () => {
    expect(repairMojibake("Ave MarĂ­a")).toBe("Ave María");
    expect(repairMojibake("AcciĂłn de gracias")).toBe("Acción de gracias");
    expect(repairMojibake("El SeĂ±or es mi pastor...")).toBe("El Señor es mi pastor...");
    expect(repairMojibake("Gloire au PĂ¨re")).toBe("Gloire au Père");
  });

  it("leaves correctly written text alone, whatever the alphabet", () => {
    for (const text of ["A Morning Offering", "en Español Prayers", "Señor", "Père", "Μακάριοι", "祈り", "Ave Maria"]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });

  it("leaves text it cannot vouch for alone", () => {
    // U+FFFD can't be mapped back to a byte, and a lone high byte isn't UTF-8.
    expect(repairMojibake("Ora�ion")).toBe("Ora�ion");
    expect(repairMojibake("Ă")).toBe("Ă");
  });

  it("is a no-op the second time (repairing twice changes nothing)", () => {
    const once = repairMojibake("OraciĂłn a San CristĂłbal");
    expect(once).toBe("Oración a San Cristóbal");
    expect(repairMojibake(once)).toBe(once);
  });
});

describe("normalizeCatalog", () => {
  it("reads records into links and topics, by title", () => {
    const { links, topics, report } = normalizeCatalog(
      [record(2, "Benedictus", ["Morning Prayers"]), record(1, "Ave MarĂ­a", ["Marian Prayers", "Morning Prayers"])],
      [topic("Morning Prayers", 1), topic("Marian Prayers", 2)],
    );
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(links.map((l) => l.title)).toEqual(["Ave María", "Benedictus"]);
    expect(links[0]).toEqual({
      source_id: "catholic-online-1",
      title: "Ave María",
      source_url: "https://www.catholic.org/prayers/prayer.php?p=1",
      topics: ["Marian Prayers", "Morning Prayers"],
    });
    expect(topics.map((t) => t.name)).toEqual(["Morning Prayers", "Marian Prayers"]);
    expect(topics[0].source_url).toBe("https://www.catholic.org/prayers/prayer.php?s=1");
    expect(report.counts).toMatchObject({ records: 2, links: 2, topics: 2, topic_links: 3, topics_without_links: 0 });
    expect(report.corrections.mojibake).toBe(1);
    expect(report.samples[0]).toMatchObject({ source_id: "catholic-online-1", to: "Ave María" });
  });

  it("tidies whitespace, no-break spaces included", () => {
    const { links, report } = normalizeCatalog([record(1, "  Oracion   De Ofrecimiento  ", ["Mass Prayers"])], [topic("Mass Prayers")]);
    expect(links[0].title).toBe("Oracion De Ofrecimiento");
    expect(report.corrections.whitespace).toBe(1);
    expect(report.corrections.nbsp).toBe(1);
  });

  it("refuses anything it cannot vouch for", () => {
    const cases: Array<[unknown[], RegExp]> = [
      [[{ ...record(1, "A prayer", ["Mass Prayers"]), source_id: "elsewhere-1" }], /no usable source id/],
      [[{ ...record(1, "A prayer", ["Mass Prayers"]), source_url: "https://example.test/p=1" }], /no Catholic Online prayer address/],
      [[{ ...record(1, "A prayer", ["Mass Prayers"]), source_url: "https://www.catholic.org/prayers/prayer.php?p=99" }], /name different prayers/],
      [[record(1, "A prayer", ["Unlisted Prayers"])], /coverage file doesn't list/],
      [[record(1, "   ", ["Mass Prayers"])], /has no title/],
      [[record(1, "x".repeat(CATALOG_LIMITS.title + 1), ["Mass Prayers"])], /longer than 200 characters/],
      [[record(1, "A prayer", [])], /is in no category/],
      [[{ ...record(1, "A prayer", ["Mass Prayers"]), source_name: "Somewhere else" }], /names a different source/],
      [[{ ...record(1, "A prayer", ["Mass Prayers"]), content_type: "prayer_text" }], /isn't an external link/],
      [[record(1, "One", ["Mass Prayers"]), record(1, "Two", ["Mass Prayers"])], /appears more than once/],
    ];
    for (const [records, message] of cases) {
      const { report, links } = normalizeCatalog(records, [topic("Mass Prayers")]);
      expect(report.ok, message.source).toBe(false);
      expect(report.problems.join(" ")).toMatch(message);
      // The refused record never becomes a link (the duplicate case keeps the
      // first record and refuses the second), and `ok: false` stops the
      // import before any of them is staged.
      expect(links.length, message.source).toBeLessThan(records.length);
    }
  });

  it("refuses a category the source reported an error for, and a file of the wrong shape", () => {
    const bad = normalizeCatalog([record(1, "A prayer", ["Mass Prayers"])], [{ ...topic("Mass Prayers"), error: "HTTP 500" }]);
    expect(bad.report.ok).toBe(false);
    expect(bad.report.problems.join(" ")).toMatch(/reported an error/);
    expect(normalizeCatalog({}, []).report.problems.join(" ")).toMatch(/isn't a list of records/);
    expect(normalizeCatalog([], []).report.problems.join(" ")).toMatch(/is empty/);
    expect(normalizeCatalog([record(1, "A prayer", ["Mass Prayers"])], {}).report.problems.join(" ")).toMatch(/isn't a list of categories/);
  });

  it("warns, without blocking, about a topic no prayer carries and a count that moved", () => {
    const { report } = normalizeCatalog(
      [record(1, "A prayer", ["Mass Prayers"])],
      [{ ...topic("Mass Prayers"), extracted_count: 9 }, topic("Empty Prayers", 2)],
    );
    expect(report.ok).toBe(true);
    expect(report.counts.topics_without_links).toBe(1);
    expect(report.warnings.join(" ")).toMatch(/No prayer is listed under "Empty Prayers"/);
    expect(report.warnings.join(" ")).toMatch(/collected with 9 prayers; 1 carry it/);
  });

  it("reports whether the files match the pinned hashes", () => {
    const { report } = normalizeCatalog([record(1, "A prayer", ["Mass Prayers"])], [topic("Mass Prayers")], { sha256: "b".repeat(64), coverageSha256: "c".repeat(64) });
    expect(report.source).toMatchObject({ sha256_matches: false, coverage_matches: false, name: "Catholic Online" });
  });

  it("keeps the per-topic table out of what is stored with an import", () => {
    const { report } = normalizeCatalog([record(1, "A prayer", ["Mass Prayers"])], [topic("Mass Prayers")]);
    const stored = storedCatalogReport(report);
    expect(stored).not.toHaveProperty("coverage");
    expect(stored.coverage_topics).toBe(1);
    expect(stored.ok).toBe(true);
  });
});

describe("the pinned Catholic Online catalogue", () => {
  const bytes = readFileSync(path.join(ROOT, CATHOLIC_ONLINE.localPath));
  const coverageBytes = readFileSync(path.join(ROOT, CATHOLIC_ONLINE.coveragePath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const coverageSha256 = createHash("sha256").update(coverageBytes).digest("hex");
  const { links, topics, report } = normalizeCatalog(JSON.parse(bytes.toString("utf8")), JSON.parse(coverageBytes.toString("utf8")), { sha256, coverageSha256 });

  it("matches the hashes pinned in this file", () => {
    expect(sha256).toBe(CATHOLIC_ONLINE.sha256);
    expect(coverageSha256).toBe(CATHOLIC_ONLINE.coverageSha256);
  });

  it("is ready to import: 2,304 prayers in 111 topics, with no problems", () => {
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.counts).toMatchObject({ records: 2304, links: 2304, topics: 111, topic_links: 2304, topics_without_links: 0 });
    expect(links).toHaveLength(2304);
    expect(topics).toHaveLength(111);
  });

  it("repairs the 30 mis-decoded Spanish, French, and German titles and nothing else", () => {
    expect(report.corrections.mojibake).toBe(30);
    expect(links.some((l) => l.title === "Ave María")).toBe(true);
    expect(links.some((l) => l.title === "Oración de San Francisco de Asís")).toBe(true);
    expect(links.some((l) => /[ĂĽłşź]/.test(l.title))).toBe(false);
  });

  it("holds no prayer text, and every link is one Catholic Online prayer page", () => {
    for (const l of links) {
      expect(Object.keys(l).sort()).toEqual(["source_id", "source_url", "title", "topics"]);
      expect(l.source_url).toMatch(CATHOLIC_ONLINE.urlPattern);
      expect(l.topics.length).toBeGreaterThan(0);
    }
    expect(new Set(links.map((l) => l.source_id)).size).toBe(links.length);
    expect(new Set(links.map((l) => l.source_url)).size).toBe(links.length);
  });

  it("keeps the source's own topic names, which the church doesn't reword", () => {
    const names = topics.map((t) => t.name);
    expect(names).toContain("Marian (Mary) Prayers");
    expect(names).toContain("en Español Prayers");
    expect(names).toContain("The Rosary in Irish-Gaelic");
    for (const t of topics) {
      expect(t.name.length).toBeLessThanOrEqual(CATALOG_LIMITS.topicName);
      expect(t.source_url).toMatch(CATHOLIC_ONLINE.topicUrlPattern);
    }
  });
});

describe("page helpers", () => {
  it("turns a page number into a row offset, ignoring nonsense", () => {
    expect(catalogOffset(undefined)).toEqual({ page: 1, offset: 0 });
    expect(catalogOffset("3")).toEqual({ page: 3, offset: 100 });
    expect(catalogOffset("3", 20)).toEqual({ page: 3, offset: 40 });
    for (const bad of ["0", "-2", "abc", "99999", "1.5", ""]) expect(catalogOffset(bad).page).toBe(1);
  });

  it("says the range being shown", () => {
    expect(catalogRange(2304, 0, 50)).toBe("Showing 1–50 of 2,304");
    expect(catalogRange(2304, 2300, 4)).toBe("Showing 2,301–2,304 of 2,304");
    expect(catalogRange(0, 0, 0)).toBe("No prayers");
  });

  it("accepts only a topic the catalogue has", () => {
    const topics = [{ id: "11111111-1111-1111-1111-111111111111", name: "Morning Prayers" }];
    expect(pickTopic(topics[0].id, topics)).toBe(topics[0].id);
    expect(pickTopic("22222222-2222-2222-2222-222222222222", topics)).toBeNull();
    expect(pickTopic(undefined, topics)).toBeNull();
    expect(pickTopic("' or 1=1", topics)).toBeNull();
  });
});
