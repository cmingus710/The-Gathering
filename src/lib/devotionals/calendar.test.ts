import { describe, expect, it } from "vitest";
import { addDays, bodyBlocks, dateFitsReading, dateInYear, defaultSlot, isCalendarDate, isLeapYear, leapDayExtra, nextReading, previousReading } from "./calendar";

describe("collection calendar", () => {
  it("steps morning → evening → next morning, across the year boundary", () => {
    expect(nextReading("2026-12-31", "morning")).toEqual({ date: "2026-12-31", slot: "evening" });
    expect(nextReading("2026-12-31", "evening")).toEqual({ date: "2027-01-01", slot: "morning" });
    expect(previousReading("2027-01-01", "morning")).toEqual({ date: "2026-12-31", slot: "evening" });
    expect(previousReading("2027-01-01", "evening")).toEqual({ date: "2027-01-01", slot: "morning" });
  });

  it("handles leap years: February 29 exists in 2028, not in 2027", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(nextReading("2028-02-28", "evening")).toEqual({ date: "2028-02-29", slot: "morning" });
    expect(nextReading("2027-02-28", "evening")).toEqual({ date: "2027-03-01", slot: "morning" });
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("26-04-01")).toBe(false);
  });

  it("offers the February 29 readings beside February 28 only in common years", () => {
    expect(leapDayExtra("2027-02-28")).toBe(true);
    expect(leapDayExtra("2028-02-28")).toBe(false);
    expect(dateInYear(2027, 2, 29)).toBe("2027-02-28");
    expect(dateInYear(2028, 2, 29)).toBe("2028-02-29");
    expect(dateFitsReading("2027-02-28", 2, 29)).toBe(true);
    expect(dateFitsReading("2028-02-28", 2, 29)).toBe(false);
    expect(dateFitsReading("2028-02-29", 2, 29)).toBe(true);
    expect(dateFitsReading("2026-01-01", 1, 1)).toBe(true);
    expect(dateFitsReading("2026-01-02", 1, 1)).toBe(false);
  });

  it("does date arithmetic without time zones (daylight-saving days are ordinary days)", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01; dates are calendar dates.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("opens the evening reading from 5 p.m. local time", () => {
    expect(defaultSlot(0)).toBe("morning");
    expect(defaultSlot(16)).toBe("morning");
    expect(defaultSlot(17)).toBe("evening");
    expect(defaultSlot(23)).toBe("evening");
  });

  it("splits paragraphs and keeps hymn lines together", () => {
    expect(bodyBlocks("One.\n\n\"A line\nAnother\"\n\nThree.")).toEqual([
      { kind: "paragraph", text: "One." },
      { kind: "lines", lines: ['"A line', 'Another"'] },
      { kind: "paragraph", text: "Three." },
    ]);
  });
});
