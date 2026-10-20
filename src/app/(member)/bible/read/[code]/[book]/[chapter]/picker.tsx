"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Book and chapter navigation (works as a plain form without JavaScript too). */
export function ChapterPicker({ code, books, book, chapter }: { code: string; books: Array<{ code: string; name: string; chapters: number }>; book: string; chapter: number }) {
  const router = useRouter();
  const [b, setB] = useState(book);
  const [c, setC] = useState(chapter);
  const chapters = books.find((x) => x.code === b)?.chapters ?? 1;
  const go = (nb: string, nc: number) => router.push(`/bible/read/${code}/${nb}/${nc}`);
  return (
    <form
      className="mb-5 flex flex-wrap items-end gap-2 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        go(b, Math.min(c, chapters));
      }}
    >
      <label className="flex flex-col text-meta text-text-secondary">
        Book
        <select
          className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base text-text"
          value={b}
          onChange={(e) => {
            setB(e.target.value);
            setC(1);
          }}
        >
          {books.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-meta text-text-secondary">
        Chapter
        <select className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base text-text" value={c} onChange={(e) => setC(Number(e.target.value))}>
          {Array.from({ length: chapters }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="min-h-11 rounded-full bg-cta px-5 font-semibold text-on-cta">
        Go
      </button>
    </form>
  );
}
