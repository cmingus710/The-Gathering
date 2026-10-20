import { describe, expect, it } from "vitest";
import type { GatheringTime } from "@/lib/settings/schema";
import { nextGathering, relativeDayLabel } from "./next-gathering";

const tz = "America/Chicago";
const sunday: GatheringTime = { label: "Sunday Gathering", day: "sunday", time: "10:30", location: null };
const wednesday: GatheringTime = { label: "Midweek", day: "wednesday", time: "19:00", location: null };

describe("nextGathering", () => {
  it("returns null without configured times", () => {
    expect(nextGathering([], new Date(), tz)).toBeNull();
  });

  it("picks the soonest upcoming gathering in the church time zone", () => {
    // Monday 2026-10-19 20:00 CDT (01:00Z Tuesday).
    const now = new Date("2026-10-20T01:00:00Z");
    expect(nextGathering([sunday, wednesday], now, tz)).toEqual({ gathering: wednesday, inDays: 2 });
  });

  it("counts later today as today and an already-started gathering as next week", () => {
    const sundayMorning = new Date("2026-10-18T14:00:00Z"); // 09:00 CDT Sunday
    expect(nextGathering([sunday], sundayMorning, tz)).toEqual({ gathering: sunday, inDays: 0 });
    const sundayNoon = new Date("2026-10-18T17:00:00Z"); // 12:00 CDT Sunday
    expect(nextGathering([sunday], sundayNoon, tz)).toEqual({ gathering: sunday, inDays: 7 });
  });

  it("labels relative days", () => {
    expect(relativeDayLabel(0, "sunday")).toBe("Today");
    expect(relativeDayLabel(1, "monday")).toBe("Tomorrow");
    expect(relativeDayLabel(3, "thursday")).toBe("Thursday");
  });
});
