import { describe, expect, it } from "vitest";
import { addDays, diffDays, isLeapYear, isValidTimeZone, isValidYmd, personalDayDate, personalDayNumber, todayIn } from "./dates";

describe("reading plan dates", () => {
  it("validates calendar dates including leap years", () => {
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(isValidYmd("2027-02-29")).toBe(false);
    expect(isValidYmd("2100-02-29")).toBe(false); // not a leap year
    expect(isValidYmd("2000-02-29")).toBe(true);
    expect(isValidYmd("2027-13-01")).toBe(false);
    expect(isValidYmd("2027-1-1")).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
  });

  it("maps personal days to dates across month, leap day, and year ends", () => {
    expect(personalDayDate("2028-02-28", 2)).toBe("2028-02-29");
    expect(personalDayDate("2028-02-28", 3)).toBe("2028-03-01");
    expect(personalDayDate("2026-12-31", 2)).toBe("2027-01-01");
    expect(personalDayNumber("2027-01-01", "2027-12-31")).toBe(365);
    expect(personalDayNumber("2028-01-01", "2028-12-31")).toBe(366);
    expect(personalDayNumber("2027-01-05", "2027-01-01")).toBe(-3);
  });

  it("is unaffected by daylight-saving changes", () => {
    // US clocks spring forward 2027-03-14 and fall back 2027-11-07.
    expect(addDays("2027-03-13", 1)).toBe("2027-03-14");
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
    expect(diffDays("2027-11-06", "2027-11-08")).toBe(2);
  });

  it("takes today in the given time zone at boundaries", () => {
    const instant = new Date("2027-01-01T05:30:00Z"); // 23:30 Dec 31 in Chicago, 14:30 Jan 1 in Tokyo
    expect(todayIn("America/Chicago", instant)).toBe("2026-12-31");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2027-01-01");
    expect(todayIn("UTC", instant)).toBe("2027-01-01");
    // DST start in New York: 2027-03-14 06:59Z is 01:59 EST, 07:00Z is 03:00 EDT; still the same date.
    expect(todayIn("America/New_York", new Date("2027-03-14T06:59:00Z"))).toBe("2027-03-14");
    expect(todayIn("America/New_York", new Date("2027-03-14T07:00:00Z"))).toBe("2027-03-14");
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});
