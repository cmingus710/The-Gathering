"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized WebP copies with srcset (scripts/generate-menu-icons.mjs); next/image would resize them again. */
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** Rows shown while the menu is collapsed (globals.css hides the rest per column count). */
const COLLAPSED_ROWS = 3;
const EXPANDED_KEY = "launcher-expanded";

// The open/closed choice lives in this device's storage; a toggle notifies the one subscriber.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeExpanded(value: boolean) {
  try {
    localStorage.setItem(EXPANDED_KEY, value ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

/**
 * The home launcher: dimensional tiles in a responsive grid (two to six
 * columns by available width, measured in rem so enlarged text gets fewer,
 * wider columns). It never scrolls on its own: a swipe anywhere moves the
 * page. Beyond three rows the menu collapses behind a full-width "Show all"
 * button, and the choice is remembered on this device.
 *
 * - Hidden tiles are display:none, so they leave the tab order with the rest.
 * - Opening the menu moves focus to the first newly shown tile.
 */
export function Launcher({ tiles, labelledBy }: { tiles: LauncherTile[]; labelledBy: string }) {
  const list = useRef<HTMLUListElement>(null);
  const gridId = useId();
  const [hidden, setHidden] = useState(0);
  const expanded = useSyncExternalStore(subscribe, readExpanded, () => false);

  const measure = useCallback(() => {
    const ul = list.current;
    if (!ul) return;
    const columns = getComputedStyle(ul).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    setHidden(Math.max(0, ul.children.length - columns * COLLAPSED_ROWS));
  }, []);

  useIsoLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, [measure]);

  const toggle = () => {
    const next = !expanded;
    writeExpanded(next);
    if (next) {
      const firstHidden = list.current?.children[tiles.length - hidden] as HTMLElement | undefined;
      requestAnimationFrame(() => firstHidden?.querySelector("a")?.focus({ preventScroll: true }));
    }
  };

  return (
    <div className="launcher" data-expanded={expanded || undefined}>
      <ul ref={list} id={gridId} className="launcher-grid" aria-labelledby={labelledBy}>
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
      {hidden > 0 ? (
        <button type="button" className="launcher-toggle interactive" aria-expanded={expanded} aria-controls={gridId} onClick={toggle}>
          {expanded ? "Show fewer" : `Show all (${hidden} more)`}
          <ChevronDown aria-hidden="true" className="launcher-toggle-chevron size-5" />
        </button>
      ) : null}
    </div>
  );
}
