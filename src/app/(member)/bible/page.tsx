import { BookOpen, ChevronRight, NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProgressSummary } from "@/components/bible/progress";
import { TileIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, SectionHeading, rowListClass } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { TileGrid } from "@/components/ui/tile-grid";
import { SelectField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { kindLabel, scheduleLabel } from "@/lib/bible/format";
import { signBiblePaths } from "@/lib/bible/storage";
import type { DaySummary, Enrollment, PlanCard, Progress, Translation } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";
import { preferredVersionAction } from "./actions";

export const metadata: Metadata = { title: "Bible reading" };

type Hub = {
  featured: (PlanCard & { enrolled: boolean }) | null;
  enrollments: Array<{ enrollment: Enrollment; plan: PlanCard; progress: Progress; today: DaySummary | null }>;
  available: PlanCard[];
  history: Array<{ enrollment: Enrollment; plan: PlanCard; progress: Progress }>;
};

function Cover({ url, alt }: { url?: string; alt: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; never through the image cache
    <img src={url} alt={alt ?? ""} className="aspect-[16/9] w-full rounded-tile object-cover" />
  ) : (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-tile bg-surface-muted" aria-hidden="true">
      <TileIcon name="bible" className="size-14" />
    </div>
  );
}

export default async function BiblePage() {
  const viewer = await requireApprovedMember("/bible");
  const supabase = await requireClient();
  const [{ data, error }, translations] = await Promise.all([supabase.rpc("bible_hub"), supabase.rpc("bible_translations")]);
  const hub = (data ?? { featured: null, enrollments: [], available: [], history: [] }) as Hub;
  const versions = (translations.error ? null : (translations.data as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null)) ?? { default_id: null, preferred_id: null, items: [] };
  const hasTranslation = versions.items.length > 0;
  const churchDefault = versions.items.find((t) => t.id === versions.default_id);
  const covers = await signBiblePaths(supabase, [hub.featured?.cover_path, ...hub.available.map((p) => p.cover_path)]);
  const others = hub.available.filter((p) => p.id !== hub.featured?.id);
  const canManage = viewer.capabilities.has(CAPABILITIES.readingEdit) || viewer.capabilities.has(CAPABILITIES.readingPublish);

  return (
    <>
      <SectionHero art="bible" glyph="bible"
        title="Bible reading"
        description="Read along with the church, or at your own pace. Your progress, highlights, and notes are private to you."
        actions={
          <>
            {hasTranslation ? (
              <ButtonLink href="/bible/read" variant="secondary" size="sm" icon={<BookOpen className="size-4" aria-hidden="true" />}>
                Open the Bible
              </ButtonLink>
            ) : null}
            <ButtonLink href="/journal" variant="secondary" size="sm" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
              My Journal
            </ButtonLink>
          </>
        }
      />
      {error ? <Alert tone="error" title="Bible reading couldn't be loaded right now." className="mb-6" /> : null}

      {hub.enrollments.length ? (
        <section aria-labelledby="bible-today" className="mb-8">
          <SectionHeading id="bible-today">Today</SectionHeading>
          <ul className="space-y-3">
            {hub.enrollments.map(({ enrollment, plan, progress, today }) => (
              <li key={enrollment.id} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card)">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/bible/plans/${plan.id}`} className="font-semibold text-text hover:underline">
                    {plan.title}
                  </Link>
                  {enrollment.is_primary && hub.enrollments.length > 1 ? <Badge tone="info">Primary</Badge> : null}
                </div>
                {today ? (
                  <Link href={`/bible/day/${today.id}`} className="interactive mt-3 flex min-h-14 items-center gap-3 rounded-tile border border-border bg-surface-muted/50 px-3 py-2 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1">
                      <span className="block text-meta font-semibold text-text-secondary">
                        {today.kind === "reading" ? today.label : kindLabel(today.kind)}
                        {today.completed ? " · Read" : ""}
                      </span>
                      <span className="block truncate font-semibold">{today.kind === "rest" ? "A day to rest" : today.passages.join("; ") || today.heading}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="mt-2 text-meta text-text-secondary">
                    {progress.finished ? "You've finished this plan." : progress.started ? "Nothing is assigned for today." : "This plan hasn't started yet."}
                  </p>
                )}
                <div className="mt-3">
                  <ProgressSummary progress={progress} />
                </div>
                {progress.behind ? (
                  <Link href={`/bible/plans/${plan.id}/catch-up`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                    Catch up
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hub.featured ? (
        <section aria-labelledby="bible-featured" className="mb-8">
          <SectionHeading id="bible-featured">Church reading plan</SectionHeading>
          <Link href={`/bible/plans/${hub.featured.id}`} className="interactive grid gap-4 rounded-card border border-border bg-surface p-4 hover:bg-surface-muted/60 sm:grid-cols-[minmax(0,14rem)_1fr]">
            <Cover url={hub.featured.cover_path ? covers.get(hub.featured.cover_path) : undefined} alt={hub.featured.cover_alt} />
            <span className="min-w-0">
              <span className="block text-title font-semibold">{hub.featured.title}</span>
              <span className="mt-1 block text-meta text-text-secondary">
                {scheduleLabel(hub.featured)} · {hub.featured.translation.code}
              </span>
              {hub.featured.description ? <span className="mt-2 line-clamp-3 block text-text-secondary">{hub.featured.description}</span> : null}
              <span className="mt-3 inline-flex font-semibold text-primary">{hub.featured.enrolled ? "Continue" : "See the plan"}</span>
            </span>
          </Link>
        </section>
      ) : null}

      {others.length ? (
        <section aria-labelledby="bible-plans" className="mb-8">
          <SectionHeading id="bible-plans">Reading plans</SectionHeading>
          <ul className={rowListClass}>
            {others.map((p) => (
              <li key={p.id}>
                <ListRow
                  plain
                  href={`/bible/plans/${p.id}`}
                  icon={<TileIcon name="bible" className="size-7" />}
                  label={p.title}
                  description={[scheduleLabel(p), p.audience_note, p.group_name].filter(Boolean).join(" · ")}
                  trailing={<ChevronRight className="size-5" aria-hidden="true" />}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!error && !hub.enrollments.length && !hub.available.length ? (
        <EmptyState
          glyph="bible"
          title="No reading plans yet"
          className="mb-8"
          action={
            canManage ? (
              <ButtonLink href="/admin/bible" variant="secondary" size="sm">
                Create a reading plan
              </ButtonLink>
            ) : null
          }
        >
          {hasTranslation ? "You can still open the Bible and read." : "Reading plans will appear here once the church publishes one."}
        </EmptyState>
      ) : null}

      <section aria-labelledby="bible-yours" className="mb-8">
        <SectionHeading id="bible-yours">Yours</SectionHeading>
        <TileGrid
          label="Your Bible reading"
          tiles={[
            ...(hasTranslation ? [{ href: "/bible/read", label: "Open the Bible", art: "bible" as const, glyph: "bible" as const }] : []),
            { href: "/bible/bookmarks", label: "Bookmarks & highlights", glyph: "memory" },
            { href: "/journal", label: "My Journal", glyph: "journal" },
          ]}
        />
      </section>

      {versions.items.length > 1 ? (
        <section aria-labelledby="bible-version" className="mb-8">
          <SectionHeading id="bible-version" description="Used when you open the Bible and for your plans' daily readings. Each passage is labelled with its version; versions are never mixed within a passage.">
            Bible version
          </SectionHeading>
          <form action={preferredVersionAction} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
            <SelectField label="Version I prefer" name="translation_id" defaultValue={versions.preferred_id ?? ""} className="min-w-0 flex-1 basis-64">
              <option value="">{churchDefault ? `No preference (${churchDefault.code}, or each plan's own version)` : "No preference (each plan's own version)"}</option>
              {versions.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </SelectField>
            <SubmitButton variant="secondary" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {hub.history.length ? (
        <section aria-labelledby="bible-history">
          <SectionHeading id="bible-history" description="Plans you left. Your history is kept unless you delete it.">
            Earlier plans
          </SectionHeading>
          <ul className={rowListClass}>
            {hub.history.map(({ enrollment, plan, progress }) => (
              <li key={enrollment.id}>
                <ListRow plain href={`/bible/plans/${plan.id}`} label={plan.title} description={`${progress.completed} of ${progress.total} read`} trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
