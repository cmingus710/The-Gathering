#!/usr/bin/env node
/**
 * Dry run of the Catholic Online prayer-link import: reads the pinned files,
 * checks their SHA-256, normalizes them exactly as the app's import does, and
 * prints the report. Writes nothing and connects to nothing.
 *
 *   node scripts/prayer-catalog-dry-run.mjs [--json] [--coverage] [--titles N] [--file path] [--coverage-file path]
 *
 * Exit status: 0 when the files are ready to import, 1 when the report lists a
 * problem that blocks the import, 2 on a usage error.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATHOLIC_ONLINE, normalizeCatalog } from "../src/lib/prayer/catalog.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = value("--file") ?? path.join(root, CATHOLIC_ONLINE.localPath);
const coverageFile = value("--coverage-file") ?? path.join(root, CATHOLIC_ONLINE.coveragePath);

let bytes;
let coverageBytes;
try {
  bytes = readFileSync(file);
  coverageBytes = readFileSync(coverageFile);
} catch (error) {
  console.error(`Couldn't read the catalogue files: ${error.message}`);
  process.exit(2);
}
const sha256 = createHash("sha256").update(bytes).digest("hex");
const coverageSha256 = createHash("sha256").update(coverageBytes).digest("hex");

let parsed;
let coverageParsed;
try {
  parsed = JSON.parse(bytes.toString("utf8"));
  coverageParsed = JSON.parse(coverageBytes.toString("utf8"));
} catch (error) {
  console.error(`Not valid JSON: ${error.message}`);
  process.exit(1);
}

const { links, topics, report } = normalizeCatalog(parsed, coverageParsed, { sha256, coverageSha256 });

if (flag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const n = (v) => v.toLocaleString("en-US");
  const line = (label, v) => console.log(`${label.padEnd(26)} ${v}`);
  console.log(`${CATHOLIC_ONLINE.name} · import dry run (nothing is written)\n`);
  line("Source", `${report.source.name} — ${report.source.url}`);
  line("Collected", report.source.collected_on);
  line("Prayers file", `${path.relative(root, file)} (${n(bytes.length)} bytes)`);
  line("SHA-256", `${sha256} ${report.source.sha256_matches ? "(matches the pinned hash)" : "(DOES NOT match the pinned hash)"}`);
  line("Coverage file", `${path.relative(root, coverageFile)} (${n(coverageBytes.length)} bytes)`);
  line("SHA-256", `${coverageSha256} ${report.source.coverage_matches ? "(matches)" : "(DOES NOT match)"}`);
  console.log("");
  line("Records read", n(report.counts.records));
  line("Prayer links", n(report.counts.links));
  line("Topics", n(report.counts.topics));
  line("Topic labels applied", n(report.counts.topic_links));
  line("Topics with no link", n(report.counts.topics_without_links));
  console.log("");
  line("Titles re-decoded", n(report.corrections.mojibake));
  line("Titles re-spaced", n(report.corrections.whitespace));
  line("No-break spaces", n(report.corrections.nbsp));
  if (report.samples.length) {
    console.log("\nRe-decoded titles (sample):");
    for (const s of report.samples) console.log(`  ${s.source_id}\n    ${s.from}\n    ${s.to}`);
  }
  const titles = Number(value("--titles") ?? 0);
  if (titles > 0) {
    console.log(`\nFirst ${titles} links as they would be imported:`);
    for (const l of links.slice(0, titles)) console.log(`  ${l.title}  [${l.topics.join(", ")}]  ${l.source_url}`);
  }
  if (flag("--coverage")) {
    console.log("\nPer-topic coverage (source count → links carrying the label):");
    for (const c of report.coverage) console.log(`  ${String(c.extracted_count ?? "?").padStart(5)} → ${String(c.linked_count).padStart(5)}  ${c.topic}`);
  }
  if (report.warnings.length) {
    console.log(`\nWarnings (${report.warnings.length}); they don't block the import:`);
    for (const w of report.warnings.slice(0, 20)) console.log(`  - ${w}`);
    if (report.warnings.length > 20) console.log(`  …and ${report.warnings.length - 20} more (use --json for all).`);
  }
  if (report.problems.length) {
    console.log(`\nProblems (${report.problems.length}); these block the import:`);
    for (const p of report.problems) console.log(`  - ${p}`);
  }
  console.log(`\nTopics: ${topics.length}. ${report.ok ? "Ready to import." : "NOT ready to import."}`);
}

process.exit(report.ok ? 0 : 1);
