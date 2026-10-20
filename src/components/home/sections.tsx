/* eslint-disable @next/next/no-img-element -- short-lived signed Storage URLs; dimensions vary per upload. */
import { MapPin, Pin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DateBlock } from "@/components/events/date-block";
import { EventListItem } from "@/components/events/event-list-item";
import { RsvpBadge } from "@/components/events/event-badges";
import { Icon } from "@/components/icons/icon";
import { markdownExcerpt } from "@/lib/announcements/markdown";
import type { AnnouncementWithImage } from "@/lib/announcements/queries";
import { formatWhen } from "@/lib/events/format";
import { rsvpState, type EventOccurrence } from "@/lib/events/types";
import { relativeDayLabel, type NextGathering } from "@/lib/home/next-gathering";
import { MEMBER_NAV } from "@/lib/navigation";
import type { ChurchSettings } from "@/lib/settings/queries";
import { WEEKDAY_LABEL } from "@/lib/settings/schema";
import { formatClockTime, formatDate } from "@/lib/time";

/** The first upcoming event, led by its date, with its cover image when one exists. */
export function FeaturedEvent({ o, coverUrl, now }: { o: EventOccurrence; coverUrl: string | null; now: Date }) {
  const canceled = o.status === "canceled";
  const place = o.location_name ?? (o.online_url ? "Online" : null);
  return (
    <Link
      href={`/events/${o.id}`}
      className="interactive group flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card) hover:bg-surface-muted/40 sm:flex-row"
    >
      {coverUrl ? (
        <img src={coverUrl} alt={o.cover_alt ?? ""} className="aspect-[16/9] w-full bg-surface-muted object-cover sm:aspect-auto sm:w-56 sm:shrink-0" loading="lazy" />
      ) : null}
      <div className="flex min-w-0 flex-1 gap-4 p-4">
        <DateBlock ymd={o.local_date} canceled={canceled} className="w-16 self-start" />
        <div className="min-w-0 flex-1">
          <p className={`font-display text-[1.25rem] font-semibold leading-snug ${canceled ? "text-text-secondary line-through" : "text-text"}`}>
            {canceled ? <span className="sr-only">Canceled: </span> : null}
            {o.title}
          </p>
          <p className="mt-0.5 text-meta text-text-secondary">{formatWhen(o)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-secondary">
            {place ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{place}</span>
              </span>
            ) : null}
            <RsvpBadge state={rsvpState(o, now)} position={o.my_position} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function UpcomingEventList({ events, coverUrl, now }: { events: EventOccurrence[]; coverUrl: string | null; now: Date }) {
  const [first, ...rest] = events;
  return (
    <div className="space-y-2">
      <FeaturedEvent o={first} coverUrl={coverUrl} now={now} />
      {rest.length ? (
        <ul className="space-y-2">
          {rest.map((o) => (
            <EventListItem key={o.id} o={o} now={now} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Latest announcement in an editorial layout, with up to two more as compact lines. */
export function AnnouncementDigest({ items, timeZone }: { items: AnnouncementWithImage[]; timeZone: string }) {
  const [lead, ...more] = items;
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card)">
      <article className="relative flex gap-4 p-4 sm:p-5">
        <span aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-meta text-text-secondary">
            {lead.pinned ? (
              <span className="inline-flex items-center gap-1 font-semibold text-primary">
                <Pin className="size-3.5" aria-hidden="true" /> Pinned
              </span>
            ) : null}
            {lead.publish_at ? <time dateTime={lead.publish_at}>{formatDate(lead.publish_at, timeZone)}</time> : null}
          </p>
          <h3 className="mt-1 font-display text-[1.25rem] font-semibold leading-snug">
            <Link href={`/announcements/${lead.id}`} className="after:absolute after:inset-0 hover:underline hover:decoration-1 hover:underline-offset-4">
              {lead.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-3 max-w-[62ch] text-text-secondary">{markdownExcerpt(lead.body, 200)}</p>
        </div>
        {lead.imageUrl ? (
          <img src={lead.imageUrl} alt={lead.image_alt ?? ""} className="hidden size-24 shrink-0 rounded-tile bg-surface-muted object-cover sm:block" loading="lazy" />
        ) : null}
      </article>
      {more.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {more.map((a) => (
            <li key={a.id}>
              <Link href={`/announcements/${a.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted/60 sm:px-5">
                <span className="min-w-0 flex-1 truncate font-semibold">{a.title}</span>
                {a.publish_at ? (
                  <time dateTime={a.publish_at} className="shrink-0 text-meta text-text-secondary">
                    {formatDate(a.publish_at, timeZone)}
                  </time>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Gathering times and place as a concise information panel. */
export function GatheringPanel({ settings, emptyAction }: { settings: ChurchSettings; emptyAction?: ReactNode }) {
  const { address } = settings;
  const place = [address.line1, [address.city, address.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="home-gatherings" className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <h2 id="home-gatherings" className="flex items-center gap-2 text-[1.125rem] font-semibold">
        <Icon name="events" className="size-5 text-text-secondary" />
        Gathering times
      </h2>
      {settings.gatheringTimes.length ? (
        <ul className="mt-3 divide-y divide-border">
          {settings.gatheringTimes.map((g, i) => (
            <li key={`${g.label}-${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block font-semibold">{g.label}</span>
                {g.location ? <span className="block text-meta text-text-secondary">{g.location}</span> : null}
              </span>
              <span className="shrink-0 text-right text-meta font-semibold tabular-nums">
                {WEEKDAY_LABEL[g.day].slice(0, 3)} · {formatClockTime(g.time)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-meta text-text-secondary">Gathering times will be posted soon.</p>
      )}
      {place ? (
        <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-3 text-meta text-text-secondary">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{place}</span>
        </p>
      ) : null}
      {!settings.gatheringTimes.length && emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
    </section>
  );
}

export function NextGatheringLine({ next }: { next: NextGathering | null }) {
  if (!next) return null;
  const g = next.gathering;
  return (
    <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface-muted/70 py-1 pl-1.5 pr-3 text-meta">
      <span className="rounded-full bg-cta px-2 py-0.5 text-[0.8125rem] font-semibold text-on-cta">Next</span>
      <span className="min-w-0 truncate">
        <span className="font-semibold">{g.label}</span>
        <span className="text-text-secondary">
          {" "}
          · {relativeDayLabel(next.inDays, g.day)} {formatClockTime(g.time)}
          {g.location ? ` · ${g.location}` : ""}
        </span>
      </span>
    </p>
  );
}

/**
 * Modules from later phases, listed honestly as not yet available. This is
 * also the integration point for Bible reading, devotional, and Sunday
 * lesson content: when a module ships, it replaces its entry here with a
 * real content card (and its nav item switches to "available").
 */
export function ComingLater() {
  const upcoming = MEMBER_NAV.filter((i) => i.status === "upcoming");
  if (!upcoming.length) return null;
  return (
    <section aria-labelledby="home-later" className="rounded-card border border-dashed border-border p-4 sm:p-5">
      <h2 id="home-later" className="text-[1.125rem] font-semibold">
        Coming later
      </h2>
      <p className="text-meta text-text-secondary">Not available yet. These will appear here when they open.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {upcoming.map((item) => (
          <li key={item.key} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-surface-muted px-3 text-meta font-semibold text-text-secondary">
            <Icon name={item.icon} className="size-5" />
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
