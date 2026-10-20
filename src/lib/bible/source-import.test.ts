import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatFromName, parseSourceFile } from "./source-import";

const SAMPLE = readFileSync(path.resolve(__dirname, "../../../tests/fixtures/bible/web-sample.csv"), "utf8");

describe("parseSourceFile", () => {
  it("reads the public-domain WEB sample exactly", () => {
    const rows = parseSourceFile(SAMPLE, "csv");
    expect(rows).toHaveLength(188);
    expect(rows.every((r) => r.issue === null)).toBe(true);
    const john = rows.find((r) => r.book === "JHN" && r.chapter === 3 && r.verse === 16)!;
    expect(john.text).toBe("For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.");
    const ps = rows.find((r) => r.book === "PSA" && r.verse === 1)!;
    expect(ps).toMatchObject({ heading: "A Psalm by David.", poetry: true, para: true, text: "Yahweh is my shepherd:\nI shall lack nothing." });
    expect(rows.find((r) => r.book === "ACT" && r.verse === 37)!.text).toBe("");
  });

  it("flags unreadable lines and unknown books without guessing", () => {
    const rows = parseSourceFile("book,chapter,verse,text\nJHN,3,16,Text\nXYZ,1,1,Unknown\nJHN,three,1,Bad number\nJohn,3,17,By name\n", "csv");
    expect(rows.map((r) => r.issue)).toEqual([null, "unknown_book", "malformed", null]);
    expect(rows[2]).toMatchObject({ chapter: null, verse: null, text: "JHN | three | 1 | Bad number" });
    expect(rows[3].book).toBe("JHN");
  });

  it("reads verse-per-line text with comments", () => {
    const rows = parseSourceFile("# comment\nGEN 1:1 In the beginning.\nGEN 1:2\nnonsense\n", "vpl");
    expect(rows).toMatchObject([
      { line: 2, book: "GEN", chapter: 1, verse: 1, text: "In the beginning.", issue: null },
      { line: 3, verse: 2, text: "", issue: null },
      { line: 4, issue: "malformed", text: "nonsense" },
    ]);
  });

  it("needs the required columns", () => {
    expect(() => parseSourceFile("b,c,v,t\n", "csv")).toThrow(/book, chapter, verse, text/);
    expect(formatFromName("web.CSV")).toBe("csv");
    expect(formatFromName("web.txt")).toBe("vpl");
    expect(formatFromName("web.pdf")).toBeNull();
  });
});
