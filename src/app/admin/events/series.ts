import { addDays } from "@/lib/events/format";
import type { SeriesStatus } from "@/lib/events/types";
import type { EventFormValues } from "./event-form";

/** Row shape returned by events_admin_get. */
export type AdminSeries = {
  id: string;
  title: string;
  description: string;
  cover_path: string | null;
  cover_alt: string | null;
  /** Homepage banner (absent before migration 20261023000100). */
  home_banner_path?: string | null;
  home_banner_alt?: string | null;
  home_banner_focus_x?: number;
  home_banner_focus_y?: number;
  category_id: string | null;
  audience: "public" | "members" | "group";
  group_id: string | null;
  timezone: string;
  all_day: boolean;
  start_date: string;
  start_time: string | null;
  duration_minutes: number | null;
  day_count: number | null;
  location_name: string | null;
  location_address: string | null;
  online_url: string | null;
  organizer_name: string | null;
  rsvp_enabled: boolean;
  capacity: number | null;
  waitlist_enabled: boolean;
  rsvp_close_minutes: number | null;
  cancellation_instructions: string | null;
  reminder_minutes: number[];
  recurrence: "none" | "daily" | "weekly" | "monthly";
  interval_count: number;
  weekdays: number[] | null;
  monthly_mode: "day" | "ordinal" | null;
  month_ordinal: number | null;
  until_date: string | null;
  occurrence_limit: number | null;
  status: SeriesStatus;
  publish_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  updated_at: string;
  occurrences: Array<{
    id: string;
    occurrence_key: string;
    starts_at: string;
    ends_at: string;
    status: "scheduled" | "canceled";
    detached: boolean;
    orphaned: boolean;
    note: string | null;
    cancel_reason: string | null;
    confirmed: number;
    waitlisted: number;
  }>;
};

/** End date and time from the stored start and length (wall-clock arithmetic). */
function endOf(date: string, time: string, minutes: number) {
  const t = Date.parse(`${date}T${time}:00Z`) + minutes * 60000;
  const iso = new Date(t).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function seriesToForm(s: AdminSeries, coverUrl: string | null): EventFormValues {
  const startTime = s.start_time?.slice(0, 5) ?? "";
  const end = !s.all_day && startTime && s.duration_minutes ? endOf(s.start_date, startTime, s.duration_minutes) : null;
  const lastDay = s.all_day ? addDays(s.start_date, (s.day_count ?? 1) - 1) : "";
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    categoryId: s.category_id ?? "",
    audience: s.audience,
    groupId: s.group_id ?? "",
    timezone: s.timezone,
    allDay: s.all_day,
    startDate: s.start_date,
    startTime,
    endDate: s.all_day ? (lastDay === s.start_date ? "" : lastDay) : end && end.date !== s.start_date ? end.date : "",
    endTime: end?.time ?? "",
    locationName: s.location_name ?? "",
    locationAddress: s.location_address ?? "",
    onlineUrl: s.online_url ?? "",
    organizerName: s.organizer_name ?? "",
    rsvpEnabled: s.rsvp_enabled,
    capacity: s.capacity?.toString() ?? "",
    waitlistEnabled: s.waitlist_enabled,
    rsvpCloseHours: s.rsvp_close_minutes ? String(Math.round(s.rsvp_close_minutes / 60)) : "",
    cancellationInstructions: s.cancellation_instructions ?? "",
    reminders: s.reminder_minutes ?? [],
    recurrence: s.recurrence,
    interval: String(s.interval_count ?? 1),
    weekdays: s.weekdays ?? [],
    monthlyMode: s.monthly_mode ?? "day",
    monthOrdinal: s.month_ordinal?.toString() ?? "1",
    endMode: s.occurrence_limit ? "count" : "until",
    untilDate: s.until_date ?? "",
    occurrenceLimit: s.occurrence_limit?.toString() ?? "",
    coverAlt: s.cover_alt ?? "",
    coverUrl,
  };
}

export function allTimeZones(current: string[]): string[] {
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...current, ...list])].sort();
}
