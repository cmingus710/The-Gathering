import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { LAUNCHER_ITEMS, launcherItemsFor, menuArtSource, type LauncherItem } from "./launcher";
import { MENU_ART, MENU_ART_NAMES } from "./menu-art.generated";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** A route folder with a page, directly or inside a route group such as community/(feed). */
function hasPage(dir: string): boolean {
  if (existsSync(path.join(dir, "page.tsx"))) return true;
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((d) => /^\(.+\)$/.test(d) && existsSync(path.join(dir, d, "page.tsx")));
}
const none = { capabilities: new Set<never>(), features: {} };

describe("launcher config", () => {
  it("has unique ids and orders", () => {
    expect(new Set(LAUNCHER_ITEMS.map((i) => i.id)).size).toBe(LAUNCHER_ITEMS.length);
    expect(new Set(LAUNCHER_ITEMS.map((i) => i.order)).size).toBe(LAUNCHER_ITEMS.length);
  });

  it("shows only implemented sections, in order", () => {
    const ids = launcherItemsFor(none).map((i) => i.id);
    expect(ids).toEqual([
      "directory", "events", "community", "messages", "groups", "bible", "memory-verses", "prayer",
      "devotionals", "lessons", "podcasts", "reading", "music", "gallery", "youth",
      "announcements", "notifications", "profile",
    ]);
  });

  it("shows Give only when online giving is configured", () => {
    expect(launcherItemsFor(none).map((i) => i.id)).not.toContain("give");
    expect(launcherItemsFor({ ...none, features: { giving: true } }).map((i) => i.id)).toContain("give");
  });

  it("never includes administration", () => {
    const all = launcherItemsFor({ capabilities: new Set(Object.values(CAPABILITIES)), features: { giving: true } });
    expect(all.some((i) => i.href.startsWith("/admin"))).toBe(false);
  });

  it("applies capability rules and sorts new entries by order", () => {
    const extra: LauncherItem[] = [
      ...LAUNCHER_ITEMS,
      { id: "staff", label: "Staff", art: "administration", glyph: "admin", order: 15, status: "available", href: "/staff", requires: [CAPABILITIES.membersView] },
    ];
    expect(launcherItemsFor(none, extra).map((i) => i.id)).not.toContain("staff");
    const ids = launcherItemsFor({ capabilities: new Set([CAPABILITIES.membersView]), features: {} }, extra).map((i) => i.id);
    expect(ids.indexOf("staff")).toBe(1);
  });

  it("links every available tile to an existing member route", () => {
    for (const item of launcherItemsFor({ capabilities: new Set(), features: { giving: true } })) {
      const segment = item.href.slice(1);
      const found = ["(member)", "(events)", "(giving)", "(teaching)"].some((g) => hasPage(path.join(ROOT, "src/app/(app)", g, segment)));
      expect(found, item.href).toBe(true);
    }
  });
});

describe("menu artwork", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "assets/menu/icon-manifest.json"), "utf8")) as Array<{ name: string; asset: string }>;

  it("lists every manifest entry and references real artwork names", () => {
    expect([...MENU_ART_NAMES]).toEqual(manifest.map((m) => m.name));
    for (const item of LAUNCHER_ITEMS) expect(MENU_ART_NAMES, item.id).toContain(item.art);
  });

  it("has every supplied source and its resized copies on disk", () => {
    for (const m of manifest) expect(existsSync(path.join(ROOT, m.asset)), m.asset).toBe(true);
    for (const [name, art] of Object.entries(MENU_ART)) {
      for (const w of art!.widths) expect(existsSync(path.join(ROOT, "public/images/menu/optimized", `${name}-${w}.webp`)), `${name}-${w}`).toBe(true);
    }
    expect(Object.keys(MENU_ART).sort()).toEqual(manifest.map((m) => m.name).sort());
  });

  it("builds responsive sources with a cache-busting version", () => {
    const src = menuArtSource("directory");
    expect(src?.srcSet.split(", ")).toHaveLength(MENU_ART.directory!.widths.length);
    expect(src?.src).toMatch(/^\/images\/menu\/optimized\/directory-160\.webp\?v=\w+$/);
  });
});
