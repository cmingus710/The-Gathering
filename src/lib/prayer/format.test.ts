import { describe, expect, it } from "vitest";
import { audienceDescription, dateRange, decodeCursor, encodeCursor, formatDay, isNarrowing, pick, STATUS_FILTERS } from "./format";

describe("prayer format helpers", () => {
  it("matches the database's narrowing rule", () => {
    const church = { audience: "church" as const, groupId: null };
    const groupA = { audience: "group" as const, groupId: "a" };
    const groupB = { audience: "group" as const, groupId: "b" };
    const team = { audience: "team" as const, groupId: null };
    const draft = { audience: "private" as const, groupId: null };
    expect(isNarrowing(church, groupA)).toBe(true);
    expect(isNarrowing(church, team)).toBe(true);
    expect(isNarrowing(groupA, draft)).toBe(true);
    expect(isNarrowing(team, draft)).toBe(true);
    expect(isNarrowing(groupA, groupA)).toBe(true);
    // Everything else widens (or changes who can read) and needs confirmation.
    expect(isNarrowing(draft, church)).toBe(false);
    expect(isNarrowing(draft, team)).toBe(false);
    expect(isNarrowing(groupA, church)).toBe(false);
    expect(isNarrowing(groupA, groupB)).toBe(false);
    expect(isNarrowing(groupA, team)).toBe(false);
    expect(isNarrowing(team, church)).toBe(false);
    expect(isNarrowing(team, groupA)).toBe(false);
  });

  it("describes each audience plainly", () => {
    expect(audienceDescription("group", "Tuesday Group")).toContain("Tuesday Group");
    expect(audienceDescription("team")).toContain("not monitored around the clock");
    expect(audienceDescription("church")).toContain("never public");
  });

  it("round-trips cursors exactly and rejects anything else", () => {
    const card = { last_activity_at: "2026-10-20T11:48:00.123456+00:00", id: "0b5f2a6e-1c1d-4c55-9f00-6f1ad1b2c3d4" };
    expect(decodeCursor(encodeCursor(card))).toEqual({ before: card.last_activity_at, beforeId: card.id });
    expect(decodeCursor("2026-10-20T11:48:00Z~not-a-uuid")).toBeNull();
    expect(decodeCursor("'; drop table x;--")).toBeNull();
    expect(decodeCursor(["x"])).toBeNull();
  });

  it("formats date-only values without shifting the day", () => {
    expect(formatDay("2026-11-01")).toBe("Sun, Nov 1, 2026");
    expect(formatDay("nope")).toBeNull();
    expect(dateRange("2026-11-01", "2026-11-03")).toBe("Sun, Nov 1, 2026 – Tue, Nov 3, 2026");
    expect(dateRange("2026-11-01", "2026-11-01")).toBe("Sun, Nov 1, 2026");
    expect(dateRange(null, null)).toBeNull();
  });

  it("only accepts known filter values", () => {
    expect(pick("closed", STATUS_FILTERS, "active")).toBe("closed");
    expect(pick("evil", STATUS_FILTERS, "active")).toBe("active");
    expect(pick(undefined, STATUS_FILTERS, "active")).toBe("active");
  });
});
