import { describe, expect, it } from "vitest";
import { colorPressed, expectedRevisions, memoryAddHref, nextSelection, parseFocus, rangeLabel, readerHref, refFilter, selectionColors, textKey, versesOf } from "./highlights";

describe("verse selection", () => {
  it("builds a contiguous range a verse at a time, and trims it from either end", () => {
    let s = nextSelection(null, null, 16, false);
    expect(s).toEqual({ range: { start: 16, end: 16 }, anchor: 16 });
    // Tapping the next verses grows the range.
    s = nextSelection(s.range, s.anchor, 17, false);
    expect(s.range).toEqual({ start: 16, end: 17 });
    s = nextSelection(s.range, s.anchor, 18, false);
    expect(s.range).toEqual({ start: 16, end: 18 });
    // A verse further away (or earlier) fills in the verses between.
    expect(nextSelection(s.range, s.anchor, 22, false).range).toEqual({ start: 16, end: 22 });
    expect(nextSelection(s.range, s.anchor, 12, false).range).toEqual({ start: 12, end: 18 });
    // Tapping an end removes it; tapping inside ends the range there.
    expect(nextSelection(s.range, s.anchor, 18, false).range).toEqual({ start: 16, end: 17 });
    expect(nextSelection(s.range, s.anchor, 16, false).range).toEqual({ start: 17, end: 18 });
    expect(nextSelection({ start: 16, end: 20 }, 16, 18, false).range).toEqual({ start: 16, end: 18 });
    // Shift extends from the anchor.
    expect(nextSelection(s.range, s.anchor, 20, true).range).toEqual({ start: 16, end: 20 });
    expect(nextSelection(s.range, s.anchor, 14, true).range).toEqual({ start: 14, end: 16 });
    // The single selected verse again clears the selection.
    expect(nextSelection({ start: 16, end: 16 }, 16, 16, false)).toEqual({ range: null, anchor: null });
    expect(versesOf({ start: 3, end: 6 })).toEqual([3, 4, 5, 6]);
    expect(versesOf(null)).toEqual([]);
  });

  it("reads a bookmark's focus range from the URL", () => {
    expect(parseFocus("16")).toEqual({ start: 16, end: 16 });
    expect(parseFocus("16-18")).toEqual({ start: 16, end: 18 });
    expect(parseFocus("18-16")).toBeNull();
    expect(parseFocus("0")).toBeNull();
    expect(parseFocus("abc")).toBeNull();
    expect(parseFocus(undefined)).toBeNull();
  });

  it("describes the colors in a selection, including mixed and partly highlighted", () => {
    const h = new Map([
      [1, "yellow"],
      [2, "yellow"],
      [3, "green"],
    ]);
    expect(selectionColors([1, 2], h)).toMatchObject({ color: "yellow", mixed: false, anyHighlighted: true });
    expect(selectionColors([2, 3], h)).toMatchObject({ color: null, mixed: true, anyHighlighted: true });
    expect(selectionColors([3, 4], h)).toMatchObject({ color: null, mixed: true, anyHighlighted: true });
    expect(selectionColors([4, 5], h)).toMatchObject({ color: null, mixed: false, anyHighlighted: false });
    expect(colorPressed("yellow", [1, 2], h)).toBe(true);
    expect(colorPressed("yellow", [1, 2, 3], h)).toBe("mixed");
    expect(colorPressed("blue", [1, 2, 3], h)).toBe(false);
  });

  it("sends the revision of every selected verse (0 when not highlighted)", () => {
    expect(expectedRevisions([16, 17, 18], new Map([[17, 42]]))).toEqual({ 16: 0, 17: 42, 18: 0 });
  });
});

describe("links and labels", () => {
  it("labels ranges like the database does", () => {
    expect(rangeLabel("JHN", "John", 3, { start: 16, end: 16 })).toBe("John 3:16");
    expect(rangeLabel("JHN", "John", 3, { start: 16, end: 18 })).toBe("John 3:16–18");
    expect(rangeLabel("PSA", "Psalms", 23, { start: 1, end: 3 })).toBe("Psalm 23:1–3");
  });

  it("opens memory-verse creation with the passage and translation chosen", () => {
    const href = memoryAddHref({ translationId: "11111111-1111-4111-8111-111111111111", book: "JHN", chapter: 3, start: 16, end: 18 });
    const u = new URL(href, "https://example.test");
    expect(u.pathname).toBe("/memory/verses/add");
    expect(Object.fromEntries(u.searchParams)).toEqual({ t: "11111111-1111-4111-8111-111111111111", book: "JHN", c: "3", from: "16", to: "18", source: "highlight" });
  });

  it("opens the reader at the passage", () => {
    expect(readerHref({ code: "WEB", book: "JHN", chapter: 3, start: 16 })).toBe("/bible/read/WEB/JHN/3#v16");
    expect(readerHref({ code: "WEB", book: "PSA", chapter: 23 })).toBe("/bible/read/WEB/PSA/23");
    // A bookmark: scrolled to its first verse, with the passage outlined.
    expect(readerHref({ code: "WEB", book: "JHN", chapter: 3, start: 16, end: 18 })).toBe("/bible/read/WEB/JHN/3?focus=16-18#v16");
    expect(readerHref({ code: "WEB", book: "JHN", chapter: 3, start: 16, end: 16 })).toBe("/bible/read/WEB/JHN/3?focus=16#v16");
  });

  it("keys passage text without the color, so recoloring keeps the text shown", () => {
    expect(textKey({ translation_id: "t", book: "JHN", chapter: 3, start_verse: 16, end_verse: 18 })).toBe("t:JHN:3:16-18");
  });
});

describe("reference search", () => {
  it("accepts books, chapters, and verse ranges", () => {
    expect(refFilter("")).toEqual({ ok: true, ref: null });
    expect(refFilter("Romans")).toEqual({ ok: true, ref: { book: "ROM", sc: null, sv: null, ec: null, ev: null } });
    expect(refFilter("Psalms")).toEqual({ ok: true, ref: { book: "PSA", sc: null, sv: null, ec: null, ev: null } });
    expect(refFilter("John 3")).toEqual({ ok: true, ref: { book: "JHN", sc: 3, sv: null, ec: 3, ev: null } });
    expect(refFilter("Jn 3:16-18")).toEqual({ ok: true, ref: { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 18 } });
    expect(refFilter("1 Cor 13")).toEqual({ ok: true, ref: { book: "1CO", sc: 13, sv: null, ec: 13, ev: null } });
  });

  it("explains what it can't read", () => {
    const r = refFilter("faith hope love");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Search by a reference/);
  });
});
