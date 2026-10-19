import { MapPin, Repeat, Video } from "lucide-react";
import Link from "next/link";
import { formatStartShort, formatWhen } from "@/lib/events/format";
import { rsvpState, type EventOccurrence } from "@/lib/events/types";
import { AudienceBadge, RsvpBadge } from "./event-badges";

/** One occurrence in a list or agenda. The whole card is one link. */
export function EventListItem({ o, showDate = true, now }: { o: EventOccurrence; showDate?: boolean; now: Date }) {
  const canceled = o.status === "canceled";
  const state = rsvpState(o, now);
  const place = o.location_name ?? (o.online_url ? "Online" : null);
  return (
    <li>
      <Link
        href={`/events/${o.id}`}
        className="flex gap-4 rounded-card bg-surface px-5 py-4 transition-colors hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div className="w-20 shrink-0 text-[0.95rem] font-semibold text-text-secondary">{formatStartShort(o)}</div>
        <div className="min-w-0 flex-1">
          <p className={`text-[1.05rem] font-semibold ${canceled ? "text-text-secondary line-through" : "text-text"}`}>
            {canceled ? <span className="sr-only">Canceled: </span> : null}
            {o.title}
          </p>
          {showDate ? <p className="text-[0.95rem] text-text-secondary">{formatWhen(o)}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.95rem] text-text-secondary">
            {place ? (
              <span className="inline-flex items-center gap-1">
                {o.location_name ? <MapPin className="size-4" aria-hidden="true" /> : <Video className="size-4" aria-hidden="true" />}
                {place}
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
