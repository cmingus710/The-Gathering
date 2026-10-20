"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized WebP copies with srcset (scripts/generate-menu-icons.mjs); next/image would resize them again. */
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TileIcon } from "@/components/icons/icon";
import type { ArtSource } from "@/lib/home/launcher";
import type { IconName } from "@/lib/icons";
import { TileCount } from "./tile-count";

export type LauncherTile = {
  id: string;
  label: string;
  href: string;
  glyph: IconName;
  art: ArtSource | null;
  count?: "messages" | "notifications";
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Rows shown before the menu scrolls: three on phones, two on short screens
 * and on desktop, and never more than about 60% of the screen (fewer with
 * enlarged text), so "Coming up" stays close.
 */
function rowsToShow(row: number, gap: number): number {
  const desktop = window.matchMedia("(min-width: 1024px)").matches;
  const target = desktop || window.innerHeight < 700 ? 2 : 3;
  const fit = Math.floor((window.innerHeight * 0.62 - row * 0.4) / (row + gap));
  return Math.max(1, Math.min(target, fit));
}

/**
 * The home launcher: dimensional tiles in a responsive grid (two to six
 * columns by available width, measured in rem so enlarged text gets fewer,
 * wider columns). When there are more rows than fit, the grid scrolls inside
 * a bounded area that shows a sliver of the next row, with soft edge fades.
 *
 * - Scrolling chains to the page at either end (no overscroll containment),
 *   and only vertically.
 * - Every tile is a link in the tab order; a focused tile is scrolled clear
 *   of the fades (scroll-padding), so labels and the focus ring stay visible.
 * - Reduced motion: instant scrolling and no lift on hover.
 */
export function Launcher({ tiles, labelledBy }: { tiles: LauncherTile[]; labelledBy: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [bounded, setBounded] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const updateEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollTop <= 1;
    const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  const measure = useCallback(() => {
    const ul = list.current;
    const first = ul?.firstElementChild as HTMLElement | null;
    if (!ul || !first) return;
    const style = getComputedStyle(ul);
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const rows = Math.ceil(ul.children.length / columns);
    const gap = parseFloat(style.rowGap) || 0;
    const row = first.getBoundingClientRect().height;
    const show = rowsToShow(row, gap);
    // Whole rows plus 40% of the next one, so it's clear there is more.
    setBounded(rows <= show ? null : Math.round(show * (row + gap) + row * 0.4));
    requestAnimationFrame(updateEdges);
  }, [updateEdges]);

  useIsoLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (list.current) ro.observe(list.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const reveal = (e: React.FocusEvent<HTMLUListElement>) => {
    if (!bounded) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (e.target as HTMLElement).closest("li")?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="launcher" data-bounded={bounded ? "true" : undefined} data-at-start={edges.start || undefined} data-at-end={edges.end || undefined}>
      <div
        ref={scroller}
        className="launcher-scroll"
        style={bounded ? { maxHeight: bounded } : undefined}
        onScroll={updateEdges}
      >
        <ul ref={list} className="launcher-grid" aria-labelledby={labelledBy} onFocus={reveal}>
          {tiles.map((t, i) => (
            <li key={t.id} className="min-w-0">
              <Link href={t.href} className="launcher-tile group">
                <span className="launcher-art">
                  {t.art ? (
                    <img
                      src={t.art.src}
                      srcSet={t.art.srcSet}
                      sizes="(min-width: 1024px) 7rem, (min-width: 640px) 6.5rem, 26vw"
                      width={336}
                      height={336}
                      alt=""
                      loading={i < 9 ? "eager" : "lazy"}
                      decoding="async"
                      draggable={false}
                    />
                  ) : (
                    <span className="launcher-fallback">
                      <TileIcon name={t.glyph} className="size-[62%]" />
                    </span>
                  )}
                  {t.count ? <TileCount kind={t.count} className="-right-1 -top-1" /> : null}
                </span>
                <span className="launcher-label">{t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <span aria-hidden="true" className="launcher-more" />
    </div>
  );
}
