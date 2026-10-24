import { BookOpen, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { renderAnnouncementMarkdown } from "@/lib/announcements/markdown";
import { ageGuidance, kindLabel, type ActivityDetail } from "@/lib/youth/activities";
import { formatDay } from "@/lib/youth/format";
import { ActivityArt } from "./activity-art";
import { DifficultyBadge } from "./learn-play";

/**
 * The top of an activity page (art, type, title, difficulty, age guidance),
 * its Bible and lesson connection, and its description. Shared by the member
 * page and the editor's preview so both show exactly the same thing.
 */
export function ActivityHero({ a, coverUrl, mature, as: Heading = "h1" }: { a: ActivityDetail; coverUrl?: string | null; mature: boolean; as?: "h1" | "h2" }) {
  const age = ageGuidance(a.age_min, a.age_max);
  return (
    <div className={cn("overflow-hidden border border-border bg-surface shadow-(--elev-card)", mature ? "rounded-tile" : "rounded-card")}>
      <ActivityArt kind={a.kind} coverUrl={coverUrl} alt={a.cover_alt} mature={mature} aspect="aspect-[16/9]" />
      <div className="space-y-3 p-5 sm:p-6">
        <p className="text-eyebrow font-semibold uppercase tracking-wide text-text-secondary">{kindLabel(a.kind)}</p>
        <Heading className="font-display text-display font-semibold text-text [overflow-wrap:anywhere] sm:text-[2.125rem]">{a.title}</Heading>
        {a.summary ? <p className="text-text-secondary">{a.summary}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyBadge difficulty={a.difficulty} />
          {age ? <span className="text-meta text-text-secondary">{age} (a suggestion, not a rule)</span> : null}
        </div>
      </div>
    </div>
  );
}

export function ActivityConnection({ a }: { a: ActivityDetail }) {
  if (!a.bible_story && !a.scripture_refs.length && !a.lesson_title) return null;
  return (
    <Card className="space-y-3">
      {a.bible_story ? (
        <p className="flex items-start gap-2">
          <BookOpen className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-semibold">Bible story: </span>
            {a.bible_story}
          </span>
        </p>
      ) : null}
      {a.scripture_refs.length ? (
        <p className="flex items-start gap-2">
          <ScrollText className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-semibold">Scripture: </span>
            {a.scripture_refs.join("; ")}
          </span>
        </p>
      ) : null}
      {a.lesson_title ? (
        <p className="text-meta text-text-secondary">
          Connected to the lesson <span className="font-semibold text-text">{a.lesson_title}</span>
          {a.lesson_week ? ` (week of ${formatDay(a.lesson_week)})` : ""}.
        </p>
      ) : null}
    </Card>
  );
}

/** The description: the announcement Markdown subset, raw HTML escaped, links checked. */
export function ActivityDescription({ source }: { source: string }) {
  if (!source) return null;
  return <div className="prose-gathering break-words" dangerouslySetInnerHTML={{ __html: renderAnnouncementMarkdown(source) }} />;
}
