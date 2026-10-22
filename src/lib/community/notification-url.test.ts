import { describe, expect, it } from "vitest";
import { safeNotificationUrl } from "./notification-url";

const THREAD = "3f1c2b4a-1d2e-4f3a-9b8c-7d6e5f4a3b2c";
const POST = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("notification click-through URL check", () => {
  it("allows plain same-origin paths", () => {
    expect(safeNotificationUrl(`/community/t/${THREAD}`)).toBe(`/community/t/${THREAD}`);
    expect(safeNotificationUrl("/prayer")).toBe("/prayer");
    expect(safeNotificationUrl("/")).toBe("/");
  });

  it("allows a single ?comment=<uuid> query", () => {
    const url = `/community/t/${THREAD}?comment=${POST}`;
    expect(safeNotificationUrl(url)).toBe(url);
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeNotificationUrl("//evil.example")).toBeNull();
    expect(safeNotificationUrl(`//evil.example?comment=${POST}`)).toBeNull();
    expect(safeNotificationUrl("https://evil.example/")).toBeNull();
    expect(safeNotificationUrl("/\\evil.example")).toBeNull();
    expect(safeNotificationUrl("community/t/x")).toBeNull();
  });

  it("rejects any other query string or fragment", () => {
    expect(safeNotificationUrl(`/community/t/${THREAD}?next=//evil.example`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}?comment=not-a-uuid`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}?comment=${POST}&x=1`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}?comment=${POST.toUpperCase()}`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}??comment=${POST}`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}?`)).toBeNull();
    expect(safeNotificationUrl(`/community/t/${THREAD}#x`)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeNotificationUrl(null)).toBeNull();
    expect(safeNotificationUrl(42)).toBeNull();
  });
});
