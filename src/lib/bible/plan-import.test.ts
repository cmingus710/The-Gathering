import { describe, expect, it } from "vitest";
import { parsePlanCsv, planTemplate } from "./plan-import";

describe("parsePlanCsv", () => {
  it("accepts both templates as they are downloaded", () => {
    for (const mode of ["calendar", "personal"] as const) {
      const r = parsePlanCsv(planTemplate(mode), mode);
      expect(r.errors).toEqual([]);
      expect(r.rows).toHaveLength(7);
      expect(r.rows.find((x) => x.kind === "rest")?.passages).toEqual([]);
      expect(r.rows[0].labels).toEqual(["Genesis 1–2", "Psalm 1"]);
      expect(r.rows[0].questions).toHaveLength(2);
      expect(r.rows[3].labels).toEqual(["Genesis 3:1–15", "Genesis 3:20–24"]);
      expect(r.rows[6].labels).toEqual(["Matthew 5:1–12", "Matthew 5:43–48"]);
    }
  });

  it("maps dates and day numbers explicitly, never one as the other", () => {
    const wrong = parsePlanCsv("date,day,passages\n2027-01-01,1,John 1\n", "calendar");
    expect(wrong.errors.map((e) => e.message)).toEqual(["This plan uses dates; leave “day” empty."]);
    expect(parsePlanCsv("day,passages\n1,John 1\n", "calendar").errors[0].message).toMatch(/needs a “date” column/);
    expect(parsePlanCsv("date,passages\n01/03/2027,John 1\n", "calendar").errors[0].message).toMatch(/YYYY-MM-DD/);
    expect(parsePlanCsv("day,passages\n0,John 1\n", "personal").errors[0].message).toMatch(/from 1 to 2000/);
  });

  it("handles leap days", () => {
    expect(parsePlanCsv("date,passages\n2028-02-29,John 1\n", "calendar").errors).toEqual([]);
    expect(parsePlanCsv("date,passages\n2027-02-29,John 1\n", "calendar").errors[0].message).toMatch(/no February 29/);
  });

  it("reports duplicates, rest-day mistakes, and bad references by row", () => {
    const r = parsePlanCsv(
      ["day,type,passages", "1,,John 1", "1,,John 2", "2,rest,John 3", "3,,", "4,reading,Jo 3", "5,holiday,John 5"].join("\n"),
      "personal",
    );
    const by = (row: number) => r.errors.filter((e) => e.row === row).map((e) => e.message);
    expect(by(3)[0]).toMatch(/Day 1 is also on row 2/);
    expect(by(4)).toEqual(["A rest day has no passages."]);
    expect(by(5)[0]).toMatch(/set type to rest/);
    expect(by(6)[0]).toMatch(/isn't a book name/);
    expect(by(7)[0]).toMatch(/Type must be reading, rest, or catch_up/);
    expect(r.rows.map((x) => x.day_number)).toEqual([1]);
  });

  it("warns about gaps but not explicit rest days, and allows plans of any length", () => {
    const r = parsePlanCsv(["date,type,passages", "2027-01-01,,John 1", "2027-01-02,rest,", "2027-01-05,,John 2"].join("\n"), "calendar");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual(["No day between 2027-01-02 and 2027-01-05 (2 dates missing). Add rest days if that's intended."]);
    const p = parsePlanCsv(["day,passages", "2,John 1", "5,John 2"].join("\n"), "personal");
    expect(p.warnings.map((w) => w.message)).toEqual(["The plan starts at day 2, not day 1.", "Days 3–4 are missing. Add rest days if that's intended."]);
  });

  it("refuses broken files with a clear message", () => {
    expect(parsePlanCsv('day,passages\n1,"John 1\n', "personal").errors[0].message).toMatch(/isn't closed/);
    expect(parsePlanCsv("", "personal").errors[0].message).toMatch(/empty/);
    expect(parsePlanCsv("day,passages\n", "personal").errors[0].message).toMatch(/no days/);
  });
});
