import { describe, expect, it } from "vitest";
import { campaignDates, meterText } from "./campaigns";

describe("campaign display helpers", () => {
  it("describes progress for screen readers", () => {
    expect(meterText(125000, 500000)).toBe("$1,250 raised of $5,000 goal");
    expect(meterText(12345, 500000)).toBe("$123.45 raised of $5,000 goal");
    expect(meterText(0, 100)).toBe("$0 raised of $1 goal");
  });

  it("formats calendar dates without shifting the day", () => {
    expect(campaignDates("2026-11-01", "2026-12-31")).toBe("Nov 1, 2026 – Dec 31, 2026");
    expect(campaignDates(null, "2026-12-31")).toBe("Through Dec 31, 2026");
    expect(campaignDates("2026-11-01", null)).toBe("From Nov 1, 2026");
    expect(campaignDates(null, null)).toBeNull();
  });
});
