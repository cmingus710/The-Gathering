import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bibleTarget, bodyBlocks } from "./calendar";
import { MORNING_EVENING, normalizeMorningEvening, readingKey } from "./morning-evening";

const file = path.resolve(__dirname, "../../..", MORNING_EVENING.localPath);
const bytes = readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = JSON.parse(bytes.toString("utf8")) as Array<Record<string, unknown>>;
const { readings, report } = normalizeMorningEvening(source, { sha256 });
const byKey = new Map(readings.map((r) => [r.source_key, r]));

describe("the pinned Morning & Evening file", () => {
  it("is the file pinned by commit and hash", () => {
    expect(sha256).toBe(MORNING_EVENING.source.sha256);
    expect(report.source.sha256_matches).toBe(true);
  });

  it("has a morning and an evening reading for all 366 days, February 29 included, and nothing else", () => {
    expect(report.records).toBe(732);
    expect(report.readings).toBe(732);
    expect(report.by_slot).toEqual({ morning: 366, evening: 366 });
    expect(report.days_complete).toBe(366);
    expect(report.missing).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.malformed).toEqual([]);
    expect(report.feb29).toEqual({ morning: true, evening: true });
    expect(report.ok).toBe(true);
    expect(new Set(readings.map((r) => r.source_key)).size).toBe(732);
  });

  it("keeps January 1 morning word for word, without the repeated heading", () => {
    const r = byKey.get("01-01-morning")!;
    expect(r.key_verse).toBe('"They did eat of the fruit of the land of Canaan that year."');
    expect(r.scripture_ref).toBe("Joshua 5:12");
    expect(r.body.startsWith("Israel's weary wanderings were all over, and the promised rest was attained.")).toBe(true);
    expect(r.body).toContain('we shall begin to be "for ever with the Lord."\n\nA part of the host will this year tarry on earth');
    expect(r.body.endsWith("O for grace to feed on Jesus, and so to eat of the fruit of the land of Canaan this year!")).toBe(true);
    expect(r.body).not.toMatch(/Morning Reading|January 1st/);
  });

  it("joins wrapped lines and keeps hymn lines and paragraph breaks", () => {
    const evening = byKey.get("01-01-evening")!;
    expect(evening.body).toContain("in the halls of the New Jerusalem.");
    const march16 = bodyBlocks(byKey.get("03-16-morning")!.body);
    expect(march16.at(-2)).toEqual({ kind: "lines", lines: ['"To me remains nor place, nor time:', "My country is in every clime;", "I can be calm and free from care", "On any shore, since God is there."] });
    expect(march16.at(-1)).toMatchObject({ kind: "lines", lines: expect.arrayContaining(["'Tis equal joy to go or stay.\""]) });
  });

  it("repairs Windows-1252 dashes and quotes, and the double-decoded quote in March 16 morning", () => {
    expect(byKey.get("01-05-evening")!.body).toContain('"God saw the light"—He looked at it');
    const march25 = byKey.get("03-25-morning")!;
    expect(march25.body.startsWith('"The kisses of an enemy are deceitful." ')).toBe(true);
    expect(byKey.get("03-26-morning")!.body).toContain("constant, self-forgetting, faithful love");
    expect(byKey.get("03-16-morning")!.key_verse).toBe('"I am a stranger with thee."');
    for (const r of readings) {
      expect(r.body + r.key_verse).not.toMatch(/[\u0080-\u009f�]|â\u0080|<[a-z/]/i);
      expect(r.body).not.toMatch(/ {2,}|^\s|\s$|\n{3,}/);
    }
    const fixes = Object.fromEntries(report.fixes.map((f) => [f.code, f.readings]));
    expect(fixes).toMatchObject({ heading_removed: 732, key_verse_split: 732, mojibake: 1, windows_1252: 52 });
  });

  it("finds no lowercase first letters to correct in this file (the upstream README's warning doesn't apply to it)", () => {
    expect(report.fixes.find((f) => f.code === "capitalized_start")).toBeUndefined();
    for (const r of readings) expect(r.body).toMatch(/^["'(]?[A-Z]/);
  });

  it("gives every reading a Scripture reference the Bible reader understands", () => {
    const unparsed = readings.filter((r) => !bibleTarget(r.scripture_ref)).map((r) => `${r.source_key} ${r.scripture_ref}`);
    expect(unparsed).toEqual([]);
    expect(bibleTarget(byKey.get("01-01-evening")!.scripture_ref)).toEqual({ book: "SNG", chapter: 1 });
  });
});

describe("normalizing a bad file", () => {
  const good = source.slice(0, 4);

  it("refuses records it can't trust and reports each one", () => {
    const bad = [
      null,
      { ...good[0] },
      { ...good[1], time: "noon" },
      { ...good[2], date: "1-3" },
      { ...good[3], body: "Wrong heading\r\n    x\r\n    \n\n    Text" },
      { ...good[0], month: 2, day: 30, date: "2-30" },
      { ...good[1], keyverse: "No reference here" },
    ];
    const { readings: out, report: r } = normalizeMorningEvening([good[0], ...bad]);
    expect(out.map((x) => x.source_key)).toEqual(["01-01-morning"]);
    expect(r.malformed.map((m) => m.code)).toEqual(["not_an_object", "duplicate", "bad_time", "date_mismatch", "heading_mismatch", "bad_day", "key_verse_format"]);
    expect(r.duplicates).toEqual(["01-01-morning"]);
    expect(r.missing).toHaveLength(731);
    expect(r.missing).toContain("01-02-evening");
    expect(r.ok).toBe(false);
  });

  it("refuses a file whose hash doesn't match the pinned one, and a file that isn't a list", () => {
    expect(normalizeMorningEvening(source, { sha256: "0".repeat(64) }).report.ok).toBe(false);
    const { report: r } = normalizeMorningEvening({ not: "a list" });
    expect(r.malformed[0].code).toBe("not_a_list");
    expect(r.ok).toBe(false);
  });

  it("capitalizes a lowercase first letter (the upstream README's warning) and strips HTML", () => {
    const rec = { ...good[0], body: String(good[0].body).replace("Israel's", "<b>israel&#146;s</b>") };
    const { readings: out, report: r } = normalizeMorningEvening([rec]);
    expect(out[0].body.startsWith("Israel's weary")).toBe(true);
    expect(r.fixes.map((f) => f.code)).toEqual(expect.arrayContaining(["capitalized_start", "html_removed"]));
  });

  it("uses stable source keys", () => {
    expect(readingKey(2, 29, "evening")).toBe("02-29-evening");
  });
});

describe("the server's copy of the source path", () => {
  it("reads the same file MORNING_EVENING.localPath names (and next.config.ts traces)", () => {
    const source = readFileSync(path.resolve(__dirname, "source.ts"), "utf8");
    const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");
    expect(source).toContain(`"${MORNING_EVENING.localPath}"`);
    expect(config).toContain(`"./${MORNING_EVENING.localPath}"`);
  });
});
