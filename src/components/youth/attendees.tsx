import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { CONSENT_STATE, REGISTRATION_STATUS, formatWhen } from "@/lib/youth/format";
import type { FormStateRow } from "@/lib/youth/types";
import { StateBadge } from "./state-badge";
import { YouthForm } from "./youth-form";

export type YouthEventAdmin = {
  series_id: string;
  title: string;
  status: string;
  audience: string;
  timezone: string;
  rsvp_enabled: boolean;
  capacity: number | null;
  waitlist_enabled: boolean;
  can_configure: boolean;
  settings: {
    group_id: string;
    group: string;
    youth_rsvp: boolean;
    collect_emergency_contact: boolean;
    collect_pickup: boolean;
    collect_accommodation: boolean;
  } | null;
  forms: Array<{ form_id: string; title: string; version: number | null }>;
  personnel: Array<{ profile_id: string; name: string }>;
  i_am_personnel: boolean;
  occurrences: Array<{
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    confirmed: number;
    waitlisted: number;
    attendees: Array<{ child_id: string; display_name: string; status: string; source: string; forms: FormStateRow[]; consent_ok: boolean; logistics_on_file: boolean }>;
  }>;
};

/** Attendee lists with consent status (who needs renewed consent), never logistics values. */
export function Attendees({ event }: { event: YouthEventAdmin }) {
  if (event.occurrences.length === 0) return <EmptyState glyph="events" title="No upcoming dates" />;
  return (
    <div className="space-y-6">
      {event.occurrences.map((o) => (
        <section key={o.id} aria-labelledby={`o-${o.id}`}>
          <SectionHeading
            id={`o-${o.id}`}
            description={`${o.confirmed} registered${event.capacity ? ` of ${event.capacity}` : ""}${o.waitlisted ? ` · ${o.waitlisted} waiting` : ""}`}
            action={event.can_configure && event.capacity && o.waitlisted > 0 ? <YouthForm op="event_fill" hidden={{ occurrence: o.id }} submit="Fill open places" size="sm" variant="secondary" inline /> : undefined}
          >
            {formatWhen(o.starts_at, event.timezone)}
            {o.status === "canceled" ? " (canceled)" : ""}
          </SectionHeading>
          {o.attendees.length === 0 ? (
            <p className="text-meta text-text-secondary">No registrations yet.</p>
          ) : (
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-border">
                {o.attendees.map((a) => (
                  <li key={a.child_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="font-semibold">{a.display_name}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StateBadge map={REGISTRATION_STATUS} value={a.status} />
                      {a.forms.map((f) => (
                        <span key={f.form_id} className="inline-flex items-center gap-1">
                          <span className="sr-only">{f.title}:</span>
                          <StateBadge map={CONSENT_STATE} value={f.state} />
                        </span>
                      ))}
                      {event.settings && (event.settings.collect_emergency_contact || event.settings.collect_pickup || event.settings.collect_accommodation) ? (
                        <Badge tone={a.logistics_on_file ? "success" : "warning"}>{a.logistics_on_file ? "Details on file" : "No event details yet"}</Badge>
                      ) : null}
                      {a.source === "youth" ? <Badge tone="info">Registered themselves</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}
