import Link from "next/link";
import { BookOpen, CircleCheck, FileText, User, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type PrayerTab = "feed" | "mine" | "following" | "answered" | "library";

const TABS: Array<{ key: PrayerTab; label: string; href: string; icon: LucideIcon }> = [
  { key: "feed", label: "Requests", href: "/prayer?view=feed", icon: FileText },
  { key: "mine", label: "My Requests", href: "/prayer?view=mine", icon: User },
  { key: "following", label: "Following", href: "/prayer?view=following", icon: Users },
  { key: "answered", label: "Answered", href: "/prayer?view=answered", icon: CircleCheck },
  { key: "library", label: "Prayer Library", href: "/prayer/library", icon: BookOpen },
];

/**
 * The Prayer page's views: the request lists and the Prayer Library, each its
 * own page, so these are links marked with aria-current. Every option stays
 * visible: a two-column grid on a phone with Prayer Library spanning the last
 * row (one column when large text leaves too little room), and a wrapping row
 * of buttons from the small breakpoint up. Labels wrap, never truncate.
 */
export function PrayerTabs({ active }: { active: PrayerTab }) {
  return (
    <nav aria-label="Prayer views" className="@container">
      <ul className="grid grid-cols-1 gap-2 @min-[17rem]:grid-cols-2 sm:flex sm:flex-wrap">
        {TABS.map((t) => {
          const current = t.key === active;
          const Icon = t.icon;
          return (
            <li key={t.key} className={cn(t.key === "library" && "@min-[17rem]:col-span-2")}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-full min-h-12 w-full items-center gap-2.5 rounded-control border px-3 py-2.5 sm:px-4 text-meta leading-tight",
                  "transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  current
                    ? "border-primary bg-primary-soft font-bold ring-1 ring-primary text-text shadow-(--elev-card)"
                    : "border-border-strong/60 bg-surface font-semibold text-text-secondary hover:border-border-strong hover:bg-surface-muted hover:text-text",
                )}
              >
                <Icon className={cn("size-5 shrink-0", current ? "text-primary" : "text-text-secondary")} aria-hidden="true" />
                <span className="min-w-0 break-words">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
