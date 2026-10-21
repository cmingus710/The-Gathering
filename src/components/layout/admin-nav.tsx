"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { activeHref, type AdminNavItem } from "@/lib/navigation";
import { NavIcon } from "./nav-icon";

export function AdminNav({ items, variant }: { items: AdminNavItem[]; variant: "sidebar" | "tabs" }) {
  const pathname = usePathname();
  const current = activeHref(pathname, items.map((i) => i.href));
  if (variant === "tabs") {
    return (
      <nav aria-label="Administration" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1.5 pb-1">
          {items.map((item) => {
            const active = item.href === current;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-meta font-semibold transition-colors",
                    active ? "border-cta bg-cta text-on-cta" : "border-border bg-surface text-text hover:bg-surface-muted",
                  )}
                >
                  <NavIcon name={item.icon} className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Administration">
      <ul className="space-y-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-tile px-3 py-1.5 font-semibold transition-colors",
                  active ? "bg-primary-soft text-text" : "text-text-secondary hover:bg-surface-muted hover:text-text",
                )}
              >
                <NavIcon name={item.icon} active={active} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
