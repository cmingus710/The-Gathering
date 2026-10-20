#!/usr/bin/env node
/**
 * Prepares the public-domain World English Bible (WEB) as a structured CSV
 * for Admin → Bible sources → Import text. Used for functional testing until
 * the church selects its translation; it is never substituted silently (the
 * translation is labelled WEB with its attribution).
 *
 *   node scripts/bible-prepare-web.mjs --tarball <file.tgz> --out web.csv
 *   node scripts/bible-prepare-web.mjs --tarball <file.tgz> --out sample.csv --only GEN:1-2,PSA:23,JHN:3,ACT:8,JUD:1
 *
 * Source: the npm package world-english-bible@1.0.1 (TehShrike), a JSON
 * conversion of eBible.org's WEB HTML. Download it yourself from the npm
 * registry (https://registry.npmjs.org/world-english-bible/-/world-english-bible-1.0.1.tgz)
 * and pass the file; the script verifies its SHA-512 before reading it, and
 * treats the contents as data only (it never runs code from the package).
 *
 * The WEB is in the public domain; "World English Bible" is a trademark of
 * eBible.org, used only for the unaltered text (see docs/bible-sources.md).
 * Conversion changes whitespace only: segments of a verse are joined (poetry
 * lines with a line break), runs of spaces collapse, and ends are trimmed.
 * Wording, punctuation, and verse numbers are untouched. Psalm
 * superscriptions become the heading of the following verse. Verses the WEB
 * leaves empty (e.g. Acts 8:37) are written with empty text, so the import
 * review flags them for an explicit decision.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const INTEGRITY = "sha512-OH/5yt9BYrhy1oBXXwhSuL9ES97t5Ij8rLWeQZUOIFAkoGzZaq8aLcKMBdzwHqPbJBkyMYPhgFj6rzvtT/oT4A==";

const BOOKS = [
  ["GEN", "genesis"], ["EXO", "exodus"], ["LEV", "leviticus"], ["NUM", "numbers"], ["DEU", "deuteronomy"], ["JOS", "joshua"],
  ["JDG", "judges"], ["RUT", "ruth"], ["1SA", "1samuel"], ["2SA", "2samuel"], ["1KI", "1kings"], ["2KI", "2kings"],
  ["1CH", "1chronicles"], ["2CH", "2chronicles"], ["EZR", "ezra"], ["NEH", "nehemiah"], ["EST", "esther"], ["JOB", "job"],
  ["PSA", "psalms"], ["PRO", "proverbs"], ["ECC", "ecclesiastes"], ["SNG", "songofsolomon"], ["ISA", "isaiah"], ["JER", "jeremiah"],
  ["LAM", "lamentations"], ["EZK", "ezekiel"], ["DAN", "daniel"], ["HOS", "hosea"], ["JOL", "joel"], ["AMO", "amos"],
  ["OBA", "obadiah"], ["JON", "jonah"], ["MIC", "micah"], ["NAM", "nahum"], ["HAB", "habakkuk"], ["ZEP", "zephaniah"],
  ["HAG", "haggai"], ["ZEC", "zechariah"], ["MAL", "malachi"], ["MAT", "matthew"], ["MRK", "mark"], ["LUK", "luke"],
  ["JHN", "john"], ["ACT", "acts"], ["ROM", "romans"], ["1CO", "1corinthians"], ["2CO", "2corinthians"], ["GAL", "galatians"],
  ["EPH", "ephesians"], ["PHP", "philippians"], ["COL", "colossians"], ["1TH", "1thessalonians"], ["2TH", "2thessalonians"],
  ["1TI", "1timothy"], ["2TI", "2timothy"], ["TIT", "titus"], ["PHM", "philemon"], ["HEB", "hebrews"], ["JAS", "james"],
  ["1PE", "1peter"], ["2PE", "2peter"], ["1JN", "1john"], ["2JN", "2john"], ["3JN", "3john"], ["JUD", "jude"], ["REV", "revelation"],
];

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
if (!args.tarball || !args.out) {
  console.error("Usage: node scripts/bible-prepare-web.mjs --tarball <world-english-bible-1.0.1.tgz> --out <file.csv> [--only GEN:1-2,PSA:23]");
  process.exit(2);
}

const bytes = readFileSync(args.tarball);
const digest = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
if (digest !== INTEGRITY) {
  console.error("The tarball doesn't match world-english-bible@1.0.1 from the npm registry. Nothing was written.");
  process.exit(1);
}

/** "GEN:1-2,PSA:23" → Map(book → [from, to]) */
const only = new Map(
  (args.only ?? "")
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [book, range] = part.split(":");
      const [from, to] = (range ?? "1-999").split("-").map(Number);
      return [book, [from, to ?? from]];
    }),
);

const dir = mkdtempSync(path.join(tmpdir(), "web-"));
try {
  // Extract only the JSON data files; nothing from the package is executed.
  execFileSync("tar", ["-xzf", path.resolve(args.tarball), "-C", dir, "package/json"]);
  const files = new Set(readdirSync(path.join(dir, "package/json")));
  const csv = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["book,chapter,verse,text,heading,paragraph,poetry"];
  let verses = 0;
  for (const [code, file] of BOOKS) {
    if (only.size && !only.has(code)) continue;
    if (!files.has(`${file}.json`)) throw new Error(`Missing ${file}.json`);
    const items = JSON.parse(readFileSync(path.join(dir, "package/json", `${file}.json`), "utf8"));
    /** chapter:verse → {segments, poetry, heading, para} in source order */
    const map = new Map();
    let pendingHeading = null;
    let paraStart = false;
    for (const item of items) {
      if (item.type === "header") pendingHeading = String(item.value ?? "").replace(/\s+/g, " ").trim() || null;
      else if (item.type === "paragraph start" || item.type === "stanza start") paraStart = true;
      else if (item.type === "paragraph text" || item.type === "line text") {
        const key = `${item.chapterNumber}:${item.verseNumber}`;
        let v = map.get(key);
        if (!v) {
          v = { chapter: item.chapterNumber, verse: item.verseNumber, segments: [], poetry: false, heading: pendingHeading, para: paraStart };
          map.set(key, v);
          pendingHeading = null;
          paraStart = false;
        }
        v.segments.push({ text: String(item.value ?? ""), line: item.type === "line text" });
        if (item.type === "line text") v.poetry = true;
      }
    }
    const [from, to] = only.get(code) ?? [1, 999];
    for (const v of map.values()) {
      if (v.chapter < from || v.chapter > to) continue;
      const parts = v.segments.map((s) => s.text.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
      const text = v.poetry ? parts.join("\n") : parts.join(" ");
      lines.push([code, v.chapter, v.verse, csv(text), csv(v.heading ?? ""), v.para ? "1" : "", v.poetry ? "1" : ""].join(","));
      verses += 1;
    }
  }
  writeFileSync(args.out, `${lines.join("\n")}\n`);
  console.log(`Wrote ${verses} verses to ${args.out}.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
