/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { INK, PAPER, colorHex, type ColoringTemplate } from "@/lib/youth/coloring";

/**
 * The picture's vector layers, drawn from the checked path data (never from
 * uploaded markup): the tap-to-fill colors underneath, and the line art on
 * top. Decorative to assistive technology: the studio lists the parts by
 * name, and the page tells the story in words.
 */
export function ColoringFills({ t, fills, className }: { t: ColoringTemplate; fills: Record<string, string>; className?: string }) {
  return (
    <svg viewBox={`0 0 ${t.width} ${t.height}`} className={className} aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <rect width={t.width} height={t.height} fill={PAPER} />
      {t.regions.map((r) => (
        <path key={r.id} d={r.d} fillRule={r.rule} fill={fills[r.id] ? colorHex(fills[r.id]) : PAPER} />
      ))}
    </svg>
  );
}

export function ColoringLines({
  t,
  lineArtUrl,
  highlight,
  className,
}: {
  t: ColoringTemplate;
  lineArtUrl?: string | null;
  /** A part to outline (keyboard focus on the parts list). */
  highlight?: string | null;
  className?: string;
}) {
  if (t.mode === "freehand") {
    return lineArtUrl ? (
      // Multiply keeps the paper of a scanned drawing from hiding the coloring underneath.
      <img src={lineArtUrl} alt="" draggable={false} className={className} style={{ mixBlendMode: "multiply", objectFit: "fill" }} />
    ) : null;
  }
  const h = highlight ? t.regions.find((r) => r.id === highlight) : null;
  return (
    <svg viewBox={`0 0 ${t.width} ${t.height}`} className={className} aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <g fill="none" stroke={INK} strokeLinejoin="round" strokeLinecap="round">
        {t.regions.map((r) => (r.w || t.outline ? <path key={r.id} d={r.d} strokeWidth={r.w || t.outline} /> : null))}
      </g>
      {t.lines.map((l, i) => (
        <path key={i} d={l.d} fill={l.fill ? INK : "none"} stroke={l.w ? INK : "none"} strokeWidth={l.w || undefined} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {h ? (
        <g fill="none" strokeLinejoin="round">
          <path d={h.d} stroke="#ffffff" strokeWidth={14} />
          <path d={h.d} stroke="#1e5bc6" strokeWidth={8} strokeDasharray="18 10" />
        </g>
      ) : null}
    </svg>
  );
}

/** A still picture: the editor's preview and the conflict comparison. */
export function ColoringPreview({ t, fills = {}, lineArtUrl, className }: { t: ColoringTemplate; fills?: Record<string, string>; lineArtUrl?: string | null; className?: string }) {
  return (
    <div className={className} style={{ position: "relative", aspectRatio: `${t.width} / ${t.height}` }}>
      <ColoringFills t={t} fills={fills} className="absolute inset-0 size-full" />
      <ColoringLines t={t} lineArtUrl={lineArtUrl} className="absolute inset-0 size-full" />
    </div>
  );
}
