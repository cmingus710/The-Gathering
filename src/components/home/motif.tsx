/**
 * The "gathering arc" motif: concentric arcs drawing in toward a centre, an
 * abstract echo of people gathered around one point. It is not the approved
 * symbol and never stands in for it. Decorative only.
 */
export function GatheringMotif({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" className={className} aria-hidden="true" focusable="false" fill="none" stroke="var(--motif)" strokeLinecap="round">
      <circle cx="120" cy="120" r="14" fill="var(--motif)" stroke="none" />
      <path d="M62 150a62 62 0 0 1 0-60" strokeWidth="10" />
      <path d="M178 90a62 62 0 0 1 0 60" strokeWidth="10" />
      <path d="M90 62a62 62 0 0 1 60 0" strokeWidth="10" />
      <path d="M150 178a62 62 0 0 1-60 0" strokeWidth="10" />
      <path d="M30 172a104 104 0 0 1 0-104" strokeWidth="6" />
      <path d="M210 68a104 104 0 0 1 0 104" strokeWidth="6" />
      <path d="M68 30a104 104 0 0 1 104 0" strokeWidth="6" />
      <path d="M172 210a104 104 0 0 1-104 0" strokeWidth="6" />
    </svg>
  );
}
