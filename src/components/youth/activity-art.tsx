/* eslint-disable @next/next/no-img-element -- short-lived signed URLs from the private youth bucket, never through the image optimizer */
import { cn } from "@/components/ui/cn";
import type { ActivityKind } from "@/lib/youth/activities";

/**
 * Learn & Play artwork: the uploaded cover when there is one, otherwise an
 * original illustration for the activity type (drawn here, in the house
 * line style: round caps, one gold accent). Decorative illustrations are
 * hidden from screen readers; an uploaded cover carries its own description
 * unless the editor marked it decorative.
 */
const ACCENT = "var(--color-accent)";

function Scene({ kind }: { kind: ActivityKind }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (kind) {
    case "story":
      return (
        <>
          <circle cx="100" cy="58" r="16" fill={ACCENT} opacity="0.9" />
          {[0, 1, 2, 3, 4].map((i) => {
            const a = Math.PI * (1.1 + i * 0.2);
            return <line key={i} x1={100 + Math.cos(a) * 24} y1={58 + Math.sin(a) * 24} x2={100 + Math.cos(a) * 34} y2={58 + Math.sin(a) * 34} {...line} />;
          })}
          <path d="M40 92c20-8 42-8 60 4 18-12 40-12 60-4v34c-20-8-42-8-60 4-18-12-40-12-60-4z" {...line} />
          <path d="M100 96v34" {...line} />
          <path d="M54 104c10-3 22-3 32 1M54 114c10-3 22-3 32 1M114 105c10-4 22-4 32-1M114 115c10-4 22-4 32-1" {...line} strokeWidth={2} opacity="0.6" />
        </>
      );
    case "quiz":
      return (
        <>
          <path d="M46 46h82a14 14 0 0 1 14 14v34a14 14 0 0 1-14 14H86l-20 16v-16H46a14 14 0 0 1-14-14V60a14 14 0 0 1 14-14z" {...line} />
          <path d="M76 70a11 11 0 1 1 16 10c-3 2-5 4-5 8" {...line} />
          <circle cx="87" cy="98" r="2.6" fill="currentColor" />
          <path d="M158 40l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill={ACCENT} />
          <path d="M150 104l2.5 5 5.5.6-4 3.8 1.2 5.4-5.2-3-5.2 3 1.2-5.4-4-3.8 5.5-.6z" fill={ACCENT} opacity="0.7" />
        </>
      );
    case "matching":
      return (
        <>
          <rect x="44" y="44" width="52" height="72" rx="9" transform="rotate(-8 70 80)" {...line} />
          <rect x="104" y="44" width="52" height="72" rx="9" transform="rotate(8 130 80)" {...line} />
          <path d="M70 72c-5-7-16-3-14 5 1 6 14 14 14 14s13-8 14-14c2-8-9-12-14-5z" fill={ACCENT} transform="rotate(-8 70 80)" />
          <path d="M130 72c-5-7-16-3-14 5 1 6 14 14 14 14s13-8 14-14c2-8-9-12-14-5z" fill={ACCENT} transform="rotate(8 130 80)" />
          <path d="M88 132c8 6 16 6 24 0" {...line} strokeWidth={2.5} opacity="0.7" />
        </>
      );
    case "puzzle":
      return (
        <>
          <path d="M50 50h30a10 10 0 1 1 20 0h30v30a10 10 0 1 0 0 20v30H100a10 10 0 1 0-20 0H50v-30a10 10 0 1 1 0-20z" {...line} />
          <path d="M140 42h26v26h-9a8 8 0 1 0-16 0h-1z" fill={ACCENT} transform="rotate(12 153 55)" />
          <path d="M66 84h22M66 96h14" {...line} strokeWidth={2} opacity="0.6" />
        </>
      );
    case "drawing":
      return (
        <>
          <path d="M40 116c18-30 32-30 40-12s20 18 30-6 26-22 44 4" {...line} />
          <path d="M126 40l28 28-46 46-14 4 4-14z" {...line} />
          <path d="M120 46l28 28" {...line} />
          <path d="M98 104l14 14" {...line} strokeWidth={2} />
          <circle cx="56" cy="58" r="9" fill={ACCENT} />
          <circle cx="78" cy="48" r="6" fill={ACCENT} opacity="0.65" />
        </>
      );
    case "word_game":
      return (
        <>
          {[
            [40, 60, "A", -6],
            [82, 52, "B", 4],
            [124, 60, "C", -3],
          ].map(([x, y, letter, r]) => (
            <g key={String(letter)} transform={`rotate(${r} ${Number(x) + 18} ${Number(y) + 18})`}>
              <rect x={Number(x)} y={Number(y)} width="36" height="36" rx="7" {...line} />
              <text x={Number(x) + 18} y={Number(y) + 26} textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor" fontFamily="var(--font-sans)">
                {letter}
              </text>
            </g>
          ))}
          <path d="M52 114h96" {...line} strokeWidth={2.5} stroke={ACCENT} />
        </>
      );
  }
}

export function ActivityIllustration({ kind, className }: { kind: ActivityKind; className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={cn("h-full w-full", className)} aria-hidden="true" focusable="false">
      <Scene kind={kind} />
    </svg>
  );
}

/** The art band of a card or the top of an activity page. */
export function ActivityArt({
  kind,
  coverUrl,
  alt,
  mature,
  aspect = "aspect-[5/4]",
  className,
}: {
  kind: ActivityKind;
  coverUrl?: string | null;
  /** The cover's description ("" for decorative). Ignored for the built-in illustration. */
  alt?: string;
  mature?: boolean;
  /** Aspect-ratio classes (kept separate: cn doesn't merge conflicting utilities). */
  aspect?: string;
  className?: string;
}) {
  return (
    <div data-kind={kind} className={cn("play-art relative overflow-hidden", aspect, mature && "play-art-mature", className)}>
      {coverUrl ? (
        <img src={coverUrl} alt={alt ?? ""} className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-[8%]">
          <ActivityIllustration kind={kind} />
        </div>
      )}
    </div>
  );
}
