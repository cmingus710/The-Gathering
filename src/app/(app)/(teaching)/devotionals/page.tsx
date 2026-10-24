import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CollectionCard } from "@/components/devotionals/collection-card";
import { ContentDetail } from "@/components/media/content-detail";
import { ItemCard } from "@/components/media/item-card";
import { VisitorNote } from "@/components/media/visitor-note";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, SectionHeading } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { CollectionCards } from "@/lib/devotionals/types";
import { formatDay, isYmd } from "@/lib/media/format";
import { listItems, prepareDetail } from "@/lib/media/pages";
import { signPaths } from "@/lib/media/storage";
import { coverPaths } from "@/lib/media/format";
import type { ItemCard as Card, ItemDetail } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Devotionals" };

type Day = { today: string; date: string; item: ItemDetail | null; others: Card[]; previous: string | null; next: string | null };

export default async function DevotionalsPage({ searchParams }: PageProps<"/devotionals">) {
  const sp = await searchParams;
  const viewer = await teachingViewer();
  const supabase = await requireClient();
  const date = isYmd(sp.date) ? sp.date : null;
  const { data, error } = await supabase.rpc("media_devotional_day", { p_date: date });
  if (error || !data) {
    return (
      <>
        <SectionHeader section="devotionals" />
        <Alert tone="error" title="Devotionals couldn't be loaded right now." />
      </>
    );
  }
  const day = data as Day;
  const isToday = day.date === day.today;
  const recent = await listItems(supabase, "devotional", { to: day.today }, 7);
  const recentOthers = recent.items.filter((i) => i.id !== day.item?.id).slice(0, 6);
  const detail = day.item ? await prepareDetail(supabase, day.item, [...day.others, ...recentOthers]) : null;
  const urls = detail?.urls ?? (await signPaths(supabase, coverPaths([...day.others, ...recentOthers])));
  // Imported collections (Morning & Evening) are for members: just today's two readings each, beside the church's own devotionals.
  const cards = viewer.member ? ((await supabase.rpc("media_collections")).data as CollectionCards | null) : null;
  const collectionUrls = cards?.collections.length
    ? await signPaths(supabase, cards.collections.map((c) => (c.cover ? (c.cover.variant_path ?? c.cover.path) : null)))
    : new Map<string, string>();

  return (
    <>
      <SectionHeader
        section="devotionals"
        description={
          <>
            {isToday ? "Today's devotional" : "Devotional for"} · <time dateTime={day.date}>{formatDay(day.date, "weekday")}</time>
          </>
        }
        actions={
          <>
            <ButtonLink href="/devotionals/archive" variant="secondary" size="sm">
              Archive
            </ButtonLink>
            {viewer.member ? (
              <ButtonLink href="/journal" variant="secondary" size="sm" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
                My Journal
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <nav aria-label="Other days" className="mb-6 flex items-center justify-between gap-2">
        {day.previous ? (
          <Link href={`/devotionals?date=${day.previous}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
            <ChevronLeft className="size-4" aria-hidden="true" /> {formatDay(day.previous, "short")}
          </Link>
        ) : (
          <span />
        )}
        {!isToday ? (
          <Link href="/devotionals" className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
            Today
          </Link>
        ) : null}
        {day.next ? (
          <Link href={`/devotionals?date=${day.next}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
            {formatDay(day.next, "short")} <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
      {!viewer.member ? <div className="mb-6"><VisitorNote next="/devotionals" /></div> : null}
      {detail ? (
        <ContentDetail item={detail.item} urls={detail.urls} transcripts={detail.transcripts} member={viewer.member} origin={getSiteUrl()} headingLevel={2} />
      ) : (
        <EmptyState
          glyph="devotionals"
          title={isToday ? "No devotional today" : "No devotional for this day"}
          action={
            day.previous ? (
              <ButtonLink href={`/devotionals?date=${day.previous}`} variant="secondary" size="sm">
                Read the most recent one
              </ButtonLink>
            ) : null
          }
        >
          {isToday ? "There isn't one for today. New devotionals appear here on their day." : "Choose another day or browse the archive."}
        </EmptyState>
      )}
      {cards?.collections.length ? (
        <section aria-labelledby="devotional-collections" className="mt-8">
          <SectionHeading id="devotional-collections">Daily reading collections</SectionHeading>
          <ul className="space-y-3">
            {cards.collections.map((c) => (
              <li key={c.id}>
                <CollectionCard collection={c} today={cards.today} urls={collectionUrls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {day.others.length ? (
        <section aria-labelledby="also-today" className="mt-8">
          <SectionHeading id="also-today">Also for this day</SectionHeading>
          <ul className="space-y-3">
            {day.others.map((o) => (
              <li key={o.id}>
                <ItemCard item={o} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {recentOthers.length ? (
        <section aria-labelledby="recent-devotionals" className="mt-10">
          <SectionHeading id="recent-devotionals" action={<Link href="/devotionals/archive" className="min-h-11 px-2 font-semibold text-primary hover:underline">Archive</Link>}>
            Recent devotionals
          </SectionHeading>
          <ul className="space-y-3">
            {recentOthers.map((o) => (
              <li key={o.id}>
                <ItemCard item={o} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
