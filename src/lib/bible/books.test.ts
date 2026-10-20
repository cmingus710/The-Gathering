import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKS } from "@/lib/media/scripture";
import { BOOK_LIST, lastVerse } from "./books";

describe("canonical books", () => {
  it("matches the database seed exactly", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261026000100_bible_schema.sql"), "utf8");
    const seed = [...sql.matchAll(/\(\s*(\d+), '([1-3A-Z][A-Z0-9]{2})', '([^']+)', '(OT|NT)', '\{([\d,]+)\}'\)/g)].map((m) => ({
      ordinal: +m[1], code: m[2], name: m[3], testament: m[4], verses: m[5].split(",").map(Number),
    }));
    expect(seed).toHaveLength(66);
    expect(seed.map(({ code, name, testament, verses }) => ({ code, name, testament, verses }))).toEqual(BOOK_LIST.map((b) => ({ ...b, verses: [...b.verses] })));
    expect(seed.map((s) => s.ordinal)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1));
  });

  it("uses the same names as Phase 7 scripture references", () => {
    expect(BOOK_LIST.map((b) => b.name)).toEqual([...BOOKS]);
  });

  it("has the familiar chapter and verse counts", () => {
    expect(BOOK_LIST.reduce((n, b) => n + b.verses.reduce((a, c) => a + c, 0), 0)).toBe(31_103);
    expect(BOOK_LIST.find((b) => b.code === "PSA")!.verses).toHaveLength(150);
    expect(lastVerse("JHN", 3)).toBe(36);
    expect(lastVerse("JHN", 22)).toBe(0);
  });
});
