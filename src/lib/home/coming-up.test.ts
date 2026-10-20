import { describe, expect, it } from "vitest";
import type { EventOccurrence } from "@/lib/events/types";
import { zonedLocalToUtc } from "@/lib/time";
import { bannerCandidates, comingUpDate, nextComingUp, pickBanner } from "./coming-up";

/** Synthetic occurrence; local_date and times are given in the event's own zone, as the database returns them. */
function occ(over: Partial<EventOccurrence> & { local?: string; minutes?: number } = {}): EventOccurrence {
  const tz = over.timezone ?? "America/Chicago";
  const local = over.local ?? "2026-10-25T10:00";
  const starts = zonedLocalToUtc(local, tz)!;
  const ends = new Date(starts.getTime() + (over.minutes ?? 90) * 60_000);
  return {
    id: "o1",
    series_id: "s1",
    occurrence_key: local.slice(0, 10),
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    local_date: local.slice(0, 10),
    status: "scheduled",
    series_status: "published",
    title: "Synthetic Gathering",
    description: "",
    cover_path: null,
    cover_alt: null,
    home_banner: null,
    category: null,
    audience: "members",
    timezone: tz,
    all_day: false,
    day_count: null,
    location_name: null,
    location_address: null,
    online_url: null,
    organizer_name: null,
    note: null,
    cancel_reason: null,
    cancellation_instructions: null,
    rsvp_enabled: false,
    waitlist_enabled: false,
    rsvp_closes_at: starts.toISOString(),
    spots_left: null,
    recurring: false,
    sequence: 0,
    updated_at: starts.toISOString(),
    my_status: null,
    my_position: null,
    ...over,
  };
}

function allDay(localDate: string, days: number, tz = "America/Chicago", over: Partial<EventOccurrence> = {}): EventOccurrence {
  const starts = zonedLocalToUtc(`${localDate}T00:00`, tz)!;
  const end = new Date(`${localDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const ends = zonedLocalToUtc(`${end.toISOString().slice(0, 10)}T00:00`, tz)!;
  return occ({ timezone: tz, local: `${localDate}T00:00`, all_day: true, day_count: days, starts_at: starts.toISOString(), ends_at: ends.toISOString(), ...over });
}

describe("nextComingUp", () => {
  const now = new Date("2026-10-20T15:00:00Z"); // Tue 10:00 CDT

  it("returns null without events", () => {
    expect(nextComingUp([], now)).toBeNull();
  });

  it("skips canceled dates and timed events already under way", () => {
    const started = occ({ id: "started", local: "2026-10-20T09:30" });
    const canceled = occ({ id: "canceled", local: "2026-10-21T18:00", status: "canceled" });
    const next = occ({ id: "next", local: "2026-10-22T18:00" });
    expect(nextComingUp([started, canceled, next], now)?.id).toBe("next");
  });

  it("keeps an all-day or multi-day event until its last day ends", () => {
    const retreat = allDay("2026-10-18", 4, "America/Chicago", { id: "retreat" }); // Sun–Wed
    expect(nextComingUp([retreat], now)?.id).toBe("retreat");
    const over = allDay("2026-10-17", 3, "America/Chicago", { id: "over" }); // Sat–Mon, ended Tue 00:00
    expect(nextComingUp([over], now)).toBeNull();
  });
});

describe("comingUpDate", () => {
  it("uses the event's own time zone for the leaf and the time", () => {
    // 11:30 PM in Los Angeles is already the next day in UTC and in Chicago.
    const o = occ({ timezone: "America/Los_Angeles", local: "2026-10-24T23:30" });
    expect(new Date(o.starts_at).toISOString()).toBe("2026-10-25T06:30:00.000Z");
    expect(comingUpDate(o, new Date("2026-10-20T00:00:00Z"))).toMatchObject({ month: "OCT", day: 24, weekday: "SAT", time: "11:30 PM PDT", dateTime: "2026-10-24" });
  });

  it("handles an early-morning event in a zone ahead of UTC", () => {
    const o = occ({ timezone: "Pacific/Auckland", local: "2026-11-01T07:00" });
    expect(o.starts_at.slice(0, 10)).toBe("2026-10-31");
    expect(comingUpDate(o, new Date("2026-10-20T00:00:00Z"))).toMatchObject({ month: "NOV", day: 1, weekday: "SUN", time: "7:00 AM GMT+13" });
  });

  it("follows daylight-saving changes", () => {
    const before = occ({ local: "2026-10-25T10:00" });
    const after = occ({ local: "2026-11-08T10:00" });
    const now = new Date("2026-10-20T00:00:00Z");
    expect(comingUpDate(before, now).time).toBe("10:00 AM CDT");
    expect(comingUpDate(after, now).time).toBe("10:00 AM CST");
  });

  it("uses an individually moved date as given by the database", () => {
    const moved = { ...occ({ local: "2026-10-27T19:00" }), occurrence_key: "2026-10-25" };
    expect(comingUpDate(moved, new Date("2026-10-20T00:00:00Z"))).toMatchObject({ day: 27, weekday: "TUE" });
  });

  it("labels all-day and multi-day events", () => {
    const now = new Date("2026-10-20T15:00:00Z");
    expect(comingUpDate(allDay("2026-11-07", 1), now)).toMatchObject({ month: "NOV", day: 7, weekday: "SAT", time: "All day" });
    expect(comingUpDate(allDay("2026-11-06", 3), now).time).toBe("All day · through Sun, Nov 8");
    expect(comingUpDate(allDay("2026-10-18", 4), now)).toMatchObject({ day: 18, time: "Happening now · through Wed, Oct 21" });
    expect(comingUpDate(allDay("2026-10-20", 1), now).time).toBe("Today · All day");
  });

  it("notes a timed event that ends on a later day", () => {
    const o = occ({ local: "2026-10-30T18:00", minutes: 60 * 40 });
    expect(comingUpDate(o, new Date("2026-10-20T00:00:00Z")).time).toBe("6:00 PM CDT · through Sun, Nov 1");
  });

  it("crosses month and year ends", () => {
    expect(comingUpDate(occ({ local: "2026-12-31T19:00" }), new Date("2026-10-20T00:00:00Z"))).toMatchObject({ month: "DEC", day: 31, weekday: "THU" });
    expect(comingUpDate(allDay("2026-12-31", 2), new Date("2026-10-20T00:00:00Z")).time).toBe("All day · through Fri, Jan 1");
  });

  it("gives screen readers the full date", () => {
    expect(comingUpDate(occ({ local: "2026-10-25T10:00" }), new Date("2026-10-20T00:00:00Z")).spoken).toBe("Sunday, October 25, 2026 · 10:00 AM – 11:30 AM CDT");
  });
});

describe("banner fallback", () => {
  const def = { path: "home-default/synthetic.webp", alt: "Default", focus_x: 20, focus_y: 80 };
  const banner = { path: "home/s1/synthetic.webp", alt: "Banner", focus_x: 30, focus_y: 40 };

  it("orders event banner, cover, then the church default", () => {
    const c = bannerCandidates({ home_banner: banner, cover_path: "s1/cover.webp", cover_alt: "Cover" }, def);
    expect(c.map((x) => x.source)).toEqual(["event", "cover", "default"]);
    expect(c[0]).toMatchObject({ focusX: 30, focusY: 40, alt: "Banner" });
    expect(c[1]).toMatchObject({ focusX: 50, focusY: 50, alt: "Cover" });
  });

  it("skips what isn't configured and works before the banner migration", () => {
    expect(bannerCandidates({ cover_path: null, cover_alt: null }, null)).toEqual([]);
    expect(bannerCandidates({ cover_path: null, cover_alt: null }, def).map((x) => x.source)).toEqual(["default"]);
  });

  it("uses the first candidate that could be signed, else none", () => {
    const c = bannerCandidates({ home_banner: banner, cover_path: "s1/cover.webp", cover_alt: "Cover" }, def);
    expect(pickBanner(c, new Map([["s1/cover.webp", "https://signed/cover"]]))).toMatchObject({ source: "cover", url: "https://signed/cover" });
    expect(pickBanner(c, new Map())).toBeNull();
  });

  it("clamps out-of-range focal points", () => {
    const c = bannerCandidates({ home_banner: { ...banner, focus_x: 140, focus_y: -3 }, cover_path: null, cover_alt: null }, null);
    expect(c[0]).toMatchObject({ focusX: 100, focusY: 0 });
  });
});
