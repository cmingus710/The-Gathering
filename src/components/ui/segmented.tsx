import type { ReactNode } from "react";
import { cn } from "./cn";

/** Track for a small set of mutually exclusive views (links or radios). */
export function SegmentedTrack({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <nav aria-label={label} className={cn("inline-flex rounded-full border border-border bg-surface-muted p-1", className)}>
      {children}
    </nav>
  );
}

export function segmentClass(active: boolean) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-meta font-semibold transition-colors",
    active ? "bg-surface-raised text-text shadow-(--elev-card) ring-1 ring-border" : "text-text-secondary hover:text-text",
  );
}
