import { describe, expect, it } from "vitest";
import { dayGroup, groupByDay, localDate, panelTime } from "./notification-time";

const CHI = "America/Chicago";

describe("bell panel day grouping", () => {
  it("turns over at the member's local midnight, not UTC", () => {
    // 00:30 on Oct 21 in Chicago (CDT, UTC-5) = 05:30 UTC.
    const now = Date.parse("2026-10-21T05:30:00Z");
    expect(dayGroup("2026-10-21T05:01:00Z", CHI, now)).toBe("today"); // 00:01 local
    expect(dayGroup("2026-10-21T04:59:00Z", CHI, now)).toBe("yesterday"); // 23:59 Oct 20 local
    expect(dayGroup("2026-10-20T05:00:00Z", CHI, now)).toBe("yesterday"); // 00:00 Oct 20 local
    expect(dayGroup("2026-10-20T04:59:00Z", CHI, now)).toBe("earlier"); // 23:59 Oct 19 local
    // In UTC the same instants group differently.
    expect(dayGroup("2026-10-21T04:59:00Z", "UTC", now)).toBe("today");
  });

  it("handles the daylight-saving change (25-hour day)", () => {
    // DST ends 2026-11-01 02:00 CDT in Chicago. 'now' is Nov 2 00:30 CST = 06:30 UTC.
    const now = Date.parse("2026-11-02T06:30:00Z");
    expect(dayGroup("2026-11-01T05:00:00Z", CHI, now)).toBe("yesterday"); // Nov 1 00:00 CDT
    expect(dayGroup("2026-11-01T04:59:00Z", CHI, now)).toBe("earlier"); // Oct 31 23:59 CDT
    expect(localDate(Date.parse("2026-11-02T05:59:00Z"), CHI)).toBe("2026-11-01"); // 23:59 CST
  });

  it("falls back to UTC for an unknown zone and counts future times as today", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(dayGroup("2026-10-21T00:10:00Z", "Not/AZone", now)).toBe("today");
    expect(dayGroup("2026-10-21T12:05:00Z", CHI, now)).toBe("today");
  });

  it("groups a newest-first list without reordering", () => {
    const now = Date.parse("2026-10-21T18:00:00Z");
    const items = ["2026-10-21T17:00:00Z", "2026-10-21T06:00:00Z", "2026-10-20T15:00:00Z", "2026-10-02T15:00:00Z"].map((created_at) => ({ created_at }));
    expect(groupByDay(items, CHI, now).map((g) => [g.group, g.items.length])).toEqual([
      ["today", 2],
      ["yesterday", 1],
      ["earlier", 1],
    ]);
  });
});

describe("bell panel times", () => {
  const now = Date.parse("2026-10-21T18:00:00Z");
  it("is relative within a day and a local date after", () => {
    expect(panelTime("2026-10-21T17:59:40Z", CHI, now)).toBe("Just now");
    expect(panelTime("2026-10-21T17:55:00Z", CHI, now)).toBe("5m ago");
    expect(panelTime("2026-10-20T21:00:00Z", CHI, now)).toBe("21h ago");
    expect(panelTime("2026-10-13T03:00:00Z", CHI, now)).toBe("Oct 12"); // 22:00 local on the 12th
    expect(panelTime("2025-12-30T18:00:00Z", CHI, now)).toBe("Dec 30, 2025");
  });
});
