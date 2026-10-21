"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { isActivePath } from "@/lib/navigation";

const LINKS = [
  { href: "/youth", label: "Youth home" },
  { href: "/memory", label: "Memory verses" },
  { href: "/bible", label: "Bible reading" },
  { href: "/journal", label: "My Journal" },
  { href: "/youth/account", label: "My account" },
];

export function YouthNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Youth" className="mx-auto max-w-5xl overflow-x-auto px-3 pb-2 sm:px-5">
      <ul className="flex min-w-max gap-1.5">
        {LINKS.map((l) => {
          const active = l.href === "/youth" ? pathname === "/youth" : isActivePath(pathname, l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 font-semibold transition-colors",
                  active ? "bg-primary-soft text-text" : "text-text-secondary hover:bg-surface-muted hover:text-text",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
