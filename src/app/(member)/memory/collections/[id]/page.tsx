import { ArrowLeft, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryNav } from "@/components/memory/nav";
import { PassageText } from "@/components/memory/passage";
import { StageBadge } from "@/components/memory/stage-badge";
import { ItemTranslationNote } from "@/components/memory/translation-note";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireLearner } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/memory/format";
import { signMemoryPaths } from "@/lib/memory/storage";
import type { Collection, Item } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { deleteMyCollectionAction, myCollectionItemAction } from "../../actions";
import { AddVerseButton } from "../../add-verse-button";
import { MyCollectionForm } from "../forms";

export const metadata: Metadata = { title: "Verse collection" };

type Detail = Collection & { mine: boolean; items: Item[]; challenges: Array<{ id: string; title: string; starts_on: string; ends_on: string }> };

export default async function CollectionPage({ params }: PageProps<"/memory/collections/[id]">) {
  const { id } = await params;
  await requireLearner(`/memory/collections/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_collection", { p_id: id });
  if (error?.code === "P0002" || (error && /invalid input syntax/.test(error.message))) notFound();
  const c = data as Detail | null;
  if (!c) return <Alert tone="error" title="This collection couldn't be loaded right now." />;
  const cover = c.cover_path ? (await signMemoryPaths(supabase, [c.cover_path])).get(c.cover_path) : undefined;
  return (
    <>
      <Link href="/memory/collections" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Collections
      </Link>
      <PageHeader eyebrow={c.mine ? "My collection" : (c.group_name ?? "Church collection")} title={c.title} description={c.description || undefined} />
      <MemoryNav current="collections" />
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; never through the image cache
        <img src={cover} alt={c.cover_alt ?? ""} className="mb-6 aspect-[16/7] w-full max-w-3xl rounded-card object-cover" />
      ) : null}
      {c.goal_note || c.goal_sessions_per_week ? (
        <p className="mb-6 text-text-secondary">
          Practice goal: {c.goal_note ?? ""}
          {c.goal_sessions_per_week ? ` (about ${c.goal_sessions_per_week} practice sessions a week; just a suggestion)` : ""}
        </p>
      ) : null}
      {c.challenges.length ? (
        <section aria-labelledby="ch" className="mb-6">
          <SectionHeading id="ch">Group challenges</SectionHeading>
          <ul className={rowListClass}>
            {c.challenges.map((ch) => (
              <li key={ch.id}>
                <ListRow plain href={`/memory/challenges/${ch.id}`} icon={<UsersRound className="size-5" aria-hidden="true" />} label={ch.title} description={`${formatDay(ch.starts_on)} – ${formatDay(ch.ends_on)}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ol className="space-y-4">
        {c.items.map((i) => (
          <li key={i.id} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-title font-semibold">
                {i.position}. {i.title ? `${i.title} · ` : ""}
                {i.passage.label} <span className="text-text-secondary">({i.passage.translation.code})</span>
              </h2>
              {i.starts_on && i.ends_on ? <span className="text-meta text-text-secondary">{formatDay(i.starts_on)} – {formatDay(i.ends_on)}</span> : null}
            </div>
            {c.mine ? null : <ItemTranslationNote item={i} className="mb-2 text-meta text-text-secondary" />}
            <PassageText passage={i.passage} />
            {i.note ? (
              <aside className="mt-3 rounded-tile bg-surface-muted/50 p-3 text-meta" aria-label="Note">
                <p className="whitespace-pre-line">{i.note}</p>
              </aside>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {i.card ? (
                <>
                  <StageBadge stage={i.card.stage} />
                  <ButtonLink href={`/memory/practice/${i.card.id}`} size="sm">
                    Practice
                  </ButtonLink>
                  {!i.card.current_version ? (
                    <ButtonLink href={`/memory/verses/${i.card.id}`} size="sm" variant="secondary">
                      Updated text available
                    </ButtonLink>
                  ) : null}
                </>
              ) : (
                <AddVerseButton itemId={i.id} choiceIn={i.translation_choice ? c.id : null} />
              )}
              {c.mine ? (
                <form action={myCollectionItemAction}>
                  <input type="hidden" name="item_id" value={i.id} />
                  <SubmitButton size="sm" variant="ghost">
                    Remove from this collection
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {!c.items.length ? <p className="text-text-secondary">{c.mine ? "Add verses from a verse's page in My Verses." : "No verses yet."}</p> : null}
      {c.mine ? (
        <section aria-labelledby="edit" className="mt-8 space-y-4">
          <SectionHeading id="edit">Edit this collection</SectionHeading>
          <div className="rounded-card border border-border bg-surface p-4">
            <MyCollectionForm id={c.id} title={c.title} description={c.description} />
          </div>
          <ConfirmDialog trigger="Delete this collection" title="Delete this collection?" confirmLabel="Delete" formAction={deleteMyCollectionAction} hidden={{ id: c.id }}>
            <p>Your verses stay in My Verses with their history; only the collection is removed.</p>
          </ConfirmDialog>
        </section>
      ) : null}
    </>
  );
}
