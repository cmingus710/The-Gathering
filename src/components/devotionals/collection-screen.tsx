import { CalendarDays, ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { fieldControlClass } from "@/components/ui/field";
import { segmentClass, SegmentedTrack } from "@/components/ui/segmented";
import { defaultSlot, nextReading, previousReading, SLOT_LABEL, SLOTS } from "@/lib/devotionals/calendar";
import type { Slot } from "@/lib/devotionals/morning-evening";
import type { CollectionInfo, CollectionReading, ReadingStub } from "@/lib/devotionals/types";
import { formatDay } from "@/lib/media/format";
import { CollectionAttribution, collectionHref, dayHref, ReadingView, readingHref } from "./reading-view";

const navLink = "inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft";

/**
 * A collection's daily screen: Morning/Evening, a date picker, Today, the
 * previous and next readings (evening → next morning, across months and
 * years), search, the reading, and its attribution.
 */
export function CollectionScreen({
  collection,
  date,
  slot,
  today,
  localHour,
  reading,
  leapDay,
  reflectionId,
}: {
  collection: CollectionInfo;
  date: string;
  slot: Slot;
  today: string;
  localHour: number;
  reading: CollectionReading | null;
  leapDay: ReadingStub[] | null;
  reflectionId: string | null;
}) {
  const prev = previousReading(date, slot);
  const next = nextReading(date, slot);
  const isNow = date === today && slot === defaultSlot(localHour);
  const key = collection.key;

  return (
    <>
      <PageHeader
        eyebrow={collection.title}
        title={
          <>
            {formatDay(date, "weekday")}
            <span className="sr-only">, {SLOT_LABEL[slot]}</span>
          </>
        }
        description={date === today ? `Today's readings. ${collection.subtitle}` : collection.subtitle}
      />

      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedTrack label="Morning or evening reading">
            {SLOTS.map((s) => (
              <Link key={s} href={dayHref(key, date, s)} aria-current={s === slot ? "page" : undefined} className={segmentClass(s === slot)}>
                {SLOT_LABEL[s]}
              </Link>
            ))}
          </SegmentedTrack>
          <form action={collectionHref(key)} method="get" className="flex items-end gap-2">
            <label className="flex flex-col text-meta font-semibold text-text-secondary">
              <span className="mb-1 inline-flex items-center gap-1">
                <CalendarDays className="size-4" aria-hidden="true" /> Date
              </span>
              <input
                type="date"
                name="date"
                defaultValue={date}
                min="1900-01-01"
                max="2200-12-31"
                required
                className={cn(fieldControlClass, "w-auto border-border-strong")}
              />
            </label>
            <input type="hidden" name="slot" value={slot} />
            <Button type="submit" variant="secondary" size="md">
              Go
            </Button>
          </form>
        </div>

        <nav aria-label="Other readings" className="flex flex-wrap items-center justify-between gap-2">
          <Link href={dayHref(key, prev.date, prev.slot)} className={navLink}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span>
              <span className="sr-only">Previous reading: </span>
              {formatDay(prev.date, "short")} · {SLOT_LABEL[prev.slot]}
            </span>
          </Link>
          {!isNow ? (
            <Link href={collectionHref(key)} className={navLink}>
              Today
            </Link>
          ) : null}
          <Link href={dayHref(key, next.date, next.slot)} className={navLink}>
            <span>
              <span className="sr-only">Next reading: </span>
              {formatDay(next.date, "short")} · {SLOT_LABEL[next.slot]}
            </span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </nav>

        <form action={`${collectionHref(key)}/search`} method="get" role="search" className="flex gap-2">
          <label htmlFor="collection-q" className="sr-only">
            Search {collection.title}
          </label>
          <input
            id="collection-q"
            type="search"
            name="q"
            minLength={2}
            maxLength={100}
            required
            placeholder={`Search ${collection.title}`}
            className={cn(fieldControlClass, "min-w-0 flex-1 border-border-strong")}
          />
          <Button type="submit" variant="secondary" size="md" icon={<Search className="size-4" aria-hidden="true" />}>
            Search
          </Button>
        </form>
      </div>

      {leapDay?.length ? (
        <aside aria-label="Leap-day readings" className="mb-6 rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">
          <p>
            <span className="font-semibold">Leap-day readings.</span> {collection.title} has readings for February 29. {date.slice(0, 4)} has no
            February 29, so they&apos;re offered here beside today&apos;s; nothing has been added to the text.
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {leapDay.map((r) => (
              <li key={r.id}>
                <Link href={readingHref(key, r.id, date)} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                  {r.label}
                  {r.scripture_ref ? ` (${r.scripture_ref})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {reading ? (
        <ReadingView collection={collection} reading={reading} date={date} reflectionId={reflectionId} member />
      ) : (
        <EmptyState glyph="devotionals" title="No reading for this day">
          This collection has no {SLOT_LABEL[slot].toLowerCase()} reading for {formatDay(date, "long")}. Choose another day.
        </EmptyState>
      )}

      <CollectionAttribution collection={collection} />
    </>
  );
}
