import { describe, expect, it } from "vitest";
import { firstWeeklyDate, scheduleHints } from "./schedule-hints";

const sunday = { recurrence: "weekly", interval: "1", startDate: "2026-10-25", weekdays: [0] };

describe("firstWeeklyDate", () => {
  it("matches the generator's week counting", () => {
    expect(firstWeeklyDate("2026-10-25", 1, [0])).toBe("2026-10-25");
    expect(firstWeeklyDate("2026-10-26", 1, [0])).toBe("2026-11-01");
    // Every 12 weeks from the week of Oct 25: the next Sunday used is Jan 17.
    expect(firstWeeklyDate("2026-10-26", 12, [0])).toBe("2027-01-17");
  });
});

describe("scheduleHints", () => {
  it("is quiet for an ordinary weekly series and for one-off events", () => {
    expect(scheduleHints(sunday)).toEqual([]);
    expect(scheduleHints({ ...sunday, recurrence: "none", interval: "12", startDate: "2026-10-26" })).toEqual([]);
    expect(scheduleHints({ ...sunday, interval: "2" })).toEqual([]);
    expect(scheduleHints({ ...sunday, recurrence: "monthly", interval: "6", startDate: "2026-10-26" })).toEqual([]);
  });

  it("flags an unusually large interval", () => {
    expect(scheduleHints({ ...sunday, interval: "12" })).toEqual(["This repeats only once every 12 weeks. For an event every week, enter 1."]);
    expect(scheduleHints({ ...sunday, recurrence: "daily", interval: "5" })[0]).toMatch(/every 5 days/);
    expect(scheduleHints({ ...sunday, recurrence: "monthly", interval: "12" })[0]).toMatch(/every 12 months/);
  });

  it("flags a first date that isn't one of the chosen weekdays", () => {
    expect(scheduleHints({ ...sunday, startDate: "2026-10-26" })).toEqual([
      "The first date is a Monday, which isn't one of the chosen days, so the event first happens on Sunday, November 1. To start on Sunday, October 25, change the first date to that day.",
    ]);
  });

  it("reports both problems together", () => {
    const hints = scheduleHints({ ...sunday, interval: "12", startDate: "2026-10-26" });
    expect(hints).toHaveLength(2);
    expect(hints[1]).toMatch(/first happens on Sunday, January 17/);
  });
});
