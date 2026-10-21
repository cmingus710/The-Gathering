"use client";

import { ChevronUp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";

const LINKS = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/profile", label: "Profile", icon: "profile" },
  { href: "/notifications/settings", label: "Notification settings", icon: "notifications" },
  { href: "/settings#privacy", label: "Directory and privacy", icon: "directory" },
] as const;

/**
 * Desktop account control, pinned to the bottom of the sidebar (outside the
 * scrolling nav, so it never scrolls away). A disclosure button: Escape and
 * clicks outside close it, and focus returns to the button.
 */
export function AccountMenu({ name, initial, appearance, signOut }: { name: string; initial: string; appearance: ReactNode; signOut: ReactNode }) {
  const pathname = usePathname();
  // Keyed to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenOn(null);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 bottom-full mb-2 space-y-3 rounded-card border border-border bg-surface-raised p-2 shadow-(--elev-lift)"
      >
        <ul className="space-y-0.5">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpenOn(null)}
                className="flex min-h-11 items-center gap-3 rounded-tile px-3 font-semibold text-text-secondary hover:bg-surface-muted hover:text-text"
              >
                <Icon name={l.icon} className="size-5" />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-1 pt-3">{appearance}</div>
        <div className="border-t border-border pt-2">{signOut}</div>
      </div>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-tile px-2 py-1.5 text-left transition-colors hover:bg-surface-muted",
          open && "bg-surface-muted",
        )}
      >
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted font-display text-[1.0625rem] font-semibold text-text ring-1 ring-border">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-text">{name}</span>
          <span className="block text-meta text-text-secondary">Settings and account</span>
        </span>
        <ChevronUp className={cn("size-5 shrink-0 text-text-secondary transition-transform", !open && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  );
}
