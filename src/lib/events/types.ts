/** Shapes returned by the events_* database functions (see 20261021000300). */
export type OccurrenceStatus = "scheduled" | "canceled";
export type SeriesStatus = "draft" | "published" | "canceled" | "archived";
export type RegistrationStatus = "confirmed" | "waitlisted" | "canceled";
export type Audience = "public" | "members" | "group";

export type EventOccurrence = {
  id: string;
  series_id: string;
  occurrence_key: string;
  starts_at: string;
  ends_at: string;
  /** The occurrence's date in the event's own time zone (YYYY-MM-DD). */
  local_date: string;
  status: OccurrenceStatus;
  series_status: SeriesStatus;
  title: string;
  description: string;
  cover_path: string | null;
  cover_alt: string | null;
  /** Dedicated homepage banner (20261023000100); absent before that migration. */
  home_banner?: { path: string; alt: string; focus_x: number; focus_y: number } | null;
  category: { id: string; name: string } | null;
  audience: Audience;
  timezone: string;
  all_day: boolean;
  day_count: number | null;
  location_name: string | null;
  location_address: string | null;
  online_url: string | null;
  organizer_name: string | null;
  note: string | null;
  cancel_reason: string | null;
  cancellation_instructions: string | null;
  rsvp_enabled: boolean;
  waitlist_enabled: boolean;
  rsvp_closes_at: string;
  /** Places left when a capacity is set; null when unlimited. */
  spots_left: number | null;
  recurring: boolean;
  sequence: number;
  updated_at: string;
  my_status: RegistrationStatus | null;
  my_position: number | null;
  /** Group events: the group, for its members (event detail only). */
  group?: { id: string; name: string } | null;
  more?: Array<{ id: string; starts_at: string; ends_at: string; status: OccurrenceStatus }>;
};

export type Category = { id: string; name: string };

export type RsvpState =
  | "canceled"
  | "past"
  | "started"
  | "none"
  | "confirmed"
  | "waitlisted"
  | "closed"
  | "full"
  | "waitlist"
  | "open";

/** What a member can do about registration right now. */
export function rsvpState(o: Pick<EventOccurrence, "status" | "starts_at" | "ends_at" | "rsvp_enabled" | "rsvp_closes_at" | "spots_left" | "waitlist_enabled" | "my_status">, now = new Date()): RsvpState {
  if (o.status === "canceled") return "canceled";
  if (new Date(o.ends_at) <= now) return "past";
  if (o.my_status === "confirmed") return "confirmed";
  if (o.my_status === "waitlisted") return "waitlisted";
  if (new Date(o.starts_at) <= now) return "started";
  if (!o.rsvp_enabled) return "none";
  if (new Date(o.rsvp_closes_at) <= now) return "closed";
  if (o.spots_left === 0) return o.waitlist_enabled ? "waitlist" : "full";
  return "open";
}
