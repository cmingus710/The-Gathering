import type { Capability } from "@/lib/auth/capabilities";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import type { IconName } from "@/lib/icons";

export type { IconName };

export type NavSection = "connect" | "church" | "learn" | "you";

export const NAV_SECTIONS: Array<{ key: NavSection; label: string }> = [
  { key: "church", label: "Church life" },
  { key: "learn", label: "Teaching & media" },
  { key: "connect", label: "Connect" },
  { key: "you", label: "You" },
];

export type NavItem = {
  key: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  shortLabel?: string;
  icon: IconName;
  section: NavSection;
  /** Live unread count shown beside the link. */
  count?: "messages" | "notifications";
} & ({ status: "available"; href: string } | { status: "upcoming"; phase: number });

/**
 * Member navigation. Upcoming modules are listed (clearly labelled, not links)
 * so members can see what is coming without hitting dead ends.
 */
export const MEMBER_NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "home", section: "church", status: "available", href: "/home" },
  { key: "events", label: "Events", icon: "events", section: "church", status: "available", href: "/events" },
  { key: "announcements", label: "Announcements", shortLabel: "News", icon: "announcements", section: "church", status: "available", href: "/announcements" },
  { key: "give", label: "Give", icon: "giving", section: "church", status: "available", href: "/give" },
  { key: "community", label: "Community", icon: "community", section: "connect", status: "available", href: "/community" },
  { key: "groups", label: "Groups", icon: "groups", section: "connect", status: "available", href: "/groups" },
  { key: "messages", label: "Messages", icon: "messages", section: "connect", status: "available", href: "/messages", count: "messages" },
  { key: "directory", label: "Directory", icon: "directory", section: "connect", status: "available", href: "/directory" },
  { key: "profile", label: "Profile", icon: "profile", section: "you", status: "available", href: "/profile" },
  { key: "notifications", label: "Notifications", icon: "notifications", section: "you", status: "available", href: "/notifications", count: "notifications" },
  { key: "prayer", label: "Prayer", icon: "prayer", section: "church", status: "available", href: "/prayer" },
  { key: "devotionals", label: "Devotionals", icon: "devotionals", section: "learn", status: "available", href: "/devotionals" },
  { key: "lessons", label: "Sunday lessons", icon: "lessons", section: "learn", status: "available", href: "/lessons" },
  { key: "podcasts", label: "Podcasts", icon: "podcasts", section: "learn", status: "available", href: "/podcasts" },
  { key: "reading", label: "Church reading", icon: "reading", section: "learn", status: "available", href: "/reading" },
  { key: "music", label: "Music", icon: "music", section: "learn", status: "available", href: "/music" },
  { key: "gallery", label: "Gallery", icon: "gallery", section: "learn", status: "available", href: "/gallery" },
  { key: "media", label: "Search teaching & media", icon: "media", section: "learn", status: "available", href: "/media" },
  { key: "saved", label: "Saved", icon: "media", section: "you", status: "available", href: "/saved" },
  // Phase 8: Bible reading plans and the reader; journals are private to each member.
  { key: "bible", label: "Bible reading", icon: "bible", section: "learn", status: "available", href: "/bible" },
  { key: "journal", label: "My Journal", icon: "journal", section: "you", status: "available", href: "/journal" },
  // Phase 9: scripture memory; practice results are private to each member.
  { key: "memory", label: "Memory verses", icon: "memory", section: "learn", status: "available", href: "/memory" },
  // Phase 10: youth ministry, family dashboard, and leading youth groups.
  { key: "youth", label: "Youth & Families", icon: "youth", section: "church", status: "available", href: "/youth" },
];

/**
 * The phone tab bar: the four most-used destinations, then More. Profile is
 * always one tap away from the avatar in the header, so it lives under More.
 */
export const MOBILE_PRIMARY_KEYS = ["home", "events", "community", "messages"] as const;

/** requires: all of these; anyOf: at least one of these (when given). */
export type AdminNavItem = { key: string; label: string; href: string; icon: IconName; requires: Capability[]; anyOf?: Capability[] };

export const ADMIN_NAV: AdminNavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: "admin", requires: [] },
  {
    key: "members",
    label: "Members",
    href: "/admin/members",
    icon: "directory",
    requires: [CAPABILITIES.membersView],
  },
  {
    key: "interests",
    label: "Ministry interests",
    href: "/admin/ministry-interests",
    icon: "sprout",
    requires: [CAPABILITIES.membersManage],
  },
  {
    key: "announcements",
    label: "Announcements",
    href: "/admin/announcements",
    icon: "announcements",
    requires: [CAPABILITIES.announcementsManage],
  },
  {
    key: "events",
    label: "Events",
    href: "/admin/events",
    icon: "events",
    requires: [CAPABILITIES.eventsManage],
  },
  {
    key: "community",
    label: "Community",
    href: "/admin/community",
    icon: "community",
    requires: [CAPABILITIES.communityManage],
  },
  {
    key: "moderation",
    label: "Moderation",
    href: "/admin/moderation",
    icon: "moderation",
    requires: [CAPABILITIES.communityModerate],
  },
  {
    key: "content",
    label: "Teaching content",
    href: "/admin/content",
    icon: "lessons",
    requires: [],
    anyOf: [CAPABILITIES.contentEdit, CAPABILITIES.contentPublish],
  },
  {
    key: "media",
    label: "Media library",
    href: "/admin/media",
    icon: "media",
    requires: [],
    anyOf: [CAPABILITIES.mediaManage, CAPABILITIES.contentEdit, CAPABILITIES.contentPublish, CAPABILITIES.podcastsManage],
  },
  {
    key: "podcasts",
    label: "Podcasts",
    href: "/admin/podcasts",
    icon: "podcasts",
    requires: [CAPABILITIES.podcastsManage],
  },
  {
    key: "gallery",
    label: "Gallery",
    href: "/admin/gallery",
    icon: "gallery",
    requires: [],
    anyOf: [CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage],
  },
  {
    key: "bible-plans",
    label: "Reading plans",
    href: "/admin/bible",
    icon: "bible",
    requires: [],
    anyOf: [CAPABILITIES.readingEdit, CAPABILITIES.readingPublish],
  },
  {
    key: "bible-sources",
    label: "Bible sources",
    href: "/admin/bible/sources",
    icon: "reading",
    requires: [CAPABILITIES.bibleManage],
  },
  {
    key: "memory",
    label: "Memory verses",
    href: "/admin/memory",
    icon: "memory",
    requires: [],
    anyOf: [CAPABILITIES.memoryManage, CAPABILITIES.memoryPublish],
  },
  {
    key: "youth",
    label: "Youth & families",
    href: "/admin/youth",
    icon: "youth",
    requires: [],
    anyOf: [
      CAPABILITIES.youthManage,
      CAPABILITIES.youthPublish,
      CAPABILITIES.youthEnroll,
      CAPABILITIES.youthForms,
      CAPABILITIES.youthLogistics,
      CAPABILITIES.youthMediaConsent,
      CAPABILITIES.youthSafeguarding,
      CAPABILITIES.youthPolicy,
      CAPABILITIES.familyVerify,
    ],
  },
  {
    key: "prayer",
    label: "Prayer reports",
    href: "/admin/prayer",
    icon: "prayer",
    requires: [CAPABILITIES.prayerModerate],
  },
  {
    key: "prayer-settings",
    label: "Prayer settings",
    href: "/admin/prayer/settings",
    icon: "settings",
    requires: [CAPABILITIES.settingsManage],
  },
  {
    key: "finance",
    label: "Giving",
    href: "/admin/finance",
    icon: "giving",
    requires: [CAPABILITIES.financeView],
  },
  {
    key: "problem-reports",
    label: "Problem reports",
    href: "/admin/problem-reports",
    icon: "moderation",
    requires: [CAPABILITIES.settingsManage],
  },
  { key: "settings", label: "Church settings", href: "/admin/settings", icon: "settings", requires: [CAPABILITIES.settingsManage] },
  { key: "audit", label: "Audit log", href: "/admin/audit", icon: "audit", requires: [CAPABILITIES.auditView] },
];

export function adminNavFor(capabilities: ReadonlySet<Capability>): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => item.requires.every((c) => capabilities.has(c)) && (!item.anyOf || item.anyOf.some((c) => capabilities.has(c))));
}

/** The href of the most specific item matching the path (so /admin/bible/sources isn't also "Reading plans"). */
export function activeHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs.filter((href) => isActivePath(pathname, href)).sort((a, b) => b.length - a.length)[0];
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/home") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
