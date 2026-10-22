import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACK_ROUTES, backTarget, isReturnView, validReturnView, type BackRoute } from "./back-links";
import { MEMBER_NAV } from "./navigation";

const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Every page route in the app, route groups removed: "/podcasts/episodes/[id]". */
function appRoutes(): Set<string> {
  const root = path.resolve(import.meta.dirname, "../app");
  const out = new Set<string>();
  const walk = (dir: string, parts: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, /^\(.*\)$/.test(name) ? parts : [...parts, name]);
      else if (name === "page.tsx") out.add(`/${parts.join("/")}`);
    }
  };
  walk(root, []);
  return out;
}
const asPattern = (p: string) => p.replace(/\[[A-Za-z]+\]/g, "[x]");

describe("back link route map", () => {
  const routes = appRoutes();
  const patterns = new Set([...routes].map(asPattern));

  it("names real pages, and every parent is a real page", () => {
    for (const [route, entry] of Object.entries(BACK_ROUTES)) {
      expect(routes.has(route), route).toBe(true);
      expect(patterns.has(asPattern(entry.parent)), `${route} → ${entry.parent}`).toBe(true);
      if ("orphan" in entry) expect(routes.has(entry.orphan.parent), `${route} → ${entry.orphan.parent}`).toBe(true);
    }
  });

  it("gives top-level menu pages no back link", () => {
    for (const item of MEMBER_NAV) {
      if (item.status === "available") expect(item.href in BACK_ROUTES, item.href).toBe(false);
    }
  });

  it("goes up one level to the named parent", () => {
    expect(backTarget("/events/[id]")).toEqual({ href: "/events", label: "Events" });
    expect(backTarget("/music/[id]")).toEqual({ href: "/music", label: "Music & playlists" });
    expect(backTarget("/bible/plans/[id]")).toEqual({ href: "/bible", label: "Bible reading" });
    expect(backTarget("/bible/day/[id]", { params: { plan: ID }, label: "Psalms in 30 days" })).toEqual({
      href: `/bible/plans/${ID}`,
      label: "Psalms in 30 days",
    });
    expect(backTarget("/groups/[id]/manage/reports/[reportId]", { params: { id: ID } }).href).toBe(`/groups/${ID}/manage/reports`);
  });

  it("uses the stated fallback when a page has no parent of its own", () => {
    expect(backTarget("/podcasts/episodes/[id]", { params: { show: ID }, label: "Sunday sermons" })).toEqual({ href: `/podcasts/shows/${ID}`, label: "Sunday sermons" });
    expect(backTarget("/podcasts/episodes/[id]", { params: { show: null }, label: "ignored" })).toEqual({ href: "/podcasts", label: "Podcasts" });
    expect(backTarget("/community/new", { query: { category: ID } })).toEqual({ href: `/community?category=${ID}`, label: "Community" });
    expect(backTarget("/community/new", { params: { group: ID } }).href).toBe(`/groups/${ID}`);
  });

  it("keeps approved parent context and drops anything else", () => {
    expect(backTarget("/community/t/[id]", { query: { group: ID }, label: "Men's group" })).toEqual({ href: `/community?group=${ID}`, label: "Men's group" });
    expect(backTarget("/community/t/[id]", { query: { group: "https://evil.example" } }).href).toBe("/community");
    expect(backTarget("/events/[id]", { query: { next: "/admin" } }).href).toBe("/events");
  });

  it("refuses segments that aren't plain ids", () => {
    for (const bad of ["../admin", "//evil.example", "a/b", "x?y=1", ""]) {
      expect(() => backTarget("/bible/day/[id]", { params: { plan: bad } }), bad).toThrow();
    }
    expect(() => backTarget("/nope" as BackRoute)).toThrow();
  });
});

describe("returning to a filtered list", () => {
  it("records only lists a back link can return to", () => {
    expect(isReturnView("/events")).toBe(true);
    expect(isReturnView(`/podcasts/shows/${ID}`)).toBe(true);
    expect(isReturnView("/events/calendar")).toBe(false);
    expect(isReturnView("/admin")).toBe(false);
  });

  it("brings back approved, well-formed filters", () => {
    expect(validReturnView("/events", `/events?view=month&month=2026-11&category=${ID}`)).toBe(`/events?view=month&month=2026-11&category=${ID}`);
    expect(validReturnView("/prayer", "/prayer?view=mine&status=answered")).toBe("/prayer?view=mine&status=answered");
    expect(validReturnView("/directory", "/directory?q=Smith&page=2")).toBe("/directory?q=Smith&page=2");
    expect(validReturnView("/events", "/events")).toBe("/events");
  });

  it("drops one-off flags and unknown or malformed values", () => {
    expect(validReturnView("/prayer", "/prayer?view=mine&deleted=1")).toBe("/prayer?view=mine");
    expect(validReturnView("/events", "/events?month=2026-13&category=nope")).toBe("/events");
    expect(validReturnView("/events", "/events?next=https://evil.example")).toBe("/events");
  });

  it("never leaves the parent's own path", () => {
    for (const bad of ["https://evil.example/events", "//evil.example/events", "/\\evil.example", "/events/../admin", "/admin?view=list", "javascript:alert(1)", "/events#x", "events"]) {
      expect(validReturnView("/events", bad), bad).toBeNull();
    }
    expect(validReturnView("/events", null)).toBeNull();
  });

  it("keeps a parent's own context: a group's post doesn't return to another feed", () => {
    expect(validReturnView(`/community?group=${ID}`, `/community?group=${ID}`)).toBe(`/community?group=${ID}`);
    expect(validReturnView(`/community?group=${ID}`, `/community?group=${OTHER}`)).toBeNull();
    expect(validReturnView(`/community?group=${ID}`, "/community")).toBeNull();
    expect(validReturnView("/community", `/community?category=${ID}`)).toBe(`/community?category=${ID}`);
  });
});
