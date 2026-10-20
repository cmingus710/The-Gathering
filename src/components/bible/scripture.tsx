import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { Translation, Verse } from "@/lib/bible/types";

/**
 * Scripture as received from its source: one span per verse, in order, with
 * a visible verse number (read aloud as "verse 16" before its text) and the
 * source's own headings, paragraph starts, and poetry line breaks. Nothing
 * is reworded, combined, or filled in: a verse the translation omits says
 * so. Highlights are the member's own and only change the background.
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
  onVerseToggle?: (verse: number) => void;
  label: string;
  className?: string;
};

export function ScriptureText({ verses, translation, highlights, selected, verseNumbers = true, showChapters, onVerseToggle, label, className }: ScriptureProps) {
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
        data-no-copy={translation.allow_copy ? undefined : "true"}
        data-no-print={translation.allow_print ? undefined : "true"}
      >
        {blocks.map((b) => (
          <div key={b.key}>
            {b.chapter !== null ? <h3 className="mt-6 mb-2 font-sans text-meta font-bold uppercase tracking-wide text-text-secondary">Chapter {b.chapter}</h3> : null}
            {b.heading ? <p className="mt-5 mb-2 font-sans text-meta font-semibold italic text-text-secondary">{b.heading}</p> : null}
            <p className={cn("mb-3", b.poetry && "poetry")}>
              {b.verses.map((v) => (
                <VerseSpan key={`${v.c}:${v.v}`} v={v} color={highlights?.get(v.v)} selected={selected?.has(v.v)} onToggle={onVerseToggle} />
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

function VerseSpan({ v, color, selected, onToggle }: { v: Verse; color?: string; selected?: boolean; onToggle?: (verse: number) => void }) {
  const num: ReactNode = onToggle ? (
    <button
      type="button"
      className="verse-num cursor-pointer rounded px-0.5 hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
      aria-pressed={!!selected}
      aria-label={`Verse ${v.v}${selected ? ", selected" : ""}`}
      onClick={() => onToggle(v.v)}
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
    <span data-verse={v.v} data-selected={selected ? "true" : undefined}>
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
