"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import type { View } from "@/lib/prayer/format";

const VIEW_OPTION_LABEL: Record<View, string> = { feed: "All requests", mine: "My requests", following: "Following", answered: "Answered" };
const ORDER: View[] = ["feed", "mine", "following", "answered"];

/**
 * The "View" selector for prayer requests. Each view is its own address
 * (`/prayer?view=…`), so the options are links in a disclosure, not a
 * <select> that would navigate on every arrow key. Works without JavaScript;
 * with it, the menu also closes on Escape (returning focus) or a click outside.
 */
export function ViewMenu({ active, className }: { active: View; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
      } else if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className={cn("group relative", className)}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control border border-border-strong/60 bg-surface px-3 text-meta text-text [&::-webkit-details-marker]:hidden",
          "hover:border-border-strong hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">View:</span> {VIEW_OPTION_LABEL[active]}
        </span>
        <ChevronDown className="size-4 shrink-0 text-text-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul aria-label="Request views" className="absolute left-0 z-20 mt-1 min-w-full w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-control border border-border bg-surface-raised p-1 shadow-(--elev-card)">
        {ORDER.map((v) => {
          const current = v === active;
          return (
            <li key={v}>
              <Link
                href={`/prayer?view=${v}`}
                aria-current={current ? "page" : undefined}
                onClick={() => {
                  if (ref.current) ref.current.open = false;
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-control px-3 py-2 text-meta",
                  "hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-primary",
                  current ? "font-semibold text-text" : "text-text-secondary",
                )}
              >
                <Check className={cn("size-4 shrink-0 text-primary", !current && "invisible")} aria-hidden="true" />
                {VIEW_OPTION_LABEL[v]}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
