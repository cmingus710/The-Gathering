import type { Metadata } from "next";
import { MemoryNav } from "@/components/memory/nav";
import { PassageText } from "@/components/memory/passage";
import { StageBadge } from "@/components/memory/stage-badge";
import { ItemTranslationNote } from "@/components/memory/translation-note";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, SectionHeading, rowListClass } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireLearner } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/memory/format";
import type { Item } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { AddVerseButton } from "../add-verse-button";

export const metadata: Metadata = { title: "Current memory verse" };

type Assignments = { current: Item[]; upcoming: Item[]; recent: Item[] };

export default async function AssignmentPage() {
  await requireLearner("/memory/assignment");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_assignments");
  const a = (data ?? { current: [], upcoming: [], recent: [] }) as Assignments;
  const range = (i: Item) => (i.starts_on && i.ends_on ? `${formatDay(i.starts_on)} – ${formatDay(i.ends_on)}` : "");
  return (
    <>
      <SectionHeader section="memory" size="compact" title="Current memory verse" description="The verse the church (or your group) is memorizing together right now." />
      <MemoryNav current="assignment" />
      {error ? <Alert tone="error" title="Assignments couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !a.current.length ? (
        <EmptyState glyph="memory" title="Nothing is assigned right now" className="mb-8">
          When the church assigns a verse, it will appear here.
        </EmptyState>
      ) : null}
      <div className="space-y-6">
        {a.current.map((i) => (
          <article key={i.id} aria-labelledby={`a-${i.id}`} className="rounded-card border border-border bg-surface p-5 shadow-(--elev-card) sm:p-6">
            <p className="text-meta font-semibold text-text-secondary">
              {i.collection?.title} · {range(i)}
            </p>
            <h2 id={`a-${i.id}`} className="mt-1 font-display text-[1.5rem] font-semibold">
              {i.passage.label} <span className="text-text-secondary">({i.passage.translation.code})</span>
            </h2>
            <ItemTranslationNote item={i} />
            {i.title ? <p className="mt-1 font-semibold">{i.title}</p> : null}
            <PassageText passage={i.passage} className="mt-4" />
            {i.note ? (
              <aside className="mt-4 rounded-tile border border-border bg-surface-muted/50 p-3 text-meta" aria-label="Note from the church">
                <p className="font-semibold">Note from the church</p>
                <p className="whitespace-pre-line">{i.note}</p>
              </aside>
            ) : null}
            {i.collection?.goal_note || i.collection?.goal_sessions_per_week ? (
              <p className="mt-3 text-meta text-text-secondary">
                Practice goal: {i.collection.goal_note ?? ""}
                {i.collection.goal_sessions_per_week ? ` (about ${i.collection.goal_sessions_per_week} practice sessions a week; just a suggestion)` : ""}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {i.card ? (
                <>
                  <StageBadge stage={i.card.stage} />
                  {i.card.modes && !i.card.modes.length ? (
                    // Practice in this version is paused (e.g. a licensed version's permission was withdrawn); progress is kept.
                    <ButtonLink href={`/memory/verses/${i.card.id}`} variant="secondary">
                      Practice paused · open verse
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={`/memory/practice/${i.card.id}`}>Practice</ButtonLink>
                  )}
                  {!i.card.current_version ? <ButtonLink href={`/memory/verses/${i.card.id}`} variant="secondary">Updated text available</ButtonLink> : null}
                </>
              ) : (
                <AddVerseButton itemId={i.id} label="Start learning it" then="practice" variant="primary" choiceIn={i.translation_choice ? i.collection_id : null} />
              )}
            </div>
          </article>
        ))}
      </div>
      {a.upcoming.length ? (
        <section aria-labelledby="upcoming" className="mt-8">
          <SectionHeading id="upcoming">Coming up</SectionHeading>
          <ul className={rowListClass}>
            {a.upcoming.map((i) => (
              <li key={i.id}>
                <ListRow plain label={`${i.passage.label} (${i.passage.translation.code})`} description={`${i.collection?.title} · ${range(i)}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {a.recent.length ? (
        <section aria-labelledby="recent" className="mt-8">
          <SectionHeading id="recent" description="You can keep reviewing earlier verses for as long as you like.">
            Earlier verses
          </SectionHeading>
          <ul className={rowListClass}>
            {a.recent.map((i) => (
              <li key={i.id}>
                <ListRow plain href={i.card ? `/memory/verses/${i.card.id}` : `/memory/collections/${i.collection_id}`} label={`${i.passage.label} (${i.passage.translation.code})`} description={`${i.collection?.title} · ${range(i)}`} trailing={i.card ? <StageBadge stage={i.card.stage} /> : null} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
