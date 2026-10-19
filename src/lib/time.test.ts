import { describe, expect, it } from "vitest";
import { formatClockTime, isValidTimeZone, utcToZonedLocal, zonedLocalToUtc } from "./time";

const CHI = "America/Chicago";

describe("zonedLocalToUtc", () => {
  it("converts Central Daylight Time (UTC-5)", () => {
    expect(zonedLocalToUtc("2026-07-12T09:30", CHI)?.toISOString()).toBe("2026-07-12T14:30:00.000Z");
  });
  it("converts Central Standard Time (UTC-6)", () => {
    expect(zonedLocalToUtc("2026-12-06T09:30", CHI)?.toISOString()).toBe("2026-12-06T15:30:00.000Z");
  });
  it("handles the spring-forward gap by moving forward", () => {
    // 2027-03-14 02:30 does not exist in Chicago.
    const d = zonedLocalToUtc("2027-03-14T02:30", CHI)!;
    expect(d.toISOString()).toBe("2027-03-14T08:30:00.000Z");
  });
  it("resolves the repeated fall-back hour to the first occurrence", () => {
    // 2026-11-01 01:30 happens twice in Chicago (CDT then CST).
    expect(zonedLocalToUtc("2026-11-01T01:30", CHI)?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
  it("rejects malformed and impossible dates", () => {
    expect(zonedLocalToUtc("2026-02-30T10:00", CHI)).toBeNull();
    expect(zonedLocalToUtc("tomorrow", CHI)).toBeNull();
    expect(zonedLocalToUtc("2026-01-01T24:00", CHI)).toBeNull();
  });
  it("works for other zones", () => {
    expect(zonedLocalToUtc("2026-07-12T09:30", "UTC")?.toISOString()).toBe("2026-07-12T09:30:00.000Z");
    expect(zonedLocalToUtc("2026-07-12T09:30", "Asia/Kolkata")?.toISOString()).toBe("2026-07-12T04:00:00.000Z");
  });
});

describe("utcToZonedLocal", () => {
  it("round-trips through the church time zone", () => {
    for (const local of ["2026-07-12T09:30", "2026-12-06T18:05", "2026-11-01T03:00"]) {
      expect(utcToZonedLocal(zonedLocalToUtc(local, CHI), CHI)).toBe(local);
    }
  });
  it("returns an empty string for missing values", () => {
    expect(utcToZonedLocal(null, CHI)).toBe("");
  });
});

describe("misc", () => {
  it("validates IANA time zones", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
  it("formats clock times", () => {
    expect(formatClockTime("09:30")).toBe("9:30 AM");
    expect(formatClockTime("12:00")).toBe("12:00 PM");
    expect(formatClockTime("00:15")).toBe("12:15 AM");
    expect(formatClockTime("18:45")).toBe("6:45 PM");
  });
});

describe("formatAge and formatDayStamp", async () => {
  const { formatAge, formatDayStamp } = await import("./time");
  const now = new Date("2026-10-19T12:00:00Z");
  it("formats compact ages", () => {
    expect(formatAge("2026-10-19T11:59:30Z", now)).toBe("now");
    expect(formatAge("2026-10-19T11:15:00Z", now)).toBe("45m");
    expect(formatAge("2026-10-19T09:00:00Z", now)).toBe("3h");
    expect(formatAge("2026-10-17T12:00:00Z", now)).toBe("2d");
    expect(formatAge("2026-10-01T12:00:00Z", now, "America/Chicago")).toBe("Oct 1");
  });
  it("formats the day stamp in the church time zone", () => {
    expect(formatDayStamp(new Date("2026-10-19T03:00:00Z"), "America/Chicago")).toBe("18 OCT 2026");
  });
});
