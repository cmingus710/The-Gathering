import { describe, expect, it } from "vitest";
import { effectiveStatus } from "./status";

const now = new Date("2026-10-18T15:00:00Z");
const before = "2026-10-18T14:00:00Z";
const after = "2026-10-18T16:00:00Z";

describe("effectiveStatus", () => {
  it.each([
    [{ status: "draft", publish_at: null, expires_at: null }, "draft"],
    [{ status: "archived", publish_at: before, expires_at: null }, "archived"],
    [{ status: "scheduled", publish_at: after, expires_at: null }, "scheduled"],
    [{ status: "scheduled", publish_at: before, expires_at: null }, "live"],
    [{ status: "published", publish_at: before, expires_at: after }, "live"],
    [{ status: "published", publish_at: before, expires_at: before }, "expired"],
    [{ status: "published", publish_at: after, expires_at: null }, "scheduled"],
  ] as const)("%o → %s", (a, expected) => {
    expect(effectiveStatus(a, now)).toBe(expected);
  });
});
