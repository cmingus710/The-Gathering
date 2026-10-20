import { describe, expect, it } from "vitest";
import { formatWhen, localDate } from "./format";
import { eventFormSchema, toSeriesPayload, validMeetingUrl, type EventFormInput } from "./schema";
import { rsvpState } from "./types";

const base: EventFormInput = {
  title: "Synthetic Supper",
  description: "",
  categoryId: "",
  audience: "members",
  timezone: "America/Chicago",
  allDay: false,
  startDate: "2026-11-01",
  startTime: "18:00",
  endDate: "",
  endTime: "19:30",
  locationName: "",
  locationAddress: "",
  onlineUrl: "",
  organizerName: "",
  rsvpEnabled: true,
  capacity: "20",
  waitlistEnabled: true,
  rsvpCloseHours: "24",
  cancellationInstructions: "",
  reminders: [1440],
  recurrence: "none",
  interval: "1",
  weekdays: [],
  coverAlt: "",
  hasCover: false,
} as unknown as EventFormInput;

describe("event form", () => {
  it("validates meeting links", () => {
    expect(validMeetingUrl("https://zoom.us/j/123?pwd=x")).toBe("https://zoom.us/j/123?pwd=x");
    for (const bad of ["http://zoom.us/j/1", "javascript:alert(1)", "https://user:pw@zoom.us/", "https://127.0.0.1/x", "https://localhost/x", "https://host:8443/x", "zoom.us"]) {
      expect(validMeetingUrl(bad)).toBeNull();
    }
  });

  it("produces the database payload for a single timed event", () => {
    const parsed = eventFormSchema.parse(base);
    expect(toSeriesPayload(parsed)).toMatchObject({
      start_time: "18:00",
      duration_minutes: 90,
      day_count: null,
      capacity: 20,
      waitlist_enabled: true,
      rsvp_close_minutes: 1440,
      recurrence: "none",
      until_date: null,
      weekdays: null,
    });
  });

  it("handles all-day, weekly, and monthly rules", () => {
    expect(toSeriesPayload(eventFormSchema.parse({ ...base, allDay: true, endDate: "2026-11-03" }))).toMatchObject({ day_count: 3, start_time: null, duration_minutes: null });
    const weekly = toSeriesPayload(eventFormSchema.parse({ ...base, recurrence: "weekly", weekdays: ["0", "3"], endMode: "count", occurrenceLimit: "10" } as unknown as EventFormInput));
    expect(weekly).toMatchObject({ recurrence: "weekly", weekdays: [0, 3], occurrence_limit: 10, until_date: null });
    const monthly = toSeriesPayload(eventFormSchema.parse({ ...base, recurrence: "monthly", monthlyMode: "ordinal", monthOrdinal: "-1", endMode: "until", untilDate: "2027-06-01" } as unknown as EventFormInput));
    expect(monthly).toMatchObject({ monthly_mode: "ordinal", month_ordinal: -1, until_date: "2027-06-01" });
  });

  it("rejects incomplete or unsafe input with field messages", () => {
    const result = eventFormSchema.safeParse({
      ...base,
      onlineUrl: "http://example.com",
      endTime: "17:00",
      waitlistEnabled: true,
      capacity: "",
      recurrence: "weekly",
      weekdays: [],
      hasCover: true,
    });
    expect(result.success).toBe(false);
    const fields = new Set(result.error!.issues.map((i) => i.path[0]));
    for (const f of ["onlineUrl", "endTime", "waitlistEnabled", "weekdays", "untilDate", "coverAlt"]) expect(fields).toContain(f);
  });
});

describe("event display", () => {
  it("shows times in the event's own zone with its abbreviation", () => {
    const when = formatWhen({ starts_at: "2026-11-01T15:00:00Z", ends_at: "2026-11-01T16:30:00Z", timezone: "America/Chicago", all_day: false, local_date: "2026-11-01", day_count: null });
    expect(when).toBe("Sunday, November 1, 2026 · 9:00 AM – 10:30 AM CST");
    expect(localDate("2026-11-01T03:00:00Z", "America/Chicago")).toBe("2026-10-31");
    expect(formatWhen({ starts_at: "", ends_at: "", timezone: "America/Chicago", all_day: true, local_date: "2026-11-07", day_count: 2 })).toBe(
      "Saturday, November 7, 2026 – Sunday, November 8, 2026 · All day",
    );
  });

  it("derives the registration state", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const o = { status: "scheduled" as const, starts_at: "2026-11-01T15:00:00Z", ends_at: "2026-11-01T16:00:00Z", rsvp_enabled: true, rsvp_closes_at: "2026-10-31T15:00:00Z", spots_left: 3, waitlist_enabled: false, my_status: null };
    expect(rsvpState(o, now)).toBe("open");
    expect(rsvpState({ ...o, spots_left: 0 }, now)).toBe("full");
    expect(rsvpState({ ...o, spots_left: 0, waitlist_enabled: true }, now)).toBe("waitlist");
    expect(rsvpState({ ...o, rsvp_closes_at: "2026-10-29T00:00:00Z" }, now)).toBe("closed");
    expect(rsvpState({ ...o, my_status: "waitlisted" }, now)).toBe("waitlisted");
    expect(rsvpState({ ...o, status: "canceled" }, now)).toBe("canceled");
    expect(rsvpState({ ...o, rsvp_enabled: false }, now)).toBe("none");
  });
});
