import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine, googleCalendarUrl, occurrenceToIcs, occurrenceUid } from "./ics";
import type { EventOccurrence } from "./types";

const occ = (over: Partial<EventOccurrence> = {}): EventOccurrence => ({
  id: "6f1c2a8e-5b7d-4c9e-8f10-2a3b4c5d6e7f",
  series_id: "s1",
  occurrence_key: "2026-11-01",
  starts_at: "2026-11-01T15:00:00Z",
  ends_at: "2026-11-01T16:30:00Z",
  local_date: "2026-11-01",
  status: "scheduled",
  series_status: "published",
  title: "Synthetic Gathering; with, commas",
  description: "**Bring** a friend.\nLine two",
  cover_path: null,
  cover_alt: null,
  category: null,
  audience: "members",
  timezone: "America/Chicago",
  all_day: false,
  day_count: null,
  location_name: "Synthetic Hall",
  location_address: "1 Example St",
  online_url: null,
  organizer_name: "Synthetic Organizer",
  note: null,
  cancel_reason: null,
  cancellation_instructions: null,
  rsvp_enabled: true,
  waitlist_enabled: false,
  rsvp_closes_at: "2026-11-01T15:00:00Z",
  spots_left: null,
  recurring: false,
  sequence: 3,
  updated_at: "2026-10-20T10:00:00Z",
  my_status: null,
  my_position: null,
  ...over,
});

describe("ICS output", () => {
  it("escapes text values per RFC 5545", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(escapeText("x\r\ny\u0007")).toBe("x\\ny");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    for (const physical of folded.split("\r\n")) expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(line);
  });

  it("writes timed events in UTC with a stable UID, sequence, and modification time", () => {
    const ics = buildCalendar({ name: "Test", events: [occurrenceToIcs(occ(), "https://example.test", new Date("2026-10-21T00:00:00Z"))] });
    expect(ics).toContain(`UID:${occurrenceUid(occ().id)}`);
    expect(ics).toContain("DTSTART:20261101T150000Z");
    expect(ics).toContain("DTEND:20261101T163000Z");
    expect(ics).toContain("SEQUENCE:3");
    expect(ics).toContain("LAST-MODIFIED:20261020T100000Z");
    expect(ics).toContain("DTSTAMP:20261021T000000Z");
    expect(ics).toContain("SUMMARY:Synthetic Gathering\\; with\\, commas");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).not.toContain("Synthetic Organizer"); // no organizer/member contact details
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("writes all-day events as dates with an exclusive end", () => {
    const ics = buildCalendar({ name: "Test", events: [occurrenceToIcs(occ({ all_day: true, day_count: 2, local_date: "2026-11-07" }), "https://example.test")] });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261107");
    expect(ics).toContain("DTEND;VALUE=DATE:20261109");
  });

  it("marks cancellations so subscribed calendars update in place", () => {
    const ics = buildCalendar({ name: "Test", events: [occurrenceToIcs(occ({ status: "canceled", cancel_reason: "Synthetic storm" }), "https://example.test")] });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:Canceled: Synthetic Gathering");
    expect(ics).toContain("Synthetic storm");
  });

  it("builds a Google Calendar link with the event's time zone", () => {
    const url = new URL(googleCalendarUrl(occ(), "https://example.test"));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261101T150000Z/20261101T163000Z");
    expect(url.searchParams.get("ctz")).toBe("America/Chicago");
    expect(url.searchParams.get("location")).toBe("Synthetic Hall, 1 Example St");
  });
});
