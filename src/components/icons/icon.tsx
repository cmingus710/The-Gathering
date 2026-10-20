import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { IconName } from "@/lib/icons";

/**
 * The Gathering's custom icons, drawn on a 24-unit grid with a 1.75 stroke,
 * round caps and joins, and 2–2.75 unit corner radii.
 *
 * Each glyph has three layers:
 * - base:   structure, stroked in currentColor (charcoal on light, ivory on dark)
 * - accent: a restrained gold highlight (.g-accent)
 * - fill:   a soft gold wash shown only when selected, and in tile variants (.g-fill)
 *
 * Icons are decorative (aria-hidden) unless a title is given; the label next
 * to them, or the button's accessible name, carries the meaning.
 */
type Glyph = { base: ReactNode; accent: ReactNode; fill?: ReactNode };

const shield = "M12 3.5 5.25 6v5.25c0 4.3 2.85 7.6 6.75 9.25 3.9-1.65 6.75-4.95 6.75-9.25V6Z";
const bubble = "M12 4c4.7 0 8.25 3.1 8.25 7s-3.55 7-8.25 7c-.9 0-1.8-.1-2.6-.35L5.5 19.5l1-3.4C4.9 14.8 3.75 13 3.75 11c0-3.9 3.55-7 8.25-7Z";
const frontBubble = "M6.25 4h7a2.25 2.25 0 0 1 2.25 2.25v5a2.25 2.25 0 0 1-2.25 2.25H9.25L6 16v-2.5a2.25 2.25 0 0 1-2-2.25v-5A2.25 2.25 0 0 1 6.25 4Z";
const bookPages = "M12 6.75C10.1 5.4 7.3 4.9 4 5.25v12.5c3.3-.35 6.1.15 8 1.5 1.9-1.35 4.7-1.85 8-1.5V5.25c-3.3-.35-6.1.15-8 1.5Z";
const megaphone = "M5.75 9.75H7.5l7.25-4v13.5l-7.25-4H5.75a1.5 1.5 0 0 1-1.5-1.5v-2.5a1.5 1.5 0 0 1 1.5-1.5Z";
const bell = "M6.25 16.75V11a5.75 5.75 0 0 1 11.5 0v5.75l1.5 1.75H4.75Z";
const leftHand = "M11.25 20.25V11a1.6 1.6 0 0 0-2.9-.95L5.4 14.3a3 3 0 0 0-.4 2.5l.95 3.45";
const rightHand = "M12.75 20.25V11a1.6 1.6 0 0 1 2.9-.95l2.95 4.25a3 3 0 0 1 .4 2.5l-.95 3.45";
const spark = "M19 2.5c.35 1.55 1.2 2.4 2.75 2.75-1.55.35-2.4 1.2-2.75 2.75-.35-1.55-1.2-2.4-2.75-2.75 1.55-.35 2.4-1.2 2.75-2.75Z";
const heart = "M12 11.25 8.9 8.3a2.1 2.1 0 0 1 0-3 2.1 2.1 0 0 1 3.1.15 2.1 2.1 0 0 1 3.1-.15 2.1 2.1 0 0 1 0 3Z";

const solid = { fill: "currentColor", stroke: "currentColor", strokeWidth: 1 } as const;

const GLYPHS: Record<IconName, Glyph> = {
  home: {
    fill: <path d="M6 10.25V18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7.75L12 5.4Z" />,
    base: (
      <>
        <path d="M3.75 11.25 12 4.5l8.25 6.75" />
        <path d="M6 10v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
      </>
    ),
    accent: <path d="M10 20v-3.25a2 2 0 0 1 4 0V20" />,
  },
  directory: {
    fill: <circle cx="12" cy="12.5" r="5.25" />,
    base: (
      <>
        <circle cx="12" cy="5.25" r="2" />
        <circle cx="5.5" cy="16.25" r="2" />
        <circle cx="18.5" cy="16.25" r="2" />
        <path d="M9.6 6.6c-2 1.2-3.3 3.6-3.5 7.1" />
        <path d="M14.4 6.6c2 1.2 3.3 3.6 3.5 7.1" />
        <path d="M8 18.4c2.5 1.5 5.5 1.5 8 0" />
      </>
    ),
    accent: <circle cx="12" cy="12.5" r="1.75" {...solid} />,
  },
  community: {
    fill: <path d={frontBubble} />,
    base: (
      <>
        <path d={frontBubble} />
        <path d="M7.5 8.75h4.5" />
      </>
    ),
    accent: <path d="M17.5 9.25h.25A2.25 2.25 0 0 1 20 11.5v4.25A2.25 2.25 0 0 1 17.75 18v2l-2.75-2h-3.25a2.25 2.25 0 0 1-2.25-2.25v-.5" />,
  },
  groups: {
    fill: <path d="M7.5 19v-.75a4.5 4.5 0 0 1 9 0V19Z" />,
    base: (
      <>
        <path d="M7.5 19v-.75a4.5 4.5 0 0 1 9 0V19" />
        <circle cx="5.5" cy="9.25" r="1.75" />
        <circle cx="18.5" cy="9.25" r="1.75" />
        <path d="M2.75 18v-.5a3.25 3.25 0 0 1 4.1-3.1" />
        <path d="M21.25 18v-.5a3.25 3.25 0 0 0-4.1-3.1" />
      </>
    ),
    accent: <circle cx="12" cy="7.25" r="2.4" {...solid} />,
  },
  messages: {
    fill: <path d={bubble} />,
    base: <path d={bubble} />,
    accent: (
      <>
        <path d="M8.75 9.75h6.5" />
        <path d="M8.75 12.75h4" />
      </>
    ),
  },
  prayer: {
    fill: (
      <>
        <path d={`${leftHand}Z`} />
        <path d={`${rightHand}Z`} />
      </>
    ),
    base: (
      <>
        <path d={leftHand} />
        <path d={rightHand} />
      </>
    ),
    accent: (
      <>
        <path d="M12 3v2.25" />
        <path d="m7.75 5 1 1.5" />
        <path d="m16.25 5-1 1.5" />
      </>
    ),
  },
  events: {
    fill: <path d="M4 9.75V8a2.75 2.75 0 0 1 2.75-2.75h10.5A2.75 2.75 0 0 1 20 8v1.75Z" />,
    base: (
      <>
        <rect x="4" y="5.25" width="16" height="15" rx="2.75" />
        <path d="M4 9.75h16" />
        <path d="M8.25 3.5V7" />
        <path d="M15.75 3.5V7" />
      </>
    ),
    accent: <rect x="12.5" y="13" width="4" height="4" rx="1.1" {...solid} />,
  },
  bible: {
    fill: <path d={bookPages} />,
    base: (
      <>
        <path d={bookPages} />
        <path d="M12 6.75v12.5" />
      </>
    ),
    accent: <path d="M15 5.6v6.15l1.25-1.1 1.25 1.1V5.35" />,
  },
  memory: {
    fill: <rect x="3.75" y="6.25" width="12.5" height="13.5" rx="2.25" />,
    base: (
      <>
        <rect x="3.75" y="6.25" width="12.5" height="13.5" rx="2.25" />
        <path d="M7 11h6" />
        <path d="M7 14.25h4" />
      </>
    ),
    accent: <path d={spark} {...solid} />,
  },
  devotionals: {
    fill: <path d="M8 14.5a4 4 0 0 1 8 0Z" />,
    base: <path d="M3.5 16.75c2.9-1.15 5.75-1 8.5.6 2.75-1.6 5.6-1.75 8.5-.6v2.6c-2.9-1.15-5.75-1-8.5.6-2.75-1.6-5.6-1.75-8.5-.6Z" />,
    accent: (
      <>
        <path d="M8 14.5a4 4 0 0 1 8 0" />
        <path d="M12 6v1.75" />
        <path d="m6.6 8.4 1.2 1.2" />
        <path d="m17.4 8.4-1.2 1.2" />
      </>
    ),
  },
  podcasts: {
    fill: <rect x="9.25" y="3.5" width="5.5" height="10" rx="2.75" />,
    base: (
      <>
        <rect x="9.25" y="3.5" width="5.5" height="10" rx="2.75" />
        <path d="M6.5 11a5.5 5.5 0 0 0 11 0" />
        <path d="M12 16.5v3.75" />
        <path d="M9.25 20.25h5.5" />
      </>
    ),
    accent: (
      <>
        <path d="M3.75 7.75c-.9 2.1-.9 4.4 0 6.5" />
        <path d="M20.25 7.75c.9 2.1.9 4.4 0 6.5" />
      </>
    ),
  },
  lessons: {
    fill: <path d="M4.25 11.75h15.5l-1.9 2.75H6.15Z" />,
    base: (
      <>
        <path d="M4.25 11.75h15.5l-1.9 2.75H6.15Z" />
        <path d="M12 14.5v5" />
        <path d="M8.75 20h6.5" />
      </>
    ),
    accent: (
      <>
        <path d="M5.75 9.25c2-1.6 4.25-1.75 6.25-.4 2-1.35 4.25-1.2 6.25.4" />
        <path d="M12 8.85v2.4" />
      </>
    ),
  },
  journal: {
    fill: <path d="M7 3.75h10a1.75 1.75 0 0 1 1.75 1.75v13a1.75 1.75 0 0 1-1.75 1.75H7Z" />,
    base: (
      <>
        <path d="M6.75 3.75h10.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H6.75a1 1 0 0 1-1-1v-14.5a1 1 0 0 1 1-1Z" />
        <path d="M9.25 3.75v16.5" />
        <path d="M4.25 7.75h2.5M4.25 12h2.5M4.25 16.25h2.5" />
      </>
    ),
    accent: <path d="m12.25 15.5.6-2.1 3.9-3.9a1.06 1.06 0 0 1 1.5 1.5l-3.9 3.9Z" />,
  },
  reading: {
    fill: <path d="M6.5 3.75h11.25v11.75H6.5a2.25 2.25 0 0 0-2.25 2.25V6A2.25 2.25 0 0 1 6.5 3.75Z" />,
    base: (
      <>
        <path d="M6.5 3.75h11.25a.75.75 0 0 1 .75.75v15a.75.75 0 0 1-.75.75H6.5a2.25 2.25 0 0 1-2.25-2.25V6A2.25 2.25 0 0 1 6.5 3.75Z" />
        <path d="M4.25 17.75a2.25 2.25 0 0 1 2.25-2.25h12" />
      </>
    ),
    accent: <path d="M12.5 3.75v6.75l1.75-1.25 1.75 1.25V3.75" />,
  },
  music: {
    fill: (
      <>
        <circle cx="6.75" cy="17.5" r="2.25" />
        <circle cx="16.75" cy="15.5" r="2.25" />
      </>
    ),
    base: (
      <>
        <circle cx="6.75" cy="17.5" r="2.25" />
        <circle cx="16.75" cy="15.5" r="2.25" />
        <path d="M9 17.5V6.25l10-2V15.5" />
      </>
    ),
    accent: <path d="M9 9.75l10-2" />,
  },
  gallery: {
    fill: <rect x="7.25" y="4.5" width="13" height="11.5" rx="2" />,
    base: (
      <>
        <rect x="7.25" y="4.5" width="13" height="11.5" rx="2" />
        <path d="M4.25 8.25v9.5a2 2 0 0 0 2 2h10.5" />
        <path d="m7.75 14 3.25-3.25 2.5 2.5 1.75-1.75 4.5 4.25" />
      </>
    ),
    accent: <circle cx="16.25" cy="8.25" r="1.25" {...solid} />,
  },
  media: {
    fill: <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.75" />,
    base: <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.75" />,
    accent: <path d="M10.25 9.25v5.5l4.5-2.75Z" {...solid} />,
  },
  youth: {
    fill: (
      <>
        <circle cx="7.5" cy="5.5" r="2" />
        <circle cx="16.5" cy="5.5" r="2" />
      </>
    ),
    base: (
      <>
        <circle cx="7.5" cy="5.5" r="2" />
        <circle cx="16.5" cy="5.5" r="2" />
        <path d="M7.5 9.5v4.25L5 19.75" />
        <path d="m7.5 13.75 2.75 5.25" />
        <path d="M16.5 9.5v4.25l2.5 6" />
        <path d="m16.5 13.75-2.75 5.25" />
        <path d="M7.5 10.5 3.75 7.75" />
        <path d="m16.5 10.5 3.75-2.75" />
        <path d="M7.5 10.5 12 9.25l4.5 1.25" />
      </>
    ),
    accent: <circle cx="12" cy="9.25" r="1.5" {...solid} />,
  },
  giving: {
    fill: <circle cx="12" cy="7.75" r="5" />,
    base: (
      <>
        <path d="M2.75 13.5v6.75" />
        <path d="M2.75 14.5h2.5c.9 0 1.75-.25 2.5-.75l.9-.6a3 3 0 0 1 1.65-.5h2.95a1.5 1.5 0 0 1 0 3h-2.5" />
        <path d="M5.25 19.25h7.6a3 3 0 0 0 1.9-.68l4.5-3.7a1.5 1.5 0 0 0-1.95-2.28l-3.05 2.36" />
      </>
    ),
    accent: <path d={heart} {...solid} />,
  },
  profile: {
    fill: <circle cx="12" cy="8.5" r="3.5" />,
    base: <path d="M5 20c.9-3.4 3.7-5.5 7-5.5s6.1 2.1 7 5.5" />,
    accent: <circle cx="12" cy="8.5" r="3.5" />,
  },
  announcements: {
    fill: <path d={megaphone} />,
    base: (
      <>
        <path d={megaphone} />
        <path d="m7.75 15.5.9 3.75h2.1l-.85-3.4" />
      </>
    ),
    accent: (
      <>
        <path d="M17.75 9.25a4 4 0 0 1 0 5.5" />
        <path d="M19.75 7.25a7 7 0 0 1 0 9.5" />
      </>
    ),
  },
  admin: {
    fill: <path d={shield} />,
    base: <path d={shield} />,
    accent: <path d="m9.25 12.25 1.9 1.9 3.6-3.9" />,
  },
  notifications: {
    fill: <path d={bell} />,
    base: (
      <>
        <path d={bell} />
        <path d="M12 3.5v1.75" />
      </>
    ),
    accent: <path d="M10 21a2.1 2.1 0 0 0 4 0" />,
  },
  more: {
    fill: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.75" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.75" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.75" />
      </>
    ),
    base: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.75" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.75" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.75" />
      </>
    ),
    accent: <circle cx="16.75" cy="16.75" r="3.25" />,
  },
  settings: {
    fill: (
      <>
        <circle cx="15" cy="7.5" r="2.5" />
        <circle cx="9" cy="16.5" r="2.5" />
      </>
    ),
    base: (
      <>
        <path d="M4 7.5h8.5" />
        <path d="M17.5 7.5H20" />
        <path d="M4 16.5h2.5" />
        <path d="M11.5 16.5H20" />
        <circle cx="15" cy="7.5" r="2.5" />
      </>
    ),
    accent: <circle cx="9" cy="16.5" r="2.5" />,
  },
  audit: {
    fill: <rect x="5.5" y="4.75" width="13" height="15.75" rx="2.25" />,
    base: (
      <>
        <path d="M9.25 4.75H7.75A2.25 2.25 0 0 0 5.5 7v11.25a2.25 2.25 0 0 0 2.25 2.25h8.5a2.25 2.25 0 0 0 2.25-2.25V7a2.25 2.25 0 0 0-2.25-2.25h-1.5" />
        <path d="M9 11h6" />
        <path d="M9 14.5h3.5" />
      </>
    ),
    accent: <rect x="9.25" y="3.25" width="5.5" height="3" rx="1" />,
  },
  moderation: {
    fill: <path d={shield} />,
    base: <path d={shield} />,
    accent: (
      <>
        <path d="M12 8.75v4" />
        <path d="M12 15.9v.1" />
      </>
    ),
  },
  sprout: {
    fill: <path d="M12 13c-3.75 0-6.25-2.25-6.25-6.25 3.75 0 6.25 2.25 6.25 6.25Z" />,
    base: (
      <>
        <path d="M12 20.25v-7.5" />
        <path d="M12 13c-3.75 0-6.25-2.25-6.25-6.25 3.75 0 6.25 2.25 6.25 6.25Z" />
        <path d="M8 20.25h8" />
      </>
    ),
    accent: <path d="M12 15.25c0-3.5 2.25-5.5 5.75-5.5 0 3.5-2.25 5.5-5.75 5.5Z" />,
  },
};

function Layers({ glyph }: { glyph: Glyph }) {
  return (
    <>
      {glyph.fill ? (
        <g className="g-fill" stroke="none">
          {glyph.fill}
        </g>
      ) : null}
      <g>{glyph.base}</g>
      <g className="g-accent">{glyph.accent}</g>
    </>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Navigation-size icon (renders crisply at 20–24 px). */
export function Icon({
  name,
  active = false,
  className = "size-6",
  title,
}: {
  name: IconName;
  active?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("g-icon shrink-0", className)}
      data-active={active ? "true" : undefined}
      strokeWidth={active ? 2 : 1.75}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...stroke}
    >
      {title ? <title>{title}</title> : null}
      <Layers glyph={GLYPHS[name]} />
    </svg>
  );
}

/**
 * Illustrated tile variant for home-screen feature tiles: the glyph sits on a
 * soft medallion with a fragment of the "gathering arc" motif.
 */
export function TileIcon({ name, className = "size-12" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("g-icon-tile shrink-0", className)} aria-hidden="true" focusable="false" {...stroke}>
      <circle cx="24" cy="24" r="22" fill="var(--color-primary-soft)" stroke="none" />
      <path d="M7.5 31.5A18 18 0 0 0 20 41.6" stroke="var(--color-accent)" strokeWidth="1.5" opacity="0.7" />
      <circle cx="40.5" cy="13" r="1.6" fill="var(--color-accent)" stroke="none" opacity="0.8" />
      <g transform="translate(10 10) scale(1.1667)" strokeWidth="1.6">
        <Layers glyph={GLYPHS[name]} />
      </g>
    </svg>
  );
}

/** Small spot illustration for empty states (glyph inside a quiet ring). */
export function SpotIcon({ name, className = "size-14" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 56 56" className={cn("g-icon-tile shrink-0 text-text-secondary", className)} aria-hidden="true" focusable="false" {...stroke}>
      <circle cx="28" cy="28" r="26" fill="var(--color-surface-muted)" stroke="none" />
      <circle cx="28" cy="28" r="20.5" stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 3" />
      <g transform="translate(14 14) scale(1.1667)" strokeWidth="1.5">
        <Layers glyph={GLYPHS[name]} />
      </g>
    </svg>
  );
}
