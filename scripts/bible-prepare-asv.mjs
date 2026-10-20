#!/usr/bin/env node
/**
 * Prepares the public-domain American Standard Version (1901) as a
 * structured CSV for Admin → Bible sources → Import text.
 *
 *   node scripts/bible-prepare-asv.mjs --xml <eng-asv.zefania.xml> --out asv.csv
 *   node scripts/bible-prepare-asv.mjs --xml <eng-asv.zefania.xml> --out sample.csv --only GEN:1-2,PSA:23,JHN:3,ACT:8,JUD:1
 *
 * Source: eng-asv.zefania.xml from github.com/seven1m/open-bibles at commit
 * f257a3559025c3f873b48a75019f53a9354ed7de (Zefania XML by the Free Bible
 * Software Group, which names Biola University's Unbound Bible ASV as its
 * source). Download the file yourself:
 *   https://raw.githubusercontent.com/seven1m/open-bibles/f257a3559025c3f873b48a75019f53a9354ed7de/eng-asv.zefania.xml
 * The script verifies its SHA-256 before reading it, refuses DOCTYPE and
 * entity declarations, and treats it as data only.
 *
 * Why this copy: it was compared verse by verse with two other ASV copies
 * (see docs/asv-crosscheck.md). All three agree in 30,262 verses; where they
 * differ, this copy agrees with at least one other in all but 63. Only this
 * one copy is used; verses are never mixed between copies.
 *
 * Conversion changes typography only: the source's backtick apostrophes
 * ("wife`s") become ’, runs of spaces collapse, and ends are trimmed.
 * Wording, punctuation, verse numbers, and the source's square brackets are
 * kept exactly: [and] marks words the translators supplied (printed in
 * italics in 1901), and a wholly bracketed verse (e.g. Matthew 17:21) is one
 * the ASV prints only in its margin (Matthew 23:14 is an unbracketed exception
 * in this copy; see the cross-check). The source has no Psalm
 * superscriptions, section headings, or poetry line breaks, so none are
 * added.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const SHA256 = "ef20ebf6b56bf1e3dfab949af55e83ff5887565ed24aeecd51da7a45210914bf";

// Zefania book numbers 1–66 in canonical order → USFM codes.
const CODES = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB",
  "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP",
  "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI",
  "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
];

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
if (!args.xml || !args.out) {
  console.error("Usage: node scripts/bible-prepare-asv.mjs --xml <eng-asv.zefania.xml> --out <file.csv> [--only GEN:1-2,PSA:23]");
  process.exit(2);
}

const bytes = readFileSync(args.xml);
if (createHash("sha256").update(bytes).digest("hex") !== SHA256) {
  console.error("The file doesn't match eng-asv.zefania.xml at the pinned open-bibles commit. Nothing was written.");
  process.exit(1);
}
const xml = bytes.toString("utf8").replace(/^﻿/, "");
if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
  console.error("The file uses DOCTYPE or entity declarations, which aren't allowed. Nothing was written.");
  process.exit(1);
}

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

const doc = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["BIBLEBOOK", "CHAPTER", "VERS"].includes(name),
}).parse(xml);

const csv = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const clean = (s) => String(s).replace(/`/g, "’").replace(/\s+/g, " ").trim();
const lines = ["book,chapter,verse,text"];
let verses = 0;
for (const book of doc.XMLBIBLE.BIBLEBOOK) {
  const n = Number(book.bnumber);
  const code = CODES[n - 1];
  if (!code) throw new Error(`Unexpected book number ${book.bnumber}`);
  if (only.size && !only.has(code)) continue;
  const [from, to] = only.get(code) ?? [1, 999];
  for (const chapter of book.CHAPTER) {
    const c = Number(chapter.cnumber);
    if (c < from || c > to) continue;
    for (const v of chapter.VERS) {
      const text = typeof v === "string" ? v : (v["#text"] ?? "");
      lines.push([code, c, Number(v.vnumber), csv(clean(text))].join(","));
      verses += 1;
    }
  }
}
writeFileSync(args.out, `${lines.join("\n")}\n`);
console.log(`Wrote ${verses} verses to ${args.out}.`);
