/* eslint-disable @next/next/no-img-element -- short-lived signed Storage URLs and the approved brand symbol; dimensions vary per upload. */
import { ChevronRight, MapPin, Pin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { markdownExcerpt } from "@/lib/announcements/markdown";
import type { AnnouncementWithImage } from "@/lib/announcements/queries";
import type { EventOccurrence } from "@/lib/events/types";
import type { ComingUpDate } from "@/lib/home/coming-up";
import { relativeDayLabel, type NextGathering } from "@/lib/home/next-gathering";
import type { ChurchSettings } from "@/lib/settings/queries";
import { WEEKDAY_LABEL } from "@/lib/settings/schema";
import { formatClockTime, formatDate } from "@/lib/time";

/** Serif section heading with the short gold rule from the approved home design. */
export function HomeSectionHeading({ id, children, action }: { id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="font-display text-[1.5rem] font-semibold leading-tight text-text sm:text-[1.625rem]">
        {children}
        <span aria-hidden="true" className="mt-1.5 block h-[3px] w-9 rounded-full bg-accent" />
      </h2>
      {action}
    </div>
  );
}

/**
 * Greeting banner: date line, greeting with the member's preferred name, a
 * short gold rule, and the approved symbol oversized at low opacity on the
 * right (the artwork itself is unchanged).
 */
export function GreetingBanner({
  dateLabel,
  dateTime,
  greeting,
  name,
  emblemSrc,
}: {
  dateLabel: string;
  dateTime: string;
  greeting: string;
  name: string;
  emblemSrc: string;
}) {
  const long = name.length > 14;
  return (
    <section aria-labelledby="home-welcome" className="home-hero relative isolate overflow-hidden rounded-[1.25rem] px-5 py-5 sm:px-8 sm:py-7">
      <img
        src={emblemSrc}
        alt=""
        aria-hidden="true"
        className="home-emblem pointer-events-none absolute -right-6 top-1/2 -z-10 h-[150%] w-auto max-w-none -translate-y-1/2 select-none sm:right-6 sm:h-[175%]"
        decoding="async"
      />
      <div className="max-w-[36rem]">
        <p className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-text-secondary">
          <time dateTime={dateTime}>{dateLabel}</time>
        </p>
        <h1
          id="home-welcome"
          className={`mt-1.5 font-display font-semibold leading-[1.12] text-text [overflow-wrap:anywhere] ${long ? "text-[1.625rem] sm:text-[2.125rem]" : "text-[1.875rem] sm:text-[2.5rem]"}`}
        >
          {greeting}, {name}
        </h1>
        <span aria-hidden="true" className="mt-3 block h-[3px] w-10 rounded-full bg-accent" />
      </div>
    </section>
  );
}

export type ComingUpImage = { url: string; alt: string; focusX: number; focusY: number };

/**
 * Image-led banner for the next event: cover photo (or the branded
 * background), a dark scrim, the calendar leaf built in HTML from the event's
 * own date, the title and time, and a round arrow. One link; the arrow is
 * decorative.
 */
export function ComingUpBanner({ o, date, image, emblemSrc }: { o: EventOccurrence; date: ComingUpDate; image: ComingUpImage | null; emblemSrc: string }) {
  const place = o.location_name ?? (o.online_url ? "Online" : null);
  return (
    <Link href={`/events/${o.id}`} className="coming-up group relative isolate flex min-h-[7.5rem] items-center overflow-hidden rounded-[1.25rem] shadow-(--elev-lift) sm:min-h-[9.5rem]">
      {image ? (
        <img
          src={image.url}
          alt={image.alt}
          className="coming-up-photo absolute inset-0 -z-20 size-full object-cover"
          style={{ objectPosition: `${image.focusX}% ${image.focusY}%` }}
          decoding="async"
        />
      ) : (
        <span aria-hidden="true" className="coming-up-branded absolute inset-0 -z-20">
          <img src={emblemSrc} alt="" className="absolute -right-4 top-1/2 h-[170%] w-auto max-w-none -translate-y-1/2 opacity-[0.12]" decoding="async" />
        </span>
      )}
      <span aria-hidden="true" className="coming-up-scrim absolute inset-0 -z-10" />
      <span className="flex w-full items-center gap-3.5 p-3.5 sm:gap-5 sm:p-5">
        <span aria-hidden="true" className="coming-up-leaf flex w-[4.25rem] shrink-0 flex-col items-center rounded-2xl pb-1.5 pt-2 leading-none sm:w-[4.75rem]">
          <span className="text-[0.75rem] font-bold tracking-[0.14em] text-[#dabf8c]">{date.month}</span>
          <span className="mt-1 text-[1.875rem] font-bold tabular-nums sm:text-[2.125rem]">{date.day}</span>
          <span className="mt-1 border-t border-[#c9aa72]/40 px-2 pt-1 text-[0.75rem] font-semibold tracking-[0.12em] text-[#f7f4ed]/80">{date.weekday}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-display text-[1.25rem] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[1.625rem]">{o.title}</span>
          <span className="mt-1 block truncate text-meta text-[#f7f4ed]/85">
            <time dateTime={date.dateTime}>{date.time}</time>
            {place ? <span> · {place}</span> : null}
          </span>
          <span className="sr-only">, {date.spoken}</span>
        </span>
        <span aria-hidden="true" className="coming-up-arrow flex size-11 shrink-0 items-center justify-center rounded-full">
          <ChevronRight className="size-5" />
        </span>
      </span>
    </Link>
  );
}

/** No upcoming event: a compact branded strip, with no invented date or time. */
export function ComingUpEmpty({ emblemSrc, action }: { emblemSrc: string; action?: ReactNode }) {
  return (
    <div className="coming-up coming-up-branded relative isolate flex items-center gap-4 overflow-hidden rounded-[1.25rem] px-4 py-4 sm:px-5">
      <img src={emblemSrc} alt="" aria-hidden="true" className="absolute -right-4 top-1/2 -z-10 h-[190%] w-auto max-w-none -translate-y-1/2 opacity-[0.1]" decoding="async" />
      <span aria-hidden="true" className="coming-up-leaf flex size-12 shrink-0 items-center justify-center rounded-2xl text-[#dabf8c]">
        <Icon name="events" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[1.125rem] font-semibold leading-snug">No upcoming events</p>
        <p className="text-meta text-[#f7f4ed]/80">New events will appear here.</p>
        {action ? <div className="mt-2.5">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * "Life at The Gathering": the latest announcement as an image-led card when
 * it has an image (text-led otherwise), plus up to two compact lines.
 */
export function LifeAtGathering({ items, timeZone }: { items: AnnouncementWithImage[]; timeZone: string }) {
  const [lead, ...more] = items;
  const meta = (a: AnnouncementWithImage, onImage = false) => (
    <p className={`flex flex-wrap items-center gap-x-2 text-meta ${onImage ? "text-[#f7f4ed]/85" : "text-text-secondary"}`}>
      {a.pinned ? (
        <span className={`inline-flex items-center gap-1 font-semibold ${onImage ? "text-[#dabf8c]" : "text-primary"}`}>
          <Pin className="size-3.5" aria-hidden="true" /> Pinned
        </span>
      ) : null}
      {a.publish_at ? <time dateTime={a.publish_at}>{formatDate(a.publish_at, timeZone)}</time> : null}
    </p>
  );
  return (
    <div className="space-y-2">
      {lead.imageUrl ? (
        <article className="interactive relative isolate overflow-hidden rounded-[1.25rem] border border-border bg-surface shadow-(--elev-card)">
          <div className="relative aspect-[16/8] w-full overflow-hidden bg-surface-muted sm:aspect-[16/7]">
            <img src={lead.imageUrl} alt={lead.image_alt ?? ""} className="size-full object-cover" loading="lazy" decoding="async" />
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#141210]/85 via-[#141210]/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-[#f7f4ed] sm:p-5">
              {meta(lead, true)}
              <h3 className="mt-0.5 line-clamp-2 font-display text-[1.25rem] font-semibold leading-snug sm:text-[1.375rem]">
                <Link href={`/announcements/${lead.id}`} className="after:absolute after:inset-0 hover:underline hover:decoration-1 hover:underline-offset-4">
                  {lead.title}
                </Link>
              </h3>
            </div>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <p className="line-clamp-2 text-text-secondary">{markdownExcerpt(lead.body, 180)}</p>
          </div>
        </article>
      ) : (
        <article className="interactive relative overflow-hidden rounded-[1.25rem] border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
          <span aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-accent" />
          {meta(lead)}
          <h3 className="mt-0.5 font-display text-[1.25rem] font-semibold leading-snug">
            <Link href={`/announcements/${lead.id}`} className="after:absolute after:inset-0 hover:underline hover:decoration-1 hover:underline-offset-4">
              {lead.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-2 max-w-[62ch] text-text-secondary">{markdownExcerpt(lead.body, 180)}</p>
        </article>
      )}
      {more.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-[1.25rem] border border-border bg-surface shadow-(--elev-card)">
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

/** Gathering times and place as a concise information panel, with the next one marked. */
export function GatheringPanel({ settings, next, emptyAction }: { settings: ChurchSettings; next: NextGathering | null; emptyAction?: ReactNode }) {
  const { address } = settings;
  const place = [address.line1, [address.city, address.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="home-gatherings" className="rounded-[1.25rem] border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <h2 id="home-gatherings" className="flex items-center gap-2 text-[1.125rem] font-semibold">
        <Icon name="events" className="size-5 text-text-secondary" />
        Gathering times
      </h2>
      {settings.gatheringTimes.length ? (
        <ul className="mt-3 divide-y divide-border">
          {settings.gatheringTimes.map((g, i) => {
            const isNext = next !== null && next.gathering === g;
            return (
              <li key={`${g.label}-${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {g.label}
                    {isNext && next ? <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-primary-soft px-2 py-0.5 text-[0.75rem] font-bold text-primary">Next · {relativeDayLabel(next.inDays, g.day)}</span> : null}
                  </span>
                  {g.location ? <span className="block text-meta text-text-secondary">{g.location}</span> : null}
                </span>
                <span className="shrink-0 text-right text-meta font-semibold tabular-nums">
                  {WEEKDAY_LABEL[g.day].slice(0, 3)} · {formatClockTime(g.time)}
                </span>
              </li>
            );
          })}
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

/** Chevron link beside a home heading (one per section, only when there is something to open). */
export function HeadingLink({ href, label, children }: { href: string; label: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="-mr-2 mb-1 inline-flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded-full px-2 text-meta font-semibold text-primary transition-colors hover:bg-primary-soft hover:text-primary-hover"
    >
      {children}
      <ChevronRight className="size-5" aria-hidden="true" />
    </Link>
  );
}
