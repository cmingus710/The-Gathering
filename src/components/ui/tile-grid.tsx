/* eslint-disable @next/next/no-img-element -- pre-sized WebP copies with srcset (scripts/generate-menu-icons.mjs); next/image would resize them again. */
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { menuArtSource, type MenuArtName } from "@/lib/home/launcher";
import type { IconName } from "@/lib/icons";

export type GridTile = { href: string; label: string; art?: MenuArtName; glyph: IconName };

/**
 * A hub's sections as dimensional tiles, laid out like the home launcher
 * (same art, labels, columns, hover, and focus) but never scrolling on its
 * own: hubs have few entries. Entries without supplied artwork use their
 * glyph on a neutral tile, as the launcher does for missing art.
 */
export function TileGrid({ tiles, label }: { tiles: GridTile[]; label: string }) {
  return (
    <nav aria-label={label} className="launcher">
      <ul className="launcher-grid">
        {tiles.map((t) => {
          const source = t.art ? menuArtSource(t.art) : null;
          return (
            <li key={t.href} className="min-w-0">
              <Link href={t.href} className="launcher-tile group">
                <span className="launcher-art">
                  {source ? (
                    <img
                      src={source.src}
                      srcSet={source.srcSet}
                      sizes="(min-width: 1024px) 7rem, (min-width: 640px) 6.5rem, 26vw"
                      width={336}
                      height={336}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  ) : (
                    <span className="launcher-fallback">
                      <TileIcon name={t.glyph} className="size-[62%]" />
                    </span>
                  )}
                </span>
                <span className="launcher-label">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
