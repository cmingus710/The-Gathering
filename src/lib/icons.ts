/**
 * The Gathering's custom icon vocabulary (drawn in src/components/icons).
 * Pure data so navigation config and the icon reference page can share it.
 */
export const GLYPHS = {
  home: { label: "Home", concept: "A doorway arch under a soft roof" },
  directory: { label: "Directory", concept: "People arranged in a welcoming circle around a gathering point" },
  community: { label: "Community", concept: "Two overlapping discussion forms" },
  groups: { label: "Groups", concept: "Three figures; the centre head in gold, echoing the symbol" },
  messages: { label: "Messages", concept: "One conversation bubble with written lines" },
  prayer: { label: "Prayer", concept: "Hands joined with a subtle rising light" },
  events: { label: "Events", concept: "Calendar with a gold date marker" },
  bible: { label: "Bible Reading", concept: "Open book with a restrained ribbon" },
  journal: { label: "My Journal", concept: "A bound notebook with a gold pen" },
  memory: { label: "Memory Verses", concept: "Scripture card with a small spark" },
  devotionals: { label: "Devotionals", concept: "Sunrise above an open page" },
  podcasts: { label: "Podcasts", concept: "Microphone with sound arcs" },
  lessons: { label: "Sunday Lessons", concept: "Open Bible on a lectern" },
  reading: { label: "Church Reading", concept: "A closed book with a gold ribbon marker" },
  music: { label: "Music", concept: "Two joined notes; the beam in gold" },
  gallery: { label: "Gallery", concept: "Stacked photos with a gold sun over hills" },
  media: { label: "Teaching & media", concept: "A play mark in gold inside a rounded screen" },
  youth: { label: "Youth", concept: "Energetic figures joined at the hands" },
  giving: { label: "Giving", concept: "An open hand supporting a heart" },
  profile: { label: "Profile", concept: "A person; the head drawn in gold" },
  announcements: { label: "Announcements", concept: "Megaphone with sound arcs" },
  admin: { label: "Administration", concept: "A stewardship shield with a gold check" },
  notifications: { label: "Notifications", concept: "Bell with a gold clapper" },
  more: { label: "More", concept: "Three tiles and a gold circle" },
  settings: { label: "Settings", concept: "Two sliders, one gold" },
  audit: { label: "Audit log", concept: "Clipboard with a gold clip" },
  moderation: { label: "Moderation", concept: "Shield with a gold notice mark" },
  sprout: { label: "Ministry interests", concept: "A sprout with one gold leaf" },
} as const;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
