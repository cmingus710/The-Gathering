import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type PrayerSection = "requests" | "library";

const SECTIONS: Array<{ key: PrayerSection; label: string; href: string }> = [
  { key: "requests", label: "Requests", href: "/prayer" },
  { key: "library", label: "Prayer Library", href: "/prayer/library" },
];

/**
 * The Prayer page's two sections, each its own page, so these are links
 * marked with aria-current. Both stay fully visible side by side on a phone
 * (equal halves; labels wrap, never truncate or scroll). The request views
 * (My requests, Following, Answered) live in the View menu under Requests.
 */
export function PrayerTabs({ active }: { active: PrayerSection }) {
  return (
    <nav aria-label="Prayer sections" className="border-b border-border">
      <ul className="grid grid-cols-2 sm:flex sm:gap-6">
        {SECTIONS.map((s) => {
          const current = s.key === active;
          return (
            <li key={s.key} className="flex">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 w-full items-center justify-center border-b-2 px-2 py-2 text-center text-base leading-tight sm:justify-start sm:px-1",
                  "rounded-t-control transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  current ? "border-primary font-semibold text-primary" : "border-transparent text-text-secondary hover:border-border-strong hover:text-text",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
