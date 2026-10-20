import type { Capability } from "@/lib/auth/capabilities";
import type { IconName } from "@/lib/icons";
import { MENU_ART, type MenuArtName } from "./menu-art.generated";

export type { MenuArtName };

/**
 * The home launcher: one entry per member section, shown as a dimensional
 * tile. Adding a module means adding an entry here; the layout (grid,
 * scrolling, columns) adapts on its own.
 *
 * - `art` names the supplied artwork (assets/menu/icon-manifest.json); when
 *   a file is missing the tile falls back to the original `glyph`.
 * - `order` sorts the tiles (gaps leave room for new entries).
 * - `status: "upcoming"` entries are never rendered as links. They document
 *   what will plug in later and become tiles by switching to "available".
 * - `requires` lists capabilities the viewer must hold; `feature` names a
 *   configuration the section depends on (giving needs Stripe configured).
 *
 * Administration is deliberately absent: it lives in the role-protected
 * account area (More sheet, sidebar, profile).
 */
export type LauncherFeature = "giving";

export type LauncherItem = {
  id: string;
  label: string;
  art: MenuArtName;
  glyph: IconName;
  order: number;
  /** Live unread count shown on the tile. */
  count?: "messages" | "notifications";
  requires?: Capability[];
  feature?: LauncherFeature;
} & ({ status: "available"; href: string } | { status: "upcoming"; phase: number });

export const LAUNCHER_ITEMS: LauncherItem[] = [
  { id: "directory", label: "Directory", art: "directory", glyph: "directory", order: 10, status: "available", href: "/directory" },
  { id: "events", label: "Events", art: "events", glyph: "events", order: 20, status: "available", href: "/events" },
  { id: "community", label: "Community", art: "community", glyph: "community", order: 30, status: "available", href: "/community" },
  { id: "messages", label: "Messages", art: "messages", glyph: "messages", order: 40, status: "available", href: "/messages", count: "messages" },
  { id: "groups", label: "Groups", art: "groups", glyph: "groups", order: 50, status: "available", href: "/groups" },
  { id: "give", label: "Give", art: "give", glyph: "giving", order: 60, status: "available", href: "/give", feature: "giving" },
  { id: "announcements", label: "News", art: "announcements", glyph: "announcements", order: 70, status: "available", href: "/announcements" },
  { id: "notifications", label: "Notifications", art: "notifications", glyph: "notifications", order: 80, status: "available", href: "/notifications", count: "notifications" },
  { id: "profile", label: "Profile", art: "profile", glyph: "profile", order: 90, status: "available", href: "/profile" },
  // A generic invitation to pray: the tile never shows request text.
  { id: "prayer", label: "Prayer", art: "prayer", glyph: "prayer", order: 55, status: "available", href: "/prayer" },
  // Teaching, media, and shared resources (Phase 7): each section has its own tile.
  { id: "devotionals", label: "Devotionals", art: "devotionals", glyph: "devotionals", order: 56, status: "available", href: "/devotionals" },
  { id: "lessons", label: "Sunday Lessons", art: "lessons", glyph: "lessons", order: 57, status: "available", href: "/lessons" },
  { id: "podcasts", label: "Podcasts", art: "podcasts", glyph: "podcasts", order: 58, status: "available", href: "/podcasts" },
  { id: "reading", label: "Church Reading", art: "church-reading", glyph: "reading", order: 59, status: "available", href: "/reading" },
  { id: "music", label: "Music", art: "music", glyph: "music", order: 62, status: "available", href: "/music" },
  { id: "gallery", label: "Gallery", art: "gallery", glyph: "gallery", order: 64, status: "available", href: "/gallery" },
  // Later phases (see docs/roadmap.md). Not links until they ship.
  { id: "bible", label: "Bible", art: "bible", glyph: "bible", order: 130, status: "upcoming", phase: 8 },
  { id: "memory-verses", label: "Memory verses", art: "memory-verses", glyph: "memory", order: 150, status: "upcoming", phase: 9 },
  { id: "youth", label: "Youth", art: "youth", glyph: "youth", order: 160, status: "upcoming", phase: 10 },
];

export type AvailableLauncherItem = Extract<LauncherItem, { status: "available" }>;

export type LauncherContext = {
  capabilities: ReadonlySet<Capability>;
  features: Partial<Record<LauncherFeature, boolean>>;
};

/** Tiles the viewer may open, in order. */
export function launcherItemsFor(ctx: LauncherContext, items: LauncherItem[] = LAUNCHER_ITEMS): AvailableLauncherItem[] {
  return items
    .filter((i): i is AvailableLauncherItem => i.status === "available")
    .filter((i) => (i.requires ?? []).every((c) => ctx.capabilities.has(c)))
    .filter((i) => !i.feature || ctx.features[i.feature] === true)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export type ArtSource = { src: string; srcSet: string };

/** Responsive sources for a supplied artwork, or null when it isn't available. */
export function menuArtSource(name: MenuArtName): ArtSource | null {
  const art = MENU_ART[name];
  if (!art?.widths.length) return null;
  const url = (w: number) => `/images/menu/optimized/${name}-${w}.webp?v=${art.version}`;
  const fallback = art.widths.find((w) => w >= 160) ?? art.widths[art.widths.length - 1];
  return { src: url(fallback), srcSet: art.widths.map((w) => `${url(w)} ${w}w`).join(", ") };
}
