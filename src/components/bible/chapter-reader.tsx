"use client";

import { AlertCircle, Bookmark, Check, ListPlus, Minus, MousePointerClick, NotebookPen, Plus, RotateCw, Type, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { applyHighlightAction, chapterHighlightsAction, readerPrefsAction, toggleBookmarkAction } from "@/app/(app)/(member)/bible/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { HighlightColor } from "@/lib/bible/format";
import {
  colorLabel,
  colorPressed,
  expectedRevisions,
  memoryAddHref,
  nextSelection,
  rangeLabel,
  selectionColors,
  versesOf,
  type ApplyResult,
  type HighlightRow,
  type Range,
} from "@/lib/bible/highlights";
import type { Translation, Verse } from "@/lib/bible/types";
import { HighlightColorButtons } from "./highlight-colors";
import { ScriptureText } from "./scripture";

export type ReaderPrefs = { text_size: number; line_spacing: number; verse_numbers: boolean };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "conflict"; message: string }
  | { status: "failed"; message: string; retry: () => void };

/**
 * A chapter with the member's own highlights. Selecting a verse number (or,
 * in verse-selection mode, tapping anywhere on a verse) selects that verse;
 * a second verse selects the range between them (Shift extends it with a
 * mouse or keyboard). A small toolbar then offers six highlight colors,
 * removing the highlight, adding the passage to Memory Verses, a bookmark,
 * or a private journal note. Selections stay within this chapter.
 *
 * Saves go to the member's account and are shown as saving, saved, or not
 * saved (with Retry); the page is only updated from the server's answer, so
 * a failed save never looks saved. Each save names the revision of every
 * verse as shown here: if another device changed one meanwhile, nothing is
 * overwritten and the current highlights are shown instead. Coming back to
 * the tab re-reads the chapter's highlights.
 *
 * Text size, line spacing, and verse numbers are presentation settings
 * saved to the member's account, separate from the scripture itself.
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
  initialHighlights: HighlightRow[];
  prefs: ReaderPrefs;
}) {
  const [rows, setRows] = useState(initialHighlights);
  const highlights = useMemo(() => new Map(rows.map((h) => [h.verse, h.color as string])), [rows]);
  const revisions = useMemo(() => new Map(rows.map((h) => [h.verse, h.revision])), [rows]);
  const [range, setRange] = useState<Range | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [size, setSize] = useState(prefs.text_size);
  const [leading, setLeading] = useState(prefs.line_spacing);
  const [numbers, setNumbers] = useState(prefs.verse_numbers);
  const [message, setMessage] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [pending, start] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = save.status === "saving" || pending;
  const busyRef = useRef(false);
  // Bumped by every save, so a slower re-read never replaces a newer answer.
  const generation = useRef(0);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const sorted = useMemo(() => versesOf(range), [range]);
  const selected = useMemo(() => new Set(sorted), [sorted]);
  const label = range ? rangeLabel(book, bookName, chapter, range) : "";
  const state = selectionColors(sorted, highlights);

  const savePrefs = (p: Partial<ReaderPrefs>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void readerPrefsAction(p), 600);
  };
  const clear = () => {
    setRange(null);
    setAnchor(null);
  };
  const toggle = (v: number, extend: boolean) => {
    const next = nextSelection(range, anchor, v, extend);
    setRange(next.range);
    setAnchor(next.anchor);
    if (save.status !== "saving") setSave({ status: "idle" });
  };

  // Escape cancels the selection.
  useEffect(() => {
    if (!range) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [range]);

  // Highlights changed on another device (or in My Journal) appear when
  // the member comes back to this page.
  const refresh = useCallback(async () => {
    if (busyRef.current || document.visibilityState !== "visible") return;
    const g = generation.current;
    try {
      const r = await chapterHighlightsAction({ translationId: translation.id, book, chapter });
      if (r.ok && !busyRef.current && g === generation.current) setRows(r.highlights);
    } catch {
      // Offline: keep what's shown; the next save is still checked on the server.
    }
  }, [translation.id, book, chapter]);
  useEffect(() => {
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const send = async (req: Parameters<typeof applyHighlightAction>[0], what: string) => {
    generation.current += 1;
    busyRef.current = true;
    setSave({ status: "saving" });
    let r: ApplyResult;
    try {
      r = await applyHighlightAction(req);
    } catch {
      r = { ok: false, message: "The connection was interrupted.", retryable: true };
    }
    if (!r.ok) {
      setSave({ status: "failed", message: `${what} wasn't saved. ${r.message}`, retry: () => void send(req, what) });
      return;
    }
    setRows(r.highlights);
    if (r.status === "conflict") {
      setSave({ status: "conflict", message: "These verses were changed on another device. Their current highlights are shown; nothing was changed. Choose again." });
      return;
    }
    setSave({ status: "saved", message: `${what} saved.` });
    clear();
  };
  const highlight = (color: HighlightColor | null) => {
    if (!range) return;
    const req = { translationId: translation.id, book, chapter, verses: sorted, color, expected: expectedRevisions(sorted, revisions) };
    void send(req, color ? `${colorLabel(color)} highlight on ${label}` : `Removing the highlight from ${label}`);
  };
  const bookmark = () =>
    start(async () => {
      if (!range) return;
      const r = await toggleBookmarkAction({ kind: "passage", translation_id: translation.id, book, chapter, start_verse: range.start, end_verse: range.end });
      setMessage(r.ok ? (r.bookmarked ? `Bookmarked ${label}.` : `Removed the bookmark for ${label}.`) : r.message);
    });
  const noteHref = range
    ? `/journal/new?${new URLSearchParams({ t: translation.id, b: book, c: String(chapter), sv: String(range.start), ev: String(range.end) })}`
    : "";
  const memoryHref = range ? memoryAddHref({ translationId: translation.id, book, chapter, start: range.start, end: range.end }) : "";

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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p id="reader-select-hint" className="text-meta text-text-secondary">
          {selectMode
            ? "Tap a verse to select it, then another to select the verses between. Selections stay within this chapter."
            : numbers
              ? "Select a verse number, then another for a range (or Shift-click), to highlight, add to Memory Verses, bookmark, or write about it."
              : "Turn on Select verses (or show verse numbers) to highlight verses."}
        </p>
        <Button
          size="sm"
          variant={selectMode ? "primary" : "secondary"}
          aria-pressed={selectMode}
          onClick={() => setSelectMode((m) => !m)}
          icon={<MousePointerClick className="size-4" aria-hidden="true" />}
        >
          Select verses
        </Button>
      </div>

      <div style={{ ["--reader-size" as string]: size / 100, ["--reader-leading" as string]: leading }}>
        <ScriptureText
          verses={verses}
          translation={translation}
          highlights={highlights}
          selected={selected}
          verseNumbers={numbers}
          onVerseToggle={toggle}
          selectMode={selectMode}
          anchors
          label={`${bookName} ${chapter}, ${translation.code}`}
        />
      </div>

      <p role="status" className="sr-only">
        {save.status === "saving" ? "Saving…" : save.status === "idle" ? (message ?? (range ? `${label} selected.` : "")) : save.message}
      </p>
      {message ? <p className="mt-2 text-meta text-text-secondary">{message}</p> : null}
      {save.status === "saved" && !range ? (
        <p className="mt-2 flex items-center gap-1.5 text-meta text-text-secondary">
          <Check className="size-4 text-success" aria-hidden="true" /> {save.message}
        </p>
      ) : null}

      {range ? (
        <div
          role="toolbar"
          aria-label={`Actions for ${label}`}
          className="sticky bottom-[calc(var(--dock-clearance,5rem)+0.5rem)] z-20 mt-4 space-y-1.5 rounded-card border border-border bg-surface px-3 py-2 shadow-(--elev-lift) sm:space-y-2 sm:py-3 lg:bottom-4 print:hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="font-semibold">
              {label}{" "}
              <span className="font-normal text-text-secondary">
                · {state.color ? colorLabel(state.color) : state.mixed ? "Mixed colors" : "Not highlighted"}
              </span>
            </p>
            <Button size="sm" variant="ghost" onClick={clear} icon={<X className="size-4" aria-hidden="true" />}>
              Cancel
            </Button>
          </div>
          <HighlightColorButtons pressed={(c) => colorPressed(c, sorted, highlights)} onPick={highlight} disabled={busy} label={`Highlight color for ${label}`} />
          {/* One scrolling row on phones keeps the toolbar short, so it covers less of the chapter. */}
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible [&>*]:shrink-0">
            {state.anyHighlighted ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => highlight(null)} icon={<Minus className="size-4" aria-hidden="true" />}>
                Remove highlight
              </Button>
            ) : null}
            <ButtonLink href={memoryHref} size="sm" variant="secondary" icon={<ListPlus className="size-4" aria-hidden="true" />}>
              Add to Memory Verses
            </ButtonLink>
            <Button size="sm" variant="secondary" disabled={busy} onClick={bookmark} icon={<Bookmark className="size-4" aria-hidden="true" />}>
              Bookmark
            </Button>
            <ButtonLink href={noteHref} size="sm" variant="secondary" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
              Write privately
            </ButtonLink>
          </div>
          <SaveLine save={save} />
        </div>
      ) : save.status === "failed" || save.status === "conflict" ? (
        <div className="mt-4 rounded-card border border-border bg-surface p-3 print:hidden">
          <SaveLine save={save} />
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

/** Saving / not saved (with Retry) / changed elsewhere, inside the toolbar. */
function SaveLine({ save }: { save: SaveState }) {
  if (save.status === "saving") {
    return (
      <p className="flex items-center gap-2 text-meta text-text-secondary">
        <Spinner /> Saving…
      </p>
    );
  }
  if (save.status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-meta text-danger">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>{save.message}</span>
        <Button size="sm" variant="secondary" onClick={save.retry} icon={<RotateCw className="size-4" aria-hidden="true" />}>
          Retry
        </Button>
      </div>
    );
  }
  if (save.status === "conflict") {
    return (
      <p className="flex items-center gap-2 text-meta text-text">
        <AlertCircle className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {save.message}
      </p>
    );
  }
  return null;
}
