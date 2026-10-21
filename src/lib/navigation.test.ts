import { describe, expect, it } from "vitest";
import { activeHref, isActivePath } from "./navigation";

describe("active navigation", () => {
  it("marks only the most specific admin section as current", () => {
    const hrefs = ["/admin", "/admin/bible", "/admin/bible/sources", "/admin/prayer", "/admin/prayer/settings"];
    expect(activeHref("/admin/bible/sources", hrefs)).toBe("/admin/bible/sources");
    expect(activeHref("/admin/bible/sources/imports/1", hrefs)).toBe("/admin/bible/sources");
    expect(activeHref("/admin/bible/plans/1", hrefs)).toBe("/admin/bible");
    expect(activeHref("/admin/prayer/settings", hrefs)).toBe("/admin/prayer/settings");
    expect(activeHref("/admin", hrefs)).toBe("/admin");
    expect(activeHref("/admin/members", hrefs)).toBeUndefined();
  });

  it("matches whole path segments only", () => {
    expect(isActivePath("/bible/read", "/bible")).toBe(true);
    expect(isActivePath("/bibles", "/bible")).toBe(false);
    expect(isActivePath("/home/x", "/home")).toBe(false);
  });
});
