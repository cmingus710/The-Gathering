"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { segmentClass } from "@/components/ui/segmented";

export type PrayerTab = "feed" | "mine" | "following" | "answered" | "library";

const TABS: Array<{ key: PrayerTab; label: string; href: string }> = [
  { key: "feed", label: "Requests", href: "/prayer?view=feed" },
  { key: "mine", label: "My requests", href: "/prayer?view=mine" },
  { key: "following", label: "Following", href: "/prayer?view=following" },
  { key: "answered", label: "Answered", href: "/prayer?view=answered" },
  { key: "library", label: "Prayer Library", href: "/prayer/library" },
];

/**
 * The Prayer page's tabs: the request views and the Prayer Library. On a
 * narrow screen the row scrolls sideways (never wraps or squeezes), and the
 * current tab is scrolled into view so it's never hidden off the edge.
 */
export function PrayerTabs({ active }: { active: PrayerTab }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const track = ref.current;
    const current = track?.querySelector<HTMLElement>("[aria-current=page]");
    if (!track || !current) return;
    if (current.offsetLeft + current.offsetWidth > track.clientWidth + track.scrollLeft || current.offsetLeft < track.scrollLeft) {
      track.scrollLeft = current.offsetLeft - 8;
    }
  }, [active]);
  return (
    <nav
      ref={ref}
      aria-label="Prayer views"
      className="flex max-w-full overflow-x-auto overscroll-x-contain rounded-full border border-border bg-surface-muted p-1 [scrollbar-width:thin] sm:inline-flex"
    >
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={cn(segmentClass(t.key === active), "shrink-0 whitespace-nowrap")} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
