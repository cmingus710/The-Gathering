import { Bookmark } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { Translation, Verse } from "@/lib/bible/types";

/**
 * Scripture as received from its source: one span per verse, in order, with
 * a visible verse number (read aloud as "verse 16" before its text) and the
 * source's own headings, paragraph starts, and poetry line breaks. Nothing
 * is reworded, combined, or filled in: a verse the translation omits says
 * so. Highlights are the member's own and only change the background of
 * the verse text (never the verse number, headings, or attribution).
 *
 * Copying and printing follow the translation's permissions; these are
 * courtesies a browser can't strictly enforce, and the license page says so.
 */
export type ScriptureProps = {
  verses: Verse[];
  translation: Pick<Translation, "code" | "allow_copy" | "allow_print">;
  highlights?: ReadonlyMap<number, string>;
  selected?: ReadonlySet<number>;
  verseNumbers?: boolean;
  /** Show chapter numbers when a passage crosses chapters. */
  showChapters?: boolean;
  /** Verse numbers become buttons; `extend` asks to extend the selection (Shift, arrow keys with Shift). */
  onVerseToggle?: (verse: number, extend: boolean) => void;
  /** Verse-selection mode: a tap anywhere on a verse selects it (ordinary text selection pauses). */
  selectMode?: boolean;
  /** Give each verse an id ("v16") so a link can open the page at it (one passage per page only). */
  anchors?: boolean;
  /** Bookmarked passages, by first verse ("John 3:16–18"): a small marker before that verse. */
  bookmarks?: ReadonlyMap<number, string>;
  /** Verses outlined as the place the member came back to (a bookmark). */
  focused?: ReadonlySet<number>;
  label: string;
  className?: string;
};

export function ScriptureText({ verses, translation, highlights, selected, verseNumbers = true, showChapters, onVerseToggle, selectMode, anchors, bookmarks, focused, label, className }: ScriptureProps) {
  const blocks: Array<{ key: string; heading: string | null; chapter: number | null; poetry: boolean; verses: Verse[] }> = [];
  let lastChapter: number | null = null;
  for (const v of verses) {
    const newChapter = showChapters && v.c !== lastChapter;
    const prev = blocks[blocks.length - 1];
    if (!prev || v.p || v.h || newChapter || prev.poetry !== v.q) {
      blocks.push({ key: `${v.c}:${v.v}`, heading: v.h, chapter: newChapter ? v.c : null, poetry: v.q, verses: [v] });
    } else {
      prev.verses.push(v);
    }
    lastChapter = v.c;
  }
  return (
    <>
      <div
        className={cn("scripture text-text", className)}
        lang="en"
        aria-label={label}
        role="region"
        data-verse-numbers={verseNumbers ? "on" : "off"}
        data-select-mode={selectMode && onVerseToggle ? "on" : undefined}
        data-no-copy={translation.allow_copy ? undefined : "true"}
        data-no-print={translation.allow_print ? undefined : "true"}
      >
        {blocks.map((b) => (
          <div key={b.key}>
            {b.chapter !== null ? <h3 className="mt-6 mb-2 font-sans text-meta font-bold uppercase tracking-wide text-text-secondary">Chapter {b.chapter}</h3> : null}
            {b.heading ? <p className="mt-5 mb-2 font-sans text-meta font-semibold italic text-text-secondary">{b.heading}</p> : null}
            <p className={cn("mb-3", b.poetry && "poetry")}>
              {b.verses.map((v) => (
                <VerseSpan
                  key={`${v.c}:${v.v}`}
                  v={v}
                  color={highlights?.get(v.v)}
                  selected={selected?.has(v.v)}
                  onToggle={onVerseToggle}
                  selectMode={selectMode}
                  anchor={anchors && !showChapters}
                  bookmark={showChapters ? undefined : bookmarks?.get(v.v)}
                  focused={!showChapters && focused?.has(v.v)}
                />
              ))}
            </p>
          </div>
        ))}
      </div>
      {translation.allow_print ? null : (
        <p className="print-notice hidden">This translation&apos;s license doesn&apos;t allow printing ({translation.code}).</p>
      )}
    </>
  );
}

/** Moves focus to the previous or next verse-number button in the same passage. */
function focusSibling(from: HTMLElement, step: 1 | -1): number | null {
  const region = from.closest(".scripture");
  if (!region) return null;
  const buttons = [...region.querySelectorAll<HTMLButtonElement>("button.verse-num")];
  const next = buttons[buttons.indexOf(from as HTMLButtonElement) + step];
  if (!next) return null;
  next.focus();
  return Number(next.closest<HTMLElement>("[data-verse]")?.dataset.verse) || null;
}

function VerseSpan({
  v,
  color,
  selected,
  onToggle,
  selectMode,
  anchor,
  bookmark,
  focused,
}: {
  v: Verse;
  color?: string;
  selected?: boolean;
  onToggle?: (verse: number, extend: boolean) => void;
  selectMode?: boolean;
  anchor?: boolean;
  bookmark?: string;
  focused?: boolean;
}) {
  const num: ReactNode = onToggle ? (
    <button
      type="button"
      className="verse-num cursor-pointer rounded px-0.5 hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
      aria-pressed={!!selected}
      aria-label={`Verse ${v.v}${selected ? ", selected" : ""}`}
      aria-keyshortcuts="Shift+ArrowDown Shift+ArrowUp Escape"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(v.v, e.shiftKey);
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const target = focusSibling(e.currentTarget, step);
        // Shift+arrow extends the selection to the verse focus moved to.
        if (target && e.shiftKey) onToggle(target, true);
      }}
    >
      {v.v}
    </button>
  ) : (
    <sup className="verse-num">
      <span className="sr-only">Verse </span>
      {v.v}
    </sup>
  );
  const text = v.o ? <span className="font-sans text-meta italic text-text-secondary">(This verse isn&apos;t included in this translation.)</span> : v.t;
  return (
    <span
      id={anchor ? `v${v.v}` : undefined}
      data-verse={v.v}
      data-selected={selected ? "true" : undefined}
      data-focus={focused ? "true" : undefined}
      // Selection mode only: a pointer tap on the verse text (keyboard users have the verse-number buttons).
      onClick={selectMode && onToggle ? (e) => onToggle(v.v, e.shiftKey) : undefined}
      className={anchor ? "scroll-mt-24" : undefined}
    >
      {bookmark ? (
        <span className="verse-bookmark" title={`Bookmarked: ${bookmark}`}>
          <Bookmark className="inline size-[0.75em] fill-current align-baseline" aria-hidden="true" />
          <span className="sr-only">Bookmarked: {bookmark}. </span>
        </span>
      ) : null}
      {num}
      {color ? <mark data-color={color}>{text}</mark> : text}{" "}
    </span>
  );
}

export function Attribution({ translation, extra }: { translation: Pick<Translation, "code" | "name" | "attribution" | "copyright" | "source_url">; extra?: string | null }) {
  const lines = [translation.attribution, translation.copyright, extra].filter((x): x is string => !!x && !!x.trim());
  return (
    <footer className="mt-6 border-t border-border pt-3 text-meta text-text-secondary">
      <p>
        <span className="font-semibold text-text">{translation.code}</span> · {translation.name}
      </p>
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </footer>
  );
}
