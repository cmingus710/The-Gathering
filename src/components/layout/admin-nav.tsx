"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { isActivePath, type AdminNavItem } from "@/lib/navigation";
import { NavIcon } from "./nav-icon";

export function AdminNav({ items, variant }: { items: AdminNavItem[]; variant: "sidebar" | "tabs" }) {
  const pathname = usePathname();
  if (variant === "tabs") {
    return (
      <nav aria-label="Administration" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1.5 pb-1">
          {items.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[0.95rem] font-semibold",
                    active ? "border-brand-charcoal bg-brand-charcoal text-background" : "border-border-strong bg-surface text-text hover:bg-surface-muted",
                  )}
                >
                  <NavIcon name={item.icon} className="size-4" />
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
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 font-semibold",
                  active ? "bg-surface-muted text-text shadow-[inset_3px_0_0_var(--color-brand-gold)]" : "text-text hover:bg-surface-muted",
                )}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
