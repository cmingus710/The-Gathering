/* eslint-disable @next/next/no-img-element -- short-lived signed URLs from the private youth bucket, never through the image optimizer */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { gameArtLabel, type GameArtKey } from "@/lib/youth/games/art";
import type { GameImage } from "@/lib/youth/games/config";

/**
 * The built-in illustrations for Learn & Play games: original drawings in
 * the house line style (round caps, currentColor lines, one gold accent),
 * on a 120 × 120 grid. Each is a plain picture of one thing so it reads at
 * card size. Keys match src/lib/youth/games/art.ts.
 */
const A = "var(--color-accent)";
const L = { fill: "none", stroke: "currentColor", strokeWidth: 3.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const T = { ...L, strokeWidth: 2.5 } as const;

const person = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <circle cx="0" cy="-22" r="8" {...L} />
    <path d="M-14 22c0-18 6-30 14-30s14 12 14 30z" {...L} />
  </g>
);

const loaf = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-16 6c-2-12 6-18 16-18s18 6 16 18z" fill={A} opacity="0.85" />
    <path d="M-16 6c-2-12 6-18 16-18s18 6 16 18z" {...L} />
    <path d="M-7-6l3 6M1-8l3 6M9-6l2 5" {...T} />
  </g>
);

const fishShape = (x: number, y: number, s = 1, flip = false) => (
  <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
    <path d="M-18 0c8-10 22-10 30 0-8 10-22 10-30 0z" {...L} />
    <path d="M12 0l10-8v16z" {...L} />
    <circle cx="-9" cy="-2" r="1.8" fill="currentColor" />
  </g>
);

const basket = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="-10" rx="14" ry="6" fill={A} opacity="0.85" />
    <path d="M-18-6h36l-5 22h-26z" {...L} />
    <path d="M-15 3h30M-8-6l-2 22M8-6l2 22" {...T} />
  </g>
);

const ART: Record<GameArtKey, ReactNode> = {
  ark: (
    <>
      <path d="M14 70h92l-12 22H26z" fill={A} opacity="0.85" />
      <path d="M14 70h92l-12 22H26z" {...L} />
      <path d="M38 70V50h44v20" {...L} />
      <path d="M32 52l28-16 28 16" {...L} />
      <rect x="54" y="56" width="12" height="10" rx="2" {...T} />
      <path d="M10 102c8-5 14-5 22 0s14 5 22 0 14-5 22 0 14 5 22 0 14-5 12 0" {...T} />
    </>
  ),
  animals: (
    <>
      <rect x="14" y="52" width="40" height="24" rx="12" {...L} />
      <circle cx="58" cy="46" r="9" {...L} />
      <path d="M52 38l-2-7M62 37l3-6" {...T} />
      <path d="M22 76v16M46 76v16M14 62c-4 2-6 6-4 10" {...L} />
      <rect x="68" y="58" width="34" height="20" rx="10" fill={A} opacity="0.85" />
      <rect x="68" y="58" width="34" height="20" rx="10" {...L} />
      <circle cx="104" cy="52" r="7.5" {...L} />
      <path d="M99 45l-2-6M108 45l3-5" {...T} />
      <path d="M75 78v14M95 78v14" {...L} />
      <path d="M8 98h104" {...T} />
    </>
  ),
  rain: (
    <>
      <path d="M30 56a16 16 0 0 1 4-31 20 20 0 0 1 38-2 15 15 0 0 1 18 33z" fill={A} opacity="0.35" />
      <path d="M30 56a16 16 0 0 1 4-31 20 20 0 0 1 38-2 15 15 0 0 1 18 33z" {...L} />
      <path d="M36 66l-4 10M54 66l-4 10M72 66l-4 10M45 82l-4 10M63 82l-4 10" {...L} />
      <path d="M10 104c8-5 14-5 22 0s14 5 22 0 14-5 22 0 14 5 22 0 14-5 12 0" {...T} />
    </>
  ),
  dove: (
    <>
      <path d="M24 64c10-4 22-4 32 2l26-18c4 8 2 18-6 24 8 4 14 4 22 0-6 12-20 18-36 16-14-2-28-10-38-24z" {...L} />
      <path d="M52 66c6-12 18-22 34-26-2 12-10 22-22 28" {...L} />
      <circle cx="34" cy="62" r="2" fill="currentColor" />
      <path d="M22 66l-12 4 12 2" {...L} />
      <path d="M8 76c6 2 10 6 12 12" {...T} />
      <ellipse cx="12" cy="82" rx="5" ry="3" fill={A} transform="rotate(40 12 82)" />
    </>
  ),
  rainbow: (
    <>
      <path d="M16 88a44 44 0 0 1 88 0" {...L} />
      <path d="M26 88a34 34 0 0 1 68 0" {...L} stroke={A} strokeWidth={6} />
      <path d="M36 88a24 24 0 0 1 48 0" {...L} />
      <path d="M10 88c6-6 14-6 18 0M92 88c4-6 12-6 18 0" {...T} />
      <path d="M8 100h104" {...T} />
    </>
  ),
  crowd: (
    <>
      <path d="M6 100c22-30 46-40 54-40s32 10 54 40" {...T} />
      {person(30, 86, 0.7)}
      {person(52, 78, 0.7)}
      {person(74, 80, 0.7)}
      {person(94, 90, 0.7)}
      <circle cx="96" cy="26" r="10" fill={A} />
    </>
  ),
  loaves_fish: (
    <>
      <path d="M18 70h84l-8 28H26z" {...L} />
      <path d="M22 82h76" {...T} />
      {loaf(36, 62, 0.7)}
      {loaf(60, 58, 0.7)}
      {loaf(84, 62, 0.7)}
      {loaf(48, 46, 0.6)}
      {loaf(72, 46, 0.6)}
      {fishShape(40, 28, 0.7)}
      {fishShape(80, 28, 0.7, true)}
    </>
  ),
  thanks: (
    <>
      <path d="M60 18v10M36 26l6 8M84 26l-6 8M24 46h10M86 46h10" {...L} stroke={A} />
      {loaf(60, 56, 1.3)}
      <path d="M38 64c-2 10 2 18 10 22M82 64c2 10-2 18-10 22" {...L} />
      <path d="M48 86v16M72 86v16" {...L} />
    </>
  ),
  baskets: (
    <>
      {basket(32, 74, 0.9)}
      {basket(60, 66, 1)}
      {basket(88, 74, 0.9)}
      <path d="M10 98h100" {...T} />
    </>
  ),
  fish: (
    <>
      <path d="M22 60c15-19 42-19 57 0-15 19-42 19-57 0z" fill={A} opacity="0.85" />
      {fishShape(56, 60, 1.9)}
      <path d="M22 96c8-4 14-4 22 0s14 4 22 0 14-4 22 0" {...T} />
    </>
  ),
  bread: (
    <>
      {loaf(60, 68, 2.2)}
      <path d="M18 90h84" {...T} />
    </>
  ),
  star: (
    <>
      <path d="M60 14l10 28 30 1-24 18 9 29-25-17-25 17 9-29-24-18 30-1z" fill={A} opacity="0.9" />
      <path d="M60 14l10 28 30 1-24 18 9 29-25-17-25 17 9-29-24-18 30-1z" {...L} />
      <path d="M60 96v14M22 88l-6 6M98 88l6 6" {...T} />
    </>
  ),
  sling: (
    <>
      <path d="M20 22c10 30 22 44 34 48M100 22C90 52 78 66 66 70" {...L} />
      <path d="M54 70c2 8 10 8 12 0" {...L} />
      <ellipse cx="60" cy="72" rx="9" ry="5" fill={A} />
      <circle cx="34" cy="98" r="7" {...L} />
      <circle cx="56" cy="102" r="6" {...L} />
      <circle cx="78" cy="98" r="7" {...L} />
    </>
  ),
  tablets: (
    <>
      <path d="M18 100V40a14 14 0 0 1 28 0v60z" {...L} />
      <path d="M52 100V40a14 14 0 0 1 28 0v60z" fill={A} opacity="0.35" />
      <path d="M52 100V40a14 14 0 0 1 28 0v60z" {...L} />
      <path d="M26 50h12M26 62h12M26 74h12M26 86h12M60 50h12M60 62h12M60 74h12M60 86h12" {...T} />
    </>
  ),
  big_fish: (
    <>
      <path d="M12 60c18-28 60-32 84-8l12-14v44l-12-14C72 92 30 88 12 60z" fill={A} opacity="0.3" />
      <path d="M12 60c18-28 60-32 84-8l12-14v44l-12-14C72 92 30 88 12 60z" {...L} />
      <circle cx="32" cy="52" r="3" fill="currentColor" />
      <path d="M18 66c8 4 16 4 22 0" {...T} />
      <path d="M48 46c4 8 4 20 0 28M62 46c4 8 4 20 0 28" {...T} />
      <path d="M8 104c8-5 14-5 22 0s14 5 22 0 14-5 22 0 14 5 22 0 14-5 12 0" {...T} />
    </>
  ),
  person: (
    <>
      <circle cx="60" cy="36" r="14" {...L} />
      <path d="M30 102c0-30 12-48 30-48s30 18 30 48z" {...L} />
      <path d="M48 70l12 10 12-10" {...T} stroke={A} strokeWidth={4} />
    </>
  ),
  lamb: (
    <>
      <path d="M30 68c-8-2-10-14-2-18 0-10 12-14 18-8 6-8 20-6 22 4 10-2 18 8 12 16 6 8-2 18-12 14-4 8-18 8-22 0-6 4-16 2-16-8z" {...L} />
      <path d="M78 52c6-6 16-4 18 4s-4 14-12 12" {...L} />
      <circle cx="88" cy="56" r="2" fill="currentColor" />
      <path d="M40 76v20M52 78v18M66 78v18M76 72v24" {...L} />
      <path d="M92 50l6-6" {...T} stroke={A} strokeWidth={4} />
    </>
  ),
  crown: (
    <>
      <path d="M20 84l-4-46 24 20 20-30 20 30 24-20-4 46z" fill={A} opacity="0.85" />
      <path d="M20 84l-4-46 24 20 20-30 20 30 24-20-4 46z" {...L} />
      <path d="M20 96h80" {...L} />
      <circle cx="60" cy="70" r="5" {...T} />
    </>
  ),
  lamp: (
    <>
      <path d="M16 74c10 14 50 16 70 4l16-10c-12-2-22 0-30 4-10-10-46-12-56 2z" {...L} />
      <path d="M44 66c0-6 8-6 8 0" {...T} />
      <path d="M100 66c-6-10-2-22 6-30 2 12 6 20-6 30z" fill={A} />
      <path d="M30 96h48" {...T} />
    </>
  ),
  sheep: (
    <>
      <path d="M24 64c-6-6-2-16 6-16 2-10 16-12 22-4 8-6 22-2 22 8 10 0 14 12 8 18 4 8-4 16-12 12-6 6-18 6-22 0-8 4-20 0-20-8-6 0-8-6-4-10z" fill={A} opacity="0.3" />
      <path d="M24 64c-6-6-2-16 6-16 2-10 16-12 22-4 8-6 22-2 22 8 10 0 14 12 8 18 4 8-4 16-12 12-6 6-18 6-22 0-8 4-20 0-20-8-6 0-8-6-4-10z" {...L} />
      <path d="M86 58c8-2 14 4 12 12s-10 8-14 4" {...L} />
      <path d="M36 80v18M50 82v16M64 82v16M76 78v20" {...L} />
    </>
  ),
};

/** A built-in illustration (decorative: the card or caption carries the meaning). */
export function GameArt({ art, className }: { art: GameArtKey; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={cn("h-full w-full", className)} aria-hidden="true" focusable="false" data-art={art}>
      {ART[art]}
    </svg>
  );
}

export type MediaMap = Record<string, { url: string | null; alt: string }>;

/**
 * One picture in a game: an uploaded image (signed URL) or a built-in
 * illustration, on the same wash as the activity type. `alt` is the
 * description for people who can't see it; "" when the visible text already
 * says it.
 */
export function GamePicture({ image, media, alt, kind, className }: { image: GameImage | null; media: MediaMap; alt: string; kind: string; className?: string }) {
  const uploaded = image && "asset" in image ? media[image.asset] : null;
  return (
    <div data-kind={kind} className={cn("play-art relative aspect-square overflow-hidden", className)}>
      {uploaded?.url ? (
        <img src={uploaded.url} alt={alt} className="absolute inset-0 h-full w-full object-cover" decoding="async" draggable={false} />
      ) : image && "art" in image ? (
        <div className="absolute inset-0 p-[10%]" role={alt ? "img" : undefined} aria-label={alt || undefined}>
          <GameArt art={image.art} />
        </div>
      ) : (
        <div className="absolute inset-0" role={alt ? "img" : undefined} aria-label={alt || undefined} />
      )}
    </div>
  );
}

export const builtInAlt = (image: GameImage | null) => (image && "art" in image ? gameArtLabel(image.art) : "");
