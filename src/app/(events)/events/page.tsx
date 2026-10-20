import { CalendarDays, ChevronLeft, ChevronRight, List, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EventListItem } from "@/components/events/event-list-item";
import { MonthGrid } from "@/components/events/month-grid";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { getViewer } from "@/lib/auth/viewer";
import { addDays, formatDayLong, localDate } from "@/lib/events/format";
import { byLocalDay, getCategories, isMonth, listOccurrences, localRange, monthGrid, shiftMonth } from "@/lib/events/queries";
import type { EventOccurrence } from "@/lib/events/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Events" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Agenda({ days, byDay, now }: { days: string[]; byDay: Map<string, EventOccurrence[]>; now: Date }) {
  const withEvents = days.filter((d) => byDay.get(d)?.length);
  return (
    <div className="space-y-2">
      {withEvents.map((day) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          {/* Each card leads with its date block; the day heading keeps the list navigable by heading. */}
          <h2 id={`day-${day}`} className="sr-only">
            {formatDayLong(day)}
          </h2>
          <ul className="space-y-2">
            {byDay.get(day)!.map((o) => (
              <EventListItem key={`${o.id}-${day}`} o={o} showDate={false} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "list";
  const category = typeof sp.category === "string" && UUID.test(sp.category) ? sp.category : "";
  const [{ settings }, viewer, supabase] = await Promise.all([getChurchSettings(), getViewer(), requireClient()]);
  const tz = settings.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const month = typeof sp.month === "string" && isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const isMember = viewer.state === "signed-in" && viewer.viewer.status === "approved";
  const categories = await getCategories(supabase);

  const grid = monthGrid(month);
  const range = view === "month" ? localRange(grid.start, grid.end, tz) : { from: now, to: localRange(addDays(today, 120), addDays(today, 121), tz).from };
  const result = await listOccurrences(supabase, range.from, range.to, { category, limit: 500 });
  const items = result.ok ? result.data : [];
  const byDay = byLocalDay(items);
  const listDays = [...byDay.keys()].sort();
  const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00Z`));
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(category ? { category } : {}), ...extra });
    return `/events?${p.toString()}`;
  };

  return (
    <>
      <SectionHero art="events" glyph="events"
        title="Events"
        description={isMember ? "Gatherings, studies, and ways to serve. Register for events and add them to your calendar." : "Upcoming public events. Members can sign in to see members-only events and register."}
        actions={
          isMember ? (
            <ButtonLink href="/events/calendar" variant="secondary" icon={<Settings2 className="size-4" aria-hidden="true" />}>
              Calendar &amp; reminders
            </ButtonLink>
          ) : viewer.state !== "signed-in" ? (
            <ButtonLink href="/sign-in?next=/events" variant="secondary">
              Sign in
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <SegmentedTrack label="Calendar view">
          <Link href={qs({ view: "list" })} aria-current={view === "list" ? "page" : undefined} className={segmentClass(view === "list")}>
            <List className="size-4" aria-hidden="true" /> Upcoming
          </Link>
          <Link href={qs({ view: "month", month })} aria-current={view === "month" ? "page" : undefined} className={segmentClass(view === "month")}>
            <CalendarDays className="size-4" aria-hidden="true" /> Month
          </Link>
        </SegmentedTrack>
        <form method="get" action="/events" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={view} />
          {view === "month" ? <input type="hidden" name="month" value={month} /> : null}
          <label className="flex flex-col text-meta font-semibold">
            Category
            <select name="category" defaultValue={category} className="mt-1 min-h-11 rounded-control border border-border-strong bg-surface px-3">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses("secondary", "sm")}>
            Filter
          </button>
        </form>
      </div>

      {!result.ok ? (
        <Alert tone="error" title="Events couldn't be loaded right now.">
          Please try again in a moment.
        </Alert>
      ) : view === "month" ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link href={qs({ view: "month", month: shiftMonth(month, -1) })} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold hover:bg-surface-muted">
              <ChevronLeft className="size-5" aria-hidden="true" /> <span>Previous<span className="sr-only"> month</span></span>
            </Link>
            <h2 className="font-display text-xl font-semibold" aria-live="polite">
              {monthLabel}
            </h2>
            <Link href={qs({ view: "month", month: shiftMonth(month, 1) })} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold hover:bg-surface-muted">
              <span>Next<span className="sr-only"> month</span></span> <ChevronRight className="size-5" aria-hidden="true" />
            </Link>
          </div>
          <MonthGrid month={month} days={grid.days} byDay={byDay} today={today} />
          <div className="mt-6">
            <h2 className="sr-only">Events in {monthLabel}, by day</h2>
            {grid.days.some((d) => d.startsWith(month) && byDay.get(d)?.length) ? (
              <Agenda days={grid.days.filter((d) => d.startsWith(month))} byDay={byDay} now={now} />
            ) : (
              <EmptyState glyph="events" title={`No events in ${monthLabel}`}>
                {category ? "Try all categories, or another month." : "Try another month."}
              </EmptyState>
            )}
          </div>
        </>
      ) : listDays.length ? (
        <Agenda days={listDays.filter((d) => d >= today)} byDay={byDay} now={now} />
      ) : (
        <EmptyState glyph="events" title="No upcoming events">
          {category ? "Nothing in this category yet. Try all categories." : "New events will appear here."}
        </EmptyState>
      )}
    </>
  );
}
