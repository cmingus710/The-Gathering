import { CalendarCheck, ChevronRight, Library, ListChecks, Plus, Settings, Trophy, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MemoryNav } from "@/components/memory/nav";
import { StageBadge } from "@/components/memory/stage-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireLearner } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/memory/format";
import type { MemoryHome } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Memory verses" };

export default async function MemoryHomePage() {
  const viewer = await requireLearner("/memory");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_home");
  const home = data as MemoryHome | null;
  const canManage = viewer.capabilities.has(CAPABILITIES.memoryManage) || viewer.capabilities.has(CAPABILITIES.memoryPublish);

  return (
    <>
      <PageHeader
        title="Memory verses"
        description="Hide God's word in your heart, a little at a time. Your practice and progress are private to you."
        actions={
          <ButtonLink href="/memory/verses/add" variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
            Add a verse
          </ButtonLink>
        }
      />
      <MemoryNav current="home" />
      {error || !home ? (
        <Alert tone="error" title="Memory verses couldn't be loaded right now." />
      ) : (
        <div className="space-y-8">
          {home.settings.paused ? (
            <Alert tone="info" title="Practice is paused.">
              Reminders are off and nothing is lost. <Link href="/memory/settings" className="font-semibold text-primary hover:underline">Resume in settings</Link>.
            </Alert>
          ) : null}

          <section aria-labelledby="memory-current">
            <SectionHeading id="memory-current" action={home.assignments.length ? <Link href="/memory/assignment" className="text-meta font-semibold text-primary hover:underline">Details</Link> : null}>
              Current memory verse
            </SectionHeading>
            {home.assignments.length ? (
              <ul className="space-y-3">
                {home.assignments.map((a) => (
                  <li key={a.id} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card)">
                    <p className="text-meta font-semibold text-text-secondary">
                      {a.collection?.title} · {a.starts_on && a.ends_on ? `${formatDay(a.starts_on)} – ${formatDay(a.ends_on)}` : ""}
                    </p>
                    <p className="mt-1 text-title font-semibold">
                      {a.title ? `${a.title} · ` : ""}
                      {a.passage.label} <span className="text-text-secondary">({a.passage.translation.code})</span>
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.card ? (
                        <>
                          <StageBadge stage={a.card.stage} />
                          <ButtonLink href={`/memory/practice/${a.card.id}`} size="sm">
                            Practice
                          </ButtonLink>
                        </>
                      ) : (
                        <ButtonLink href="/memory/assignment" size="sm">
                          Start learning it
                        </ButtonLink>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                glyph="memory"
                title="No verse is assigned right now"
                action={
                  canManage ? (
                    <ButtonLink href="/admin/memory" variant="secondary" size="sm">
                      Assign a memory verse
                    </ButtonLink>
                  ) : null
                }
              >
                You can still browse collections or add your own verse.
              </EmptyState>
            )}
          </section>

          <section aria-labelledby="memory-today">
            <SectionHeading id="memory-today">Today</SectionHeading>
            <ul className={rowListClass}>
              <li>
                <ListRow
                  plain
                  href="/memory/review"
                  icon={<ListChecks className="size-5" aria-hidden="true" />}
                  label="Review queue"
                  description={home.due_count ? `${home.due_count} ready to review` : home.card_count ? "Nothing due today" : "Add a verse to start"}
                  trailing={<ChevronRight className="size-5" aria-hidden="true" />}
                />
              </li>
              <li>
                <ListRow
                  plain
                  href="/memory/progress"
                  icon={<Trophy className="size-5" aria-hidden="true" />}
                  label="Progress and badges"
                  description={home.settings.daily_goal ? `${home.done_today} of ${home.settings.daily_goal} practice activities today` : `${home.done_today} practice ${home.done_today === 1 ? "activity" : "activities"} today`}
                  trailing={<ChevronRight className="size-5" aria-hidden="true" />}
                />
              </li>
              <li>
                <ListRow plain href="/memory/collections" icon={<Library className="size-5" aria-hidden="true" />} label="Verse collections" trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
              </li>
              <li>
                <ListRow plain href="/memory/settings" icon={<Settings className="size-5" aria-hidden="true" />} label="Practice settings" description="Difficulty, kids presentation, reminders" trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
              </li>
            </ul>
          </section>

          {home.recent.length ? (
            <section aria-labelledby="memory-recent">
              <SectionHeading id="memory-recent" action={<Link href="/memory/verses" className="text-meta font-semibold text-primary hover:underline">My Verses</Link>}>
                Recently practiced
              </SectionHeading>
              <ul className={rowListClass}>
                {home.recent.map((c) => (
                  <li key={c.id}>
                    <ListRow plain href={`/memory/verses/${c.id}`} label={`${c.passage.label} (${c.passage.translation.code})`} description={c.item?.title ?? undefined} trailing={<StageBadge stage={c.stage} />} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {home.challenges.length ? (
            <section aria-labelledby="memory-challenges">
              <SectionHeading id="memory-challenges" description="Optional, and only what you choose to share is counted, as a group total.">
                Group challenges
              </SectionHeading>
              <ul className={rowListClass}>
                {home.challenges.map((ch) => (
                  <li key={ch.id}>
                    <ListRow
                      plain
                      href={`/memory/challenges/${ch.id}`}
                      icon={<UsersRound className="size-5" aria-hidden="true" />}
                      label={ch.title}
                      description={`Until ${formatDay(ch.ends_on)}`}
                      trailing={ch.joined ? <Badge tone="success">Joined</Badge> : <ChevronRight className="size-5" aria-hidden="true" />}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {home.leads || canManage ? (
            <section aria-labelledby="memory-manage">
              <SectionHeading id="memory-manage">Leading</SectionHeading>
              <ul className={rowListClass}>
                {canManage ? (
                  <li>
                    <ListRow plain href="/admin/memory" icon={<CalendarCheck className="size-5" aria-hidden="true" />} label="Manage memory verses" description="Collections, assignments, challenges" trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
                  </li>
                ) : (
                  <li>
                    <ListRow plain href="/memory/lead" icon={<CalendarCheck className="size-5" aria-hidden="true" />} label="My group's memory verses" description="Collections and challenges for groups you lead" trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
                  </li>
                )}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
