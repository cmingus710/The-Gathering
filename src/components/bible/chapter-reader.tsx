"use client";

import { Bookmark, Minus, NotebookPen, Plus, Type, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { highlightAction, readerPrefsAction, toggleBookmarkAction } from "@/app/(app)/(member)/bible/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { HIGHLIGHT_COLORS } from "@/lib/bible/format";
import type { Translation, Verse } from "@/lib/bible/types";
import { ScriptureText } from "./scripture";

export type ReaderPrefs = { text_size: number; line_spacing: number; verse_numbers: boolean };

/**
 * A chapter with the member's own highlights. Selecting verse numbers opens
 * a small toolbar: highlight (four colors, each named), remove highlight,
 * bookmark, or write a note in My Journal. Text size, line spacing, and
 * verse numbers are presentation settings saved to the member's account,
 * separate from the scripture itself.
 */
export function ChapterReader({
  translation,
  book,
  bookName,
  chapter,
  verses,
  initialHighlights,
  prefs,
}: {
  translation: Translation;
  book: string;
  bookName: string;
  chapter: number;
  verses: Verse[];
  initialHighlights: Array<{ verse: number; color: string }>;
  prefs: ReaderPrefs;
}) {
  const [highlights, setHighlights] = useState(() => new Map(initialHighlights.map((h) => [h.verse, h.color])));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [size, setSize] = useState(prefs.text_size);
  const [leading, setLeading] = useState(prefs.line_spacing);
  const [numbers, setNumbers] = useState(prefs.verse_numbers);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const range = sorted.length ? { start: sorted[0], end: sorted[sorted.length - 1] } : null;
  const label = range ? `${bookName} ${chapter}:${range.start}${range.end !== range.start ? `–${range.end}` : ""}` : "";

  const savePrefs = (p: Partial<ReaderPrefs>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void readerPrefsAction(p), 600);
  };
  const toggle = (v: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  const highlight = (color: string | null) =>
    start(async () => {
      const r = await highlightAction({ translationId: translation.id, book, chapter, verses: sorted, color });
      if (!r.ok) return setMessage(r.message);
      setHighlights(new Map(r.highlights.map((h) => [h.verse, h.color])));
      setMessage(color ? `Highlighted ${label}.` : `Removed the highlight from ${label}.`);
      setSelected(new Set());
    });
  const bookmark = () =>
    start(async () => {
      if (!range) return;
      const r = await toggleBookmarkAction({ kind: "passage", translation_id: translation.id, book, chapter, start_verse: range.start, end_verse: range.end });
      setMessage(r.ok ? (r.bookmarked ? `Bookmarked ${label}.` : `Removed the bookmark for ${label}.`) : r.message);
    });
  const noteHref = range
    ? `/journal/new?${new URLSearchParams({ t: translation.id, b: book, c: String(chapter), sv: String(range.start), ev: String(range.end) })}`
    : "";

  return (
    <div>
      <details className="mb-4 rounded-tile border border-border bg-surface px-4 py-2 print:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <Type className="size-4" aria-hidden="true" /> Reading settings
        </summary>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-3 pt-1">
          <div className="flex items-center gap-2" role="group" aria-label="Text size">
            <span className="text-meta text-text-secondary">Text size</span>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Smaller text"
              disabled={size <= 85}
              onClick={() => {
                const v = Math.max(85, size - 10);
                setSize(v);
                savePrefs({ text_size: v });
              }}
              icon={<Minus className="size-4" aria-hidden="true" />}
            >
              <span className="sr-only">Smaller</span>
            </Button>
            <span className="w-12 text-center text-meta tabular-nums" aria-live="polite">
              {size}%
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Larger text"
              disabled={size >= 200}
              onClick={() => {
                const v = Math.min(200, size + 10);
                setSize(v);
                savePrefs({ text_size: v });
              }}
              icon={<Plus className="size-4" aria-hidden="true" />}
            >
              <span className="sr-only">Larger</span>
            </Button>
          </div>
          <label className="flex items-center gap-2 text-meta">
            <span className="text-text-secondary">Line spacing</span>
            <select
              className="min-h-11 rounded-control border border-border-strong bg-surface px-3"
              value={leading.toFixed(2)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLeading(v);
                savePrefs({ line_spacing: v });
              }}
            >
              <option value="1.40">Compact</option>
              <option value="1.70">Comfortable</option>
              <option value="2.00">Roomy</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-meta">
            <input
              type="checkbox"
              className="size-5 accent-(--color-primary)"
              checked={numbers}
              onChange={(e) => {
                setNumbers(e.target.checked);
                savePrefs({ verse_numbers: e.target.checked });
              }}
            />
            Show verse numbers
          </label>
        </div>
      </details>

      <p className="mb-3 text-meta text-text-secondary print:hidden">
        {numbers ? "Select verse numbers to highlight, bookmark, or write about them." : "Show verse numbers to highlight or bookmark verses."}
      </p>

      <div style={{ ["--reader-size" as string]: size / 100, ["--reader-leading" as string]: leading }}>
        <ScriptureText
          verses={verses}
          translation={translation}
          highlights={highlights}
          selected={selected}
          verseNumbers={numbers}
          onVerseToggle={toggle}
          label={`${bookName} ${chapter}, ${translation.code}`}
        />
      </div>

      <p role="status" className="sr-only">
        {message ?? ""}
      </p>
      {message ? <p className="mt-2 text-meta text-text-secondary">{message}</p> : null}

      {range ? (
        <div
          role="toolbar"
          aria-label={`Actions for ${label}`}
          className="sticky bottom-[calc(var(--dock-clearance,5rem)+0.5rem)] z-20 lg:bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3 shadow-(--elev-lift) print:hidden"
        >
          <span className="mr-1 font-semibold">{label}</span>
          {HIGHLIGHT_COLORS.map((c) => (
            <Button key={c.value} size="sm" variant="secondary" disabled={pending} onClick={() => highlight(c.value)}>
              <span aria-hidden="true" className="size-3.5 rounded-full border border-border-strong" style={{ background: `var(--hl-${c.value})` }} />
              {c.label}
            </Button>
          ))}
          {sorted.some((v) => highlights.has(v)) ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => highlight(null)}>
              Remove highlight
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={pending} onClick={bookmark} icon={<Bookmark className="size-4" aria-hidden="true" />}>
            Bookmark
          </Button>
          <ButtonLink href={noteHref} size="sm" variant="secondary" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
            Write privately
          </ButtonLink>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} icon={<X className="size-4" aria-hidden="true" />}>
            Clear
          </Button>
        </div>
      ) : null}
      <noscript>
        <p className="mt-3 text-meta">
          Highlights and bookmarks need JavaScript. <Link href="/bible/bookmarks">Your bookmarks</Link>
        </p>
      </noscript>
    </div>
  );
}
