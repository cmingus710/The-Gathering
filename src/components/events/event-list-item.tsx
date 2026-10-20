import { MapPin, Repeat, Video } from "lucide-react";
import Link from "next/link";
import { formatStartShort, formatWhen } from "@/lib/events/format";
import { rsvpState, type EventOccurrence } from "@/lib/events/types";
import { DateBlock } from "./date-block";
import { AudienceBadge, RsvpBadge } from "./event-badges";

/** One occurrence in a list or agenda: a date-led card. The whole card is one link. */
export function EventListItem({ o, showDate = true, now }: { o: EventOccurrence; showDate?: boolean; now: Date }) {
  const canceled = o.status === "canceled";
  const state = rsvpState(o, now);
  const place = o.location_name ?? (o.online_url ? "Online" : null);
  return (
    <li>
      <Link
        href={`/events/${o.id}`}
        className="interactive flex gap-3.5 rounded-card border border-border bg-surface p-3 pr-4 shadow-(--elev-card) hover:bg-surface-muted/50 sm:gap-4"
      >
        <DateBlock ymd={o.local_date} canceled={canceled} className="self-start" />
        <div className="min-w-0 flex-1 py-0.5">
          <p className={`text-title font-semibold ${canceled ? "text-text-secondary line-through" : "text-text"}`}>
            {canceled ? <span className="sr-only">Canceled: </span> : null}
            {o.title}
          </p>
          <p className="text-meta text-text-secondary">{showDate ? formatWhen(o) : formatStartShort(o)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-secondary">
            {place ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                {o.location_name ? <MapPin className="size-4 shrink-0" aria-hidden="true" /> : <Video className="size-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{place}</span>
              </span>
            ) : null}
            {o.recurring ? (
              <span className="inline-flex items-center gap-1">
                <Repeat className="size-4" aria-hidden="true" /> Repeats
              </span>
            ) : null}
            {o.category ? <span>{o.category.name}</span> : null}
            <AudienceBadge audience={o.audience} />
            <RsvpBadge state={state} position={o.my_position} />
          </div>
        </div>
      </Link>
    </li>
  );
}
