import type { CSSProperties } from "react";
import { menuArtSource, type ArtSource, type MenuArtName } from "@/lib/home/launcher";
import type { IconName } from "@/lib/icons";
import { SECTION_BACKGROUNDS, SECTION_BACKGROUND_WIDTHS, type SectionBackgroundName } from "./backgrounds.generated";

/**
 * Section headers: one entry per member section that has a supplied
 * dark/light banner (assets/section-headers/background-manifest.json).
 * Adding a section means adding its two images to the manifest and an entry
 * here; pages then render <SectionHeader section="…" />.
 *
 * - `label` is the section's approved name (the sidebar label), used as the
 *   page heading unless the page passes its own title.
 * - `art` names the dimensional menu artwork shown as the header icon (the
 *   same file as the Home launcher tile). `glyph` is the custom icon used
 *   when a section has no menu artwork (Videos), as on the launcher.
 */
export type SectionKey = SectionBackgroundName;

export type SectionConfig = { label: string; art: MenuArtName | null; glyph: IconName };

export const SECTIONS: Record<SectionKey, SectionConfig> = {
  events: { label: "Events", art: "events", glyph: "events" },
  prayer: { label: "Prayer", art: "prayer", glyph: "prayer" },
  devotionals: { label: "Devotionals", art: "devotionals", glyph: "devotionals" },
  lessons: { label: "Sunday lessons", art: "lessons", glyph: "lessons" },
  reading: { label: "Books", art: "church-reading", glyph: "reading" },
  music: { label: "Music", art: "music", glyph: "music" },
  podcasts: { label: "Podcasts", art: "podcasts", glyph: "podcasts" },
  videos: { label: "Videos", art: null, glyph: "media" },
  gallery: { label: "Media gallery", art: "gallery", glyph: "gallery" },
  journal: { label: "My Journal", art: "journal", glyph: "journal" },
  youth: { label: "Youth & Families", art: "youth", glyph: "youth" },
  community: { label: "Community", art: "community", glyph: "community" },
  messages: { label: "Messages", art: "messages", glyph: "messages" },
  announcements: { label: "Announcements", art: "announcements", glyph: "announcements" },
  give: { label: "Give", art: "give", glyph: "giving" },
  directory: { label: "Directory", art: "directory", glyph: "directory" },
  bible: { label: "Bible reading", art: "bible", glyph: "bible" },
  memory: { label: "Memory verses", art: "memory-verses", glyph: "memory" },
};

export function sectionIcon(key: SectionKey): ArtSource | null {
  const art = SECTIONS[key].art;
  return art ? menuArtSource(art) : null;
}

function imageSet(name: SectionKey, theme: "dark" | "light", version: string): string {
  const [w1, w2] = SECTION_BACKGROUND_WIDTHS;
  const url = (w: number) => `url("/images/section-headers/${name}-${theme}-${w}.webp?v=${version}")`;
  return `image-set(${url(w1)} 1x, ${url(w2)} 2x)`;
}

/**
 * Both themes' backgrounds as CSS custom properties. Only the one the
 * stylesheet selects for the resolved theme is ever painted, so only that
 * image is downloaded (the other is fetched only if the theme changes while
 * the page is open). A missing file leaves a plain banner in the artwork's
 * colours, or the theme surface if neither file exists.
 */
export function sectionBackgroundStyle(key: SectionKey): CSSProperties {
  const style: Record<string, string> = {};
  for (const theme of ["dark", "light"] as const) {
    const bg = SECTION_BACKGROUNDS[`${key}:${theme}`];
    if (!bg) continue;
    style[`--sh-${theme}`] = imageSet(key, theme, bg.version);
    style[`--sh-edge-${theme}`] = bg.edge;
  }
  return style as CSSProperties;
}
