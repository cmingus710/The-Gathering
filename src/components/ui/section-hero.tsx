/* eslint-disable @next/next/no-img-element -- pre-sized WebP copies with srcset (scripts/generate-menu-icons.mjs); next/image would resize them again. */
import type { ReactNode } from "react";
import { TileIcon } from "@/components/icons/icon";
import { menuArtSource, type MenuArtName } from "@/lib/home/launcher";
import type { IconName } from "@/lib/icons";

/**
 * Header for a section's main page: the section's dimensional tile (the same
 * artwork as its home tile) on the greeting banner's surface, with the title,
 * a short gold rule, an optional description, and actions. Takes the same
 * props as PageHeader plus the artwork, so a section page swaps one for the
 * other. Detail and form pages keep the plain PageHeader.
 *
 * When the artwork is missing (or a section has none) the tile falls back to
 * the section's glyph on a neutral tile, as on the home launcher.
 */
export function SectionHero({
  art,
  glyph,
  title,
  description,
  actions,
  eyebrow,
}: {
  art?: MenuArtName;
  glyph: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const source = art ? menuArtSource(art) : null;
  return (
    <header className="home-hero section-hero relative isolate mb-6 overflow-hidden rounded-[1.25rem] px-4 py-4 sm:mb-8 sm:px-7 sm:py-6">
      <div className="flex items-center gap-4 sm:gap-6">
        <span className="section-hero-art" aria-hidden="true">
          {source ? (
            <img src={source.src} srcSet={source.srcSet} sizes="(min-width: 640px) 6.5rem, 4.75rem" width={336} height={336} alt="" decoding="async" draggable={false} />
          ) : (
            <span className="launcher-fallback">
              <TileIcon name={glyph} className="size-[62%]" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-text-secondary">{eyebrow}</p> : null}
          <h1 className="font-display text-[1.75rem] font-semibold leading-[1.12] text-text [overflow-wrap:anywhere] sm:text-[2.375rem]">{title}</h1>
          <span aria-hidden="true" className="mt-2.5 block h-[3px] w-10 rounded-full bg-accent" />
          {description ? <p className="mt-2.5 hidden max-w-[60ch] text-text-secondary sm:block">{description}</p> : null}
        </div>
      </div>
      {description ? <p className="mt-3 max-w-[60ch] text-text-secondary sm:hidden">{description}</p> : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
