"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Session } from "@/lib/memory/types";

/**
 * A licensed version's abbreviation and a link to its full copyright notice,
 * kept on screen for the whole exercise (API.Bible: visible during the
 * exercise itself, not only before or after; ToS §7.2). It sticks just below
 * the app's own sticky header (measured, so a header that wraps with large
 * text is never covered), sits under the header and the bottom dock in
 * stacking order, and wraps instead of growing wider than a small phone.
 * The notice is the provider's own text for this passage, with the version's
 * recorded attribution and copyright.
 */
export function ExerciseAttribution({ session }: { session: Session }) {
  const t = session.translation;
  const notice = session.licensed?.copyright ?? null;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const self = useRef<HTMLDivElement>(null);
  const top = useStickyTop(self);
  return (
    <div
      ref={self}
      data-exercise-attribution
      style={{ top }}
      className="sticky z-20 rounded-tile border border-border bg-(--header-bg) px-3 py-0.5 backdrop-blur-md"
    >
      {/* One line on a small phone, even with large text: the abbreviation and the notice (the full name from sm up). */}
      <p className="flex items-center gap-x-2 text-meta">
        <span className="font-semibold">{t.code}</span>
        <span className="hidden min-w-0 truncate text-text-secondary sm:inline">{t.name}</span>
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="ml-auto inline-flex min-h-11 shrink-0 items-center font-semibold whitespace-nowrap text-primary underline underline-offset-2 sm:ml-0"
          aria-haspopup="dialog"
        >
          Copyright notice<span className="sr-only"> for {t.code}</span>
        </button>
      </p>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-5 text-text shadow-(--elev-lift) backdrop:bg-black/45"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-[1.125rem] font-semibold">
            {t.name} ({t.code})
          </h2>
          <button type="button" onClick={() => dialog.current?.close()} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-muted" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 space-y-2 text-meta">
          {[notice, t.copyright, t.attribution].filter((x, i, all): x is string => !!x && !!x.trim() && all.indexOf(x) === i).map((line) => (
            <p key={line} className="whitespace-pre-line">
              {line}
            </p>
          ))}
          {t.source_url ? (
            <p>
              <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
                More about {t.code}
              </a>
            </p>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

/**
 * Where the strip sticks: just below the app's visible sticky header(s),
 * kept current as they resize (large text, rotation). Also tells focus
 * scrolling to stop below header and strip together (--exercise-scroll-top,
 * globals.css), so a focused control is never scrolled underneath them.
 */
function useStickyTop(strip: React.RefObject<HTMLDivElement | null>): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    const headers = [...document.querySelectorAll<HTMLElement>("[data-app-header]")];
    const measure = () => {
      const top = Math.max(0, ...headers.map((el) => (el.offsetParent === null ? 0 : el.getBoundingClientRect().height)));
      setH(top);
      root.style.setProperty("--exercise-scroll-top", `${Math.ceil(top + (strip.current?.getBoundingClientRect().height ?? 0) + 8)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    headers.forEach((el) => ro.observe(el));
    if (strip.current) ro.observe(strip.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--exercise-scroll-top");
    };
  }, [strip]);
  return h;
}
