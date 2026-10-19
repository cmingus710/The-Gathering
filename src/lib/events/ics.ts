import { addDays } from "./format";
import type { EventOccurrence } from "./types";

/**
 * iCalendar (RFC 5545) output for downloads and subscription feeds.
 *
 * - Each occurrence is its own VEVENT with a stable UID (the occurrence id),
 *   so recurrence is always expanded and bounded by the caller; no RRULE is
 *   emitted. Updates replace the event in place (higher SEQUENCE, newer
 *   LAST-MODIFIED); cancellations are STATUS:CANCELLED.
 * - Timed events use UTC instants (unambiguous across daylight-saving
 *   changes); all-day events use VALUE=DATE with an exclusive end date.
 * - Text is escaped and lines are folded at 75 octets without splitting
 *   UTF-8 characters.
 * - No attendee lists, organizer contact details, or member data are included.
 */

export type IcsEvent = {
  uid: string;
  sequence: number;
  stamp: Date;
  lastModified: Date;
  status: "CONFIRMED" | "CANCELLED";
  summary: string;
  description?: string;
  location?: string;
  url?: string;
} & ({ allDay: false; start: Date; end: Date } | { allDay: true; startDate: string; endDate: string });

const encoder = new TextEncoder();

export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds one content line to 75 octets per physical line. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function formatUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const formatDate = (ymd: string) => ymd.replace(/-/g, "");

export function buildCalendar(opts: { name: string; events: IcsEvent[]; refreshMinutes?: number }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Gathering//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
  ];
  if (opts.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${opts.refreshMinutes}M`);
  }
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${formatUtc(e.stamp)}`, `LAST-MODIFIED:${formatUtc(e.lastModified)}`, `SEQUENCE:${e.sequence}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDate(e.startDate)}`, `DTEND;VALUE=DATE:${formatDate(e.endDate)}`);
    } else {
      lines.push(`DTSTART:${formatUtc(e.start)}`, `DTEND:${formatUtc(e.end)}`);
    }
    lines.push(`STATUS:${e.status}`, `SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Plain text from the markdown subset used for descriptions. */
export function plainText(markdown: string, max = 1500): string {
  const text = markdown
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/[*_`#>]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function eventPlace(o: Pick<EventOccurrence, "location_name" | "location_address" | "online_url">): string | undefined {
  const physical = [o.location_name, o.location_address].filter(Boolean).join(", ");
  return physical || o.online_url || undefined;
}

export function occurrenceUid(id: string): string {
  return `occurrence-${id}@gathering.church`;
}

export function occurrenceToIcs(o: EventOccurrence, siteUrl: string, stamp = new Date()): IcsEvent {
  const url = `${siteUrl}/events/${o.id}`;
  const canceled = o.status === "canceled";
  const parts = [
    canceled ? `Canceled${o.cancel_reason ? `: ${o.cancel_reason}` : "."}` : "",
    o.note ?? "",
    plainText(o.description),
    o.online_url ? `Join online: ${o.online_url}` : "",
    `Details: ${url}`,
  ].filter(Boolean);
  const base = {
    uid: occurrenceUid(o.id),
    sequence: o.sequence,
    stamp,
    lastModified: new Date(o.updated_at),
    status: canceled ? ("CANCELLED" as const) : ("CONFIRMED" as const),
    summary: canceled ? `Canceled: ${o.title}` : o.title,
    description: parts.join("\n\n"),
    location: eventPlace(o),
    url,
  };
  if (o.all_day) {
    return { ...base, allDay: true, startDate: o.local_date, endDate: addDays(o.local_date, o.day_count ?? 1) };
  }
  return { ...base, allDay: false, start: new Date(o.starts_at), end: new Date(o.ends_at) };
}

/** "Add to Google Calendar" link (a snapshot, like a download). */
export function googleCalendarUrl(o: EventOccurrence, siteUrl: string): string {
  const dates = o.all_day
    ? `${formatDate(o.local_date)}/${formatDate(addDays(o.local_date, o.day_count ?? 1))}`
    : `${formatUtc(new Date(o.starts_at))}/${formatUtc(new Date(o.ends_at))}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: o.title,
    dates,
    details: `${plainText(o.description, 600)}\n\nDetails: ${siteUrl}/events/${o.id}`.trim(),
    ctz: o.timezone,
  });
  const place = eventPlace(o);
  if (place) params.set("location", place);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export const ICS_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex",
} as const;
