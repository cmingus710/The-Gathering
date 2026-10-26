import { findBookCode, parsePassages } from "./reference";
import { HIGHLIGHT_COLORS, type HighlightColor } from "./format";

/**
 * Scripture highlights (migration 20261126000100): pure helpers shared by the
 * reader and My Journal. A highlight is one row per verse (translation,
 * book, chapter, verse) with a color and a revision; nothing here holds
 * scripture text.
 *
 * Selections are one verse or a contiguous range within one chapter. The
 * reader never selects across chapters: each chapter is highlighted on its
 * own page.
 */
export type HighlightRow = { verse: number; color: HighlightColor; revision: number; updated_at?: string };

export type ApplyResult =
  | { ok: true; status: "saved" | "conflict"; highlights: HighlightRow[] }
  | { ok: false; message: string; retryable: boolean };

export function isHighlightColor(value: unknown): value is HighlightColor {
  return HIGHLIGHT_COLORS.some((c) => c.value === value);
}

export function colorLabel(value: string): string {
  return HIGHLIGHT_COLORS.find((c) => c.value === value)?.label ?? value;
}

export type Range = { start: number; end: number };

/**
 * The next selection after activating a verse.
 *   - nothing selected: that verse (it becomes the anchor);
 *   - `extend` (Shift, or a tap in selection mode while one verse is
 *     selected): the range from the anchor to that verse;
 *   - the only selected verse again: nothing;
 *   - otherwise: that verse alone, as a new anchor.
 */
export function nextSelection(current: Range | null, anchor: number | null, verse: number, extend: boolean): { range: Range | null; anchor: number | null } {
  if (!current || anchor === null) return { range: { start: verse, end: verse }, anchor: verse };
  if (current.start === current.end && current.start === verse) return { range: null, anchor: null };
  if (extend || current.start === current.end) return { range: { start: Math.min(anchor, verse), end: Math.max(anchor, verse) }, anchor };
  return { range: { start: verse, end: verse }, anchor: verse };
}

export function versesOf(range: Range | null): number[] {
  if (!range) return [];
  return Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
}

/** What a selection holds: which colors, whether they differ, and whether any verse is highlighted. */
export function selectionColors(verses: number[], highlights: ReadonlyMap<number, string>) {
  const counts = new Map<string, number>();
  for (const v of verses) {
    const c = highlights.get(v);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const highlighted = [...counts.values()].reduce((a, b) => a + b, 0);
  const single = counts.size === 1 && highlighted === verses.length ? [...counts.keys()][0] : null;
  return {
    counts,
    /** Every verse has this one color. */
    color: single,
    /** More than one color, or some highlighted and some not. */
    mixed: counts.size > 1 || (highlighted > 0 && highlighted < verses.length),
    anyHighlighted: highlighted > 0,
  };
}

/** aria-pressed for a color button: every verse, some verses, or none. */
export function colorPressed(color: string, verses: number[], highlights: ReadonlyMap<number, string>): boolean | "mixed" {
  const n = verses.filter((v) => highlights.get(v) === color).length;
  return n === 0 ? false : n === verses.length ? true : "mixed";
}

/** The revisions the member's view had, for the server's stale-save check (0 = not highlighted). */
export function expectedRevisions(verses: number[], revisions: ReadonlyMap<number, number>): Record<string, number> {
  return Object.fromEntries(verses.map((v) => [String(v), revisions.get(v) ?? 0]));
}

/** "John 3:16" or "John 3:16–18" (Psalm for one psalm, like bible.passage_label). */
export function rangeLabel(book: string, bookName: string, chapter: number, range: Range): string {
  const name = book === "PSA" ? "Psalm" : bookName;
  return `${name} ${chapter}:${range.start}${range.end !== range.start ? `–${range.end}` : ""}`;
}

/** The memory-verse creation page with this passage and translation chosen (the member still reviews and confirms). */
export function memoryAddHref(p: { translationId: string; book: string; chapter: number; start: number; end: number }): string {
  const q = new URLSearchParams({ t: p.translationId, book: p.book, c: String(p.chapter), from: String(p.start), to: String(p.end), source: "highlight" });
  return `/memory/verses/add?${q}`;
}

/** The reader at a passage, scrolled to its first verse. */
export function readerHref(p: { code: string; book: string; chapter: number; start?: number }): string {
  return `/bible/read/${encodeURIComponent(p.code)}/${p.book}/${p.chapter}${p.start ? `#v${p.start}` : ""}`;
}

export type PassageRef = { translation_id: string; book: string; chapter: number; start_verse: number; end_verse: number };

/** The text cache key of a passage (no color: recoloring keeps the text shown). */
export function textKey(p: PassageRef): string {
  return `${p.translation_id}:${p.book}:${p.chapter}:${p.start_verse}-${p.end_verse}`;
}

export type RefFilter = { book: string; sc: number | null; sv: number | null; ec: number | null; ev: number | null };

/**
 * A reference search ("John 3", "Jn 3:16-18", "Psalms", "1 Cor 13") as a
 * filter: passages overlapping it. A whole book matches any of its
 * chapters. Only the first reference is used.
 */
export function refFilter(query: string): { ok: true; ref: RefFilter | null } | { ok: false; error: string } {
  const q = query.trim();
  if (!q) return { ok: true, ref: null };
  const book = findBookCode(q.replace(/[.\s]+$/, ""));
  if (book) return { ok: true, ref: { book, sc: null, sv: null, ec: null, ev: null } };
  const parsed = parsePassages(q.split(/[;,]/)[0]);
  if (!parsed.ok) return { ok: false, error: "Search by a reference, such as “John 3”, “Psalm 23:1–3”, or “Romans”." };
  const p = parsed.passages[0];
  return { ok: true, ref: { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev } };
}
