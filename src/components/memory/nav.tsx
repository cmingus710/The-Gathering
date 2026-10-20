import Link from "next/link";
import { cn } from "@/components/ui/cn";

const LINKS = [
  { key: "home", label: "Memory home", href: "/memory" },
  { key: "assignment", label: "This week", href: "/memory/assignment" },
  { key: "review", label: "Review", href: "/memory/review" },
  { key: "verses", label: "My Verses", href: "/memory/verses" },
  { key: "collections", label: "Collections", href: "/memory/collections" },
  { key: "progress", label: "Progress", href: "/memory/progress" },
  { key: "settings", label: "Settings", href: "/memory/settings" },
] as const;

export type MemorySection = (typeof LINKS)[number]["key"];

/** Section links for scripture memory: one row that scrolls sideways on phones. */
export function MemoryNav({ current }: { current: MemorySection }) {
  return (
    <nav aria-label="Memory verses" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2">
        {LINKS.map((l) => (
          <li key={l.key}>
            <Link
              href={l.href}
              aria-current={l.key === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold whitespace-nowrap transition-colors",
                l.key === current ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text",
              )}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
