import { BookOpen, CalendarCheck, CircleCheck, Mountain, Sprout, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/card";
import {
  ACTIVITY_KINDS,
  DIFFICULTIES,
  ageGuidance,
  difficultyLabel,
  filterHref,
  isOlderYouth,
  kindLabel,
  type ActivityCard as Card,
  type ActivityFilters,
  type Player,
} from "@/lib/youth/activities";
import { ActivityArt } from "./activity-art";

const ic = "size-3.5";

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const icon =
    difficulty === "challenge" ? <Mountain className={ic} aria-hidden="true" /> : difficulty === "growing" ? <TrendingUp className={ic} aria-hidden="true" /> : <Sprout className={ic} aria-hidden="true" />;
  return (
    <Badge tone="neutral" icon={icon}>
      {difficultyLabel(difficulty)}
    </Badge>
  );
}

/**
 * One activity as an illustrated card. The whole card is one link (the title
 * stretches over it), so it's a single stop for keyboard users. Older-youth
 * activities get the calmer style. Progress chips show only for children the
 * viewer may play for.
 */
export function ActivityCard({
  activity,
  coverUrl,
  href,
  players,
  mature,
}: {
  activity: Card;
  coverUrl?: string | null;
  href: string;
  /** Names for the children in view, to label progress chips. */
  players?: Player[];
  /** Force the older-youth style (e.g. for youth accounts). */
  mature?: boolean;
}) {
  const grown = mature || isOlderYouth(activity.age_min);
  const age = ageGuidance(activity.age_min, activity.age_max);
  const names = new Map((players ?? []).map((p) => [p.id, p.display_name]));
  const done = (activity.progress ?? []).filter((p) => names.has(p.child_id));
  return (
    <li
      className={cn(
        // The stretched title link's focus ring is drawn around the whole card.
        "play-card relative flex flex-col overflow-hidden border border-border bg-surface shadow-(--elev-card) has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-primary",
        grown ? "play-card-mature rounded-tile" : "rounded-card",
      )}
    >
      <ActivityArt kind={activity.kind} coverUrl={coverUrl} alt={activity.cover_alt} mature={grown} aspect="aspect-[16/10] min-[26rem]:aspect-[5/4]" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-eyebrow font-semibold uppercase tracking-wide text-text-secondary">{kindLabel(activity.kind)}</p>
        <h3 className={cn("text-[1.125rem] font-semibold leading-snug text-text", grown && "font-display")}>
          <Link href={href} className="after:absolute after:inset-0 after:content-['']">
            {activity.title}
          </Link>
        </h3>
        {activity.summary ? <p className="line-clamp-3 text-meta text-text-secondary">{activity.summary}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <DifficultyBadge difficulty={activity.difficulty} />
          {activity.this_week ? (
            <Badge tone="warning" icon={<CalendarCheck className={ic} aria-hidden="true" />}>
              This week
            </Badge>
          ) : null}
        </div>
        {age ? <p className="text-meta text-text-secondary">{age}</p> : null}
        {done.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Progress">
            {done.map((p) => (
              <li key={p.child_id}>
                <Badge tone={p.status === "completed" ? "success" : "info"} icon={p.status === "completed" ? <CircleCheck className={ic} aria-hidden="true" /> : undefined}>
                  {names.get(p.child_id)}: {p.status === "completed" ? "finished" : "started"}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function ActivityGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-1 gap-4 min-[26rem]:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}

/** Filter chips (plain links, so they work without JavaScript and keep the URL shareable). */
export function ActivityFilterBar({ base, filters }: { base: string; filters: ActivityFilters }) {
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold transition-colors",
      active ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
    );
  return (
    <div className="space-y-3">
      <nav aria-label="Activity type">
        <p className="mb-1.5 text-meta font-semibold text-text-secondary">Type</p>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={filterHref(base, { ...filters, kind: null })} aria-current={!filters.kind ? "true" : undefined} className={chip(!filters.kind)}>
              All types
            </Link>
          </li>
          {ACTIVITY_KINDS.map((k) => (
            <li key={k.key}>
              <Link href={filterHref(base, { ...filters, kind: k.key })} aria-current={filters.kind === k.key ? "true" : undefined} className={chip(filters.kind === k.key)}>
                {k.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Difficulty">
        <p className="mb-1.5 text-meta font-semibold text-text-secondary">Difficulty</p>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={filterHref(base, { ...filters, difficulty: null })} aria-current={!filters.difficulty ? "true" : undefined} className={chip(!filters.difficulty)}>
              Any level
            </Link>
          </li>
          {DIFFICULTIES.map((d) => (
            <li key={d.key}>
              <Link
                href={filterHref(base, { ...filters, difficulty: d.key })}
                aria-current={filters.difficulty === d.key ? "true" : undefined}
                className={chip(filters.difficulty === d.key)}
              >
                {d.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Nothing published yet (or nothing open to this viewer). */
export function NoActivities({ filtered, children }: { filtered?: boolean; children?: ReactNode }) {
  return (
    <EmptyState icon={<BookOpen className="size-5" aria-hidden="true" />} title={filtered ? "No activities match these choices" : "Activities will appear here when they're published"}>
      {children ??
        (filtered
          ? "Try another type or difficulty."
          : "The church's youth team is preparing Bible stories, games, and puzzles. Each one shows up here as soon as it's published.")}
    </EmptyState>
  );
}
