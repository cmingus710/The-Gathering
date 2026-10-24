import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MemoryNav } from "@/components/memory/nav";
import { StageBadge } from "@/components/memory/stage-badge";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, SectionHeading, rowListClass } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireLearner } from "@/lib/auth/viewer";
import { formatDay, reviewDate } from "@/lib/memory/format";
import type { ReviewQueue } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewPage() {
  await requireLearner("/memory/review");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_review_queue");
  const q = data as ReviewQueue | null;
  return (
    <>
      <SectionHeader section="memory" size="compact" title="Review queue" description="Verses come back for review at growing intervals. Missing a day never loses progress; they simply wait for you." />
      <MemoryNav current="review" />
      {error || !q ? (
        <Alert tone="error" title="Your review queue couldn't be loaded right now." />
      ) : (
        <div className="space-y-8">
          {q.paused ? <Alert tone="info" title="Practice is paused: reminders are off. Reviews below are still here whenever you'd like them." /> : null}
          {q.daily_goal ? (
            <p className="font-semibold" aria-live="polite">
              Today&apos;s goal: {q.done_today} of {q.daily_goal} practice activities{q.done_today >= q.daily_goal ? " · reached" : ""}
            </p>
          ) : null}
          <section aria-labelledby="due">
            <SectionHeading id="due" description={`Your day runs on ${q.timezone.replaceAll("_", " ")} time.`}>
              Due today
            </SectionHeading>
            {q.due.length ? (
              <ul className={rowListClass}>
                {q.due.map((c) => (
                  <li key={c.id}>
                    <ListRow
                      plain
                      href={`/memory/practice/${c.id}`}
                      label={`${c.passage.label} (${c.passage.translation.code})`}
                      description={c.item?.title ?? (c.sessions ? `${c.sessions} practice ${c.sessions === 1 ? "activity" : "activities"} so far` : "New")}
                      trailing={
                        <span className="flex items-center gap-2">
                          <StageBadge stage={c.stage} />
                          <ChevronRight className="size-5" aria-hidden="true" />
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="memory" title="Nothing is due today" action={<ButtonLink href="/memory/verses" variant="secondary" size="sm">Practice anyway</ButtonLink>}>
                Extra practice is always welcome; it never pushes a review later.
              </EmptyState>
            )}
          </section>
          <section aria-labelledby="upcoming">
            <SectionHeading id="upcoming">Upcoming reviews</SectionHeading>
            {q.upcoming.length ? (
              <ul className="space-y-4">
                {q.upcoming.map((d) => (
                  <li key={d.date}>
                    <h3 className="mb-1.5 text-meta font-semibold text-text-secondary">
                      {reviewDate(d.date, q.today).replace(/^on /, "")} · {formatDay(d.date)}
                    </h3>
                    <ul className={rowListClass}>
                      {d.cards.map((c) => (
                        <li key={c.id}>
                          <ListRow plain href={`/memory/verses/${c.id}`} label={`${c.passage.label} (${c.passage.translation.code})`} trailing={<StageBadge stage={c.stage} />} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">No reviews in the next two weeks.</p>
            )}
            {q.later ? <p className="mt-3 text-meta text-text-secondary">{q.later} more {q.later === 1 ? "verse is" : "verses are"} scheduled later.</p> : null}
          </section>
          <p className="text-meta text-text-secondary">
            How reviews are scheduled: <Link href="/memory/progress#how" className="font-semibold text-primary hover:underline">see how progress works</Link>.
          </p>
        </div>
      )}
    </>
  );
}
