#!/usr/bin/env node
/**
 * Dry run of the Morning & Evening import: reads the pinned source file,
 * checks its SHA-256, normalizes it exactly as the app's import does, and
 * prints the report. Writes nothing and connects to nothing, unless
 * --verify-upstream is given, which downloads the file at the pinned commit
 * from GitHub and checks it is byte-for-byte the copy in this repository.
 *
 *   node scripts/morning-evening-dry-run.mjs [--json] [--sample 01-01-morning] [--verify-upstream] [--file path]
 *
 * Exit status: 0 when the file is ready to import, 1 when the report lists a
 * problem that blocks the import, 2 on a usage or download error.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MORNING_EVENING, normalizeMorningEvening } from "../src/lib/devotionals/morning-evening.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = value("--file") ?? path.join(root, MORNING_EVENING.localPath);
const bytes = readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");

if (flag("--verify-upstream")) {
  const res = await fetch(MORNING_EVENING.source.rawUrl);
  if (!res.ok) {
    console.error(`Download failed: HTTP ${res.status} from ${MORNING_EVENING.source.rawUrl}`);
    process.exit(2);
  }
  const upstream = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
  console.log(`Upstream at ${MORNING_EVENING.source.commit.slice(0, 12)}: ${upstream}`);
  console.log(upstream === sha256 ? "Matches the repository copy." : "DIFFERENT from the repository copy.");
  if (upstream !== sha256) process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(bytes.toString("utf8"));
} catch (error) {
  console.error(`Not valid JSON: ${error.message}`);
  process.exit(1);
}
const { readings, report } = normalizeMorningEvening(parsed, { sha256 });

if (flag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = (label, v) => console.log(`${label.padEnd(26)} ${v}`);
  console.log(`Morning & Evening import · dry run (nothing is written)\n`);
  line("Source", `${report.source.repository} @ ${report.source.commit}`);
  line("File", `${path.relative(root, file)} (${bytes.length.toLocaleString("en-US")} bytes)`);
  line("SHA-256", `${sha256} ${report.source.sha256_matches ? "(matches the pinned hash)" : "(DOES NOT match the pinned hash)"}`);
  line("Records in file", report.records);
  line("Readings ready", `${report.readings} (morning ${report.by_slot.morning}, evening ${report.by_slot.evening})`);
  line("Calendar days complete", `${report.days_complete} of 366 (both readings)`);
  line("Expected readings", report.expected);
  line("February 29", `morning ${report.feb29.morning ? "present" : "MISSING"}, evening ${report.feb29.evening ? "present" : "MISSING"}`);
  line("Missing", report.missing.length ? report.missing.join(", ") : "none");
  line("Duplicates", report.duplicates.length ? report.duplicates.join(", ") : "none");
  line("Malformed records", report.malformed.length || "none");
  for (const m of report.malformed) console.log(`  - ${m.message}`);
  console.log(`\nCorrections (verified; applied):`);
  for (const f of report.fixes) console.log(`  - ${f.code}: ${f.readings} readings, ${f.occurrences} changes (e.g. ${f.examples.slice(0, 4).join(", ")})\n      ${f.description}`);
  console.log(`\nWarnings (left unchanged for review):`);
  if (!report.warnings.length) console.log("  none");
  for (const w of report.warnings) console.log(`  - ${w.code}: ${w.readings.length} readings (${w.readings.slice(0, 6).join(", ")}${w.readings.length > 6 ? ", …" : ""})\n      ${w.description}`);
  console.log(`\n${report.ok ? "READY: the file can be imported." : "BLOCKED: fix the problems above before importing."}`);
}

const sample = value("--sample");
if (sample) {
  const r = readings.find((x) => x.source_key === sample);
  console.log(r ? `\n--- ${sample} ---\n${r.key_verse} — ${r.scripture_ref}\n\n${r.body}` : `\nNo reading ${sample}.`);
}
process.exit(report.ok ? 0 : 1);
