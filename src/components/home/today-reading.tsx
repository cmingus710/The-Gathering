import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import type { DaySummary } from "@/lib/bible/types";

export type HomeReading = { plan: { id: string; title: string }; day: DaySummary | null; progress: { finished: boolean; started: boolean } };

/**
 * Today's reading from the member's main plan. Shown only when they've
 * joined a plan; nothing is invented when there is no assignment.
 */
export function TodayReading({ data }: { data: HomeReading }) {
  const d = data.day;
  const href = d ? `/bible/day/${d.id}` : `/bible/plans/${data.plan.id}`;
  const detail = d
    ? d.kind === "rest"
      ? "A day to rest"
      : d.passages.join("; ") || d.heading || "Today's reading"
    : data.progress.finished
      ? "You've finished this plan"
      : data.progress.started
        ? "Nothing assigned today"
        : "Your plan hasn't started yet";
  const action = d && d.kind !== "rest" ? (d.completed ? "Read again" : "Continue reading") : "Open plan";
  return (
    <section aria-labelledby="home-reading">
      <h2 id="home-reading" className="sr-only">
        Today&apos;s reading
      </h2>
      <Link href={href} className="interactive flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
        <TileIcon name="bible" className="size-11 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-semibold text-text-secondary">Today&apos;s reading · {data.plan.title}</span>
          <span className="block truncate font-semibold text-text">{detail}</span>
          {d && d.kind !== "rest" ? (
            <span className="flex items-center gap-1 text-meta text-text-secondary">
              {d.completed ? (
                <>
                  <Check className="size-4 text-success" aria-hidden="true" /> Read
                </>
              ) : (
                "Not read yet"
              )}
            </span>
          ) : null}
        </span>
        <span className="hidden shrink-0 text-meta font-semibold text-primary sm:inline">{action}</span>
        <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
      </Link>
    </section>
  );
}
