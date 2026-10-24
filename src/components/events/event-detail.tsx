import { CalendarClock, MapPin, Repeat, User, Video } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { formatDeadline, formatWhen, localDate } from "@/lib/events/format";
import type { EventOccurrence } from "@/lib/events/types";
import { AudienceBadge } from "./event-badges";

/**
 * Event detail body, shared by the member page and the admin preview. The
 * registration panel and calendar actions are passed in as `aside`.
 */
export function EventDetail({ o, coverUrl, aside, moreHref = (id: string) => `/events/${id}` }: { o: EventOccurrence; coverUrl?: string | null; aside?: ReactNode; moreHref?: (id: string) => string }) {
  const canceled = o.status === "canceled";
  const mapQuery = [o.location_name, o.location_address].filter(Boolean).join(", ");
  return (
    <article className="space-y-6">
      {canceled ? (
        <Alert tone="error" title="This event has been canceled.">
          {o.cancel_reason ? <p>{o.cancel_reason}</p> : null}
        </Alert>
      ) : null}
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; keep it out of the image cache
        <img src={coverUrl} alt={o.cover_alt ?? ""} className="aspect-[16/9] w-full rounded-card object-cover" />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <p className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-semibold">{formatWhen(o)}</span>
                {!o.all_day ? <span className="block text-meta text-text-secondary">Times are shown in the event&apos;s time zone ({o.timezone.replace(/_/g, " ")}).</span> : null}
              </span>
            </p>
            {o.location_name || o.location_address ? (
              <p className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  {o.location_name ? <span className="block font-semibold">{o.location_name}</span> : null}
                  {o.location_address ? <span className="block text-text-secondary">{o.location_address}</span> : null}
                  {mapQuery ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-meta font-semibold text-primary underline underline-offset-2"
                    >
                      Open in Maps<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </span>
              </p>
            ) : null}
            {o.online_url ? (
              <p className="flex items-start gap-3">
                <Video className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <a href={o.online_url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 font-semibold text-primary underline underline-offset-2">
                  Join online<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            ) : null}
            {o.organizer_name ? (
              <p className="flex items-start gap-3">
                <User className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">Organized by {o.organizer_name}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {o.category ? <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-sm font-bold">{o.category.name}</span> : null}
              <AudienceBadge audience={o.audience} />
              {o.group ? (
                <Link href={`/groups/${o.group.id}`} className="inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline">
                  {o.group.name}
                </Link>
              ) : null}
              {o.recurring ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-sm font-bold">
                  <Repeat className="size-3.5" aria-hidden="true" /> Repeats
                </span>
              ) : null}
            </div>
          </Card>
          {o.note ? <Alert tone="info" title="About this date">{o.note}</Alert> : null}
          {o.description ? (
            <Card>
              <MarkdownBody source={o.description} />
            </Card>
          ) : null}
          {o.rsvp_enabled && o.cancellation_instructions ? (
            <Card>
              <h2 className="mb-1 font-bold">If your plans change</h2>
              <p className="text-text-secondary">{o.cancellation_instructions}</p>
            </Card>
          ) : null}
          {o.more?.length ? (
            <Card>
              <h2 className="mb-2 font-bold">Other dates</h2>
              <ul className="space-y-1">
                {o.more.map((m) => (
                  <li key={m.id}>
                    <Link href={moreHref(m.id)} className="font-semibold text-primary underline underline-offset-2">
                      {formatWhen({ ...o, starts_at: m.starts_at, ends_at: m.ends_at, local_date: localDate(m.starts_at, o.timezone) })}
                    </Link>
                    {m.status === "canceled" ? <span className="ml-2 text-text-secondary">(canceled)</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <aside className="space-y-4" aria-label="Registration and calendar">
          {o.rsvp_enabled && !canceled ? (
            <p className="text-meta text-text-secondary">Registration closes {formatDeadline(o.rsvp_closes_at, o.timezone)}.</p>
          ) : null}
          {aside}
        </aside>
      </div>
    </article>
  );
}
