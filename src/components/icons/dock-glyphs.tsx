/**
 * The supplied dock glyphs (assets/brand/source/{home,events,community,
 * messages,more}.svg), inlined verbatim so they take the theme colour
 * through currentColor. Used only by the bottom dock; everything else
 * keeps the custom icon set in ./icon.tsx.
 */
import type { ReactNode } from "react";

export type DockGlyphName = "home" | "events" | "community" | "messages" | "more";

const PATHS: Record<DockGlyphName, ReactNode> = {
  home: (
    <>
      <path fill="currentColor" d="M3 10.5 12 3l9 7.5v9A1.5 1.5 0 0 1 19.5 21H15v-7H9v7H4.5A1.5 1.5 0 0 1 3 19.5z" />
      <path d="m1.5 11.5 10.5-9 10.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  events: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 2.5v5M16 2.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="12" y="13" width="5" height="5" rx="1.2" fill="currentColor" />
    </>
  ),
  community: (
    <>
      <path d="M3 4h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9l-5 4v-4a3 3 0 0 1-3-3V7a3 3 0 0 1 2-3Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M20 8h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2v3l-4-3h-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 9h7M6 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  messages: (
    <>
      <path d="M21 11c0 5-4 8-9 8H8l-5 3 1-6C2.5 14.5 2 13 2 11c0-5 4-8 10-8s9 3 9 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
      <circle cx="16.5" cy="11" r="1" fill="currentColor" />
    </>
  ),
  more: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
};

export function DockGlyph({ name, className = "size-6" }: { name: DockGlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
