import { describe, expect, it } from "vitest";
import { findBookCode, formatPassage, formatPassages, parsePassages, type Passage } from "./reference";

const ok = (input: string): Passage[] => {
  const r = parsePassages(input);
  if (!r.ok) throw new Error(r.error);
  return r.passages;
};
const err = (input: string): string => {
  const r = parsePassages(input);
  if (r.ok) throw new Error(`expected an error for ${input}`);
  return r.error;
};

describe("parsePassages", () => {
  it("reads verse ranges, whole chapters, and chapter ranges", () => {
    expect(ok("John 3:16–21")).toEqual([{ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 21 }]);
    expect(ok("Psalm 23")).toEqual([{ book: "PSA", sc: 23, sv: null, ec: 23, ev: null }]);
    expect(ok("Genesis 1–2")).toEqual([{ book: "GEN", sc: 1, sv: null, ec: 2, ev: null }]);
    expect(ok("Gen 1:1-2:3")).toEqual([{ book: "GEN", sc: 1, sv: 1, ec: 2, ev: 3 }]);
    expect(ok("Genesis 1-2:3")).toEqual([{ book: "GEN", sc: 1, sv: null, ec: 2, ev: 3 }]);
    expect(ok("John 3:16")).toEqual([{ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 16 }]);
    expect(ok("John 3:16 — 21")).toEqual([{ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 21 }]);
  });

  it("keeps several passages, including several from the same book", () => {
    expect(ok("Genesis 1–2; Psalm 23")).toHaveLength(2);
    expect(ok("John 3:1-8; John 3:16-21")).toEqual([
      { book: "JHN", sc: 3, sv: 1, ec: 3, ev: 8 },
      { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 21 },
    ]);
    expect(ok("Matthew 5:1–12, 43–48")).toEqual([
      { book: "MAT", sc: 5, sv: 1, ec: 5, ev: 12 },
      { book: "MAT", sc: 5, sv: 43, ec: 5, ev: 48 },
    ]);
    expect(ok("Psalm 1, 2")).toEqual([
      { book: "PSA", sc: 1, sv: null, ec: 1, ev: null },
      { book: "PSA", sc: 2, sv: null, ec: 2, ev: null },
    ]);
    expect(ok("John 3:16, 4:1-4")).toEqual([
      { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 16 },
      { book: "JHN", sc: 4, sv: 1, ec: 4, ev: 4 },
    ]);
  });

  it("accepts controlled aliases, codes, and ordinals", () => {
    for (const [input, code] of [
      ["1 Cor 13", "1CO"], ["I Corinthians 13", "1CO"], ["First John 1", "1JN"], ["1JN 1", "1JN"], ["Ps 23", "PSA"],
      ["Song of Solomon 2", "SNG"], ["Song of Songs 2", "SNG"], ["Rev. 21", "REV"], ["jhn 3", "JHN"], ["Phil 4", "PHP"], ["Phlm 1:4", "PHM"],
      // Abbreviations from a church's printed yearly plan.
      ["He 1", "HEB"], ["Jsh 1", "JOS"], ["Zph 1", "ZEP"], ["Gn 1", "GEN"], ["Lv 1", "LEV"], ["Dn 1", "DAN"], ["Ho 1", "HOS"], ["1Ch 1", "1CH"],
      ["2Jn 1", "2JN"], ["3 Jn 1", "3JN"], ["1 Jn 1", "1JN"], ["Eze 1", "EZK"], ["La 1", "LAM"], ["Pr 1", "PRO"], ["Ro 1", "ROM"], ["Act 1", "ACT"],
    ] as const) {
      expect(ok(input)[0].book).toBe(code);
    }
  });

  it("refuses ambiguous or unknown book names instead of guessing", () => {
    for (const name of ["Jo 3", "Ju 1", "Ph 1", "Ma 1", "Th 1", "Ti 1", "Hezekiah 1", "John's 3"]) {
      expect(err(name)).toMatch(/isn't a book name|isn't a reference/);
    }
    expect(findBookCode("Jo")).toBeNull();
  });

  it("handles one-chapter books: a bare number is a verse, a bare 1 the whole book", () => {
    expect(ok("Jude 3")).toEqual([{ book: "JUD", sc: 1, sv: 3, ec: 1, ev: 3 }]);
    expect(ok("Jude 3-7")).toEqual([{ book: "JUD", sc: 1, sv: 3, ec: 1, ev: 7 }]);
    expect(ok("Jude 1:1-25")).toEqual([{ book: "JUD", sc: 1, sv: 1, ec: 1, ev: 25 }]);
    expect(ok("Jude")).toEqual([{ book: "JUD", sc: 1, sv: null, ec: 1, ev: null }]);
    // A bare 1 is the book's only chapter, as reading schedules write "2 John 1".
    expect(ok("Jude 1")).toEqual([{ book: "JUD", sc: 1, sv: null, ec: 1, ev: null }]);
    expect(ok("2Jn 1")).toEqual([{ book: "2JN", sc: 1, sv: null, ec: 1, ev: null }]);
    expect(ok("Jude 1:1")).toEqual([{ book: "JUD", sc: 1, sv: 1, ec: 1, ev: 1 }]);
  });

  it("rejects chapters and verses that don't exist, and backwards ranges", () => {
    expect(err("John 22")).toMatch(/John has 21 chapters/);
    expect(err("John 3:37")).toMatch(/John 3 has 36 verses/);
    expect(err("Psalm 151")).toMatch(/150 chapters/);
    expect(err("John 3:21-16")).toMatch(/ends before it starts/);
    expect(err("Genesis 3-1")).toMatch(/ends before it starts/);
    expect(err("John 3:16a")).toMatch(/isn't a reference|chapter or verse/);
    expect(err("Psalms")).toMatch(/too long for one passage/);
    expect(err("")).toMatch(/Enter a passage/);
    expect(err("Genesis 1-45")).toMatch(/at most 40 chapters/);
  });
});

describe("formatPassage", () => {
  it("matches the database labels", () => {
    expect(formatPassage({ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 21 })).toBe("John 3:16–21");
    expect(formatPassage({ book: "PSA", sc: 23, sv: null, ec: 23, ev: null })).toBe("Psalm 23");
    expect(formatPassage({ book: "PSA", sc: 1, sv: null, ec: 2, ev: null })).toBe("Psalms 1–2");
    expect(formatPassage({ book: "GEN", sc: 1, sv: null, ec: 2, ev: 3 })).toBe("Genesis 1–2:3");
    expect(formatPassage({ book: "GEN", sc: 1, sv: 1, ec: 2, ev: 3 })).toBe("Genesis 1:1–2:3");
    expect(formatPassage({ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 16 })).toBe("John 3:16");
    expect(formatPassages(ok("Gen 1-2; Ps 23"))).toBe("Genesis 1–2; Psalm 23");
  });
});
