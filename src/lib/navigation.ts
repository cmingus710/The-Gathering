import type { Capability } from "@/lib/auth/capabilities";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import type { IconName } from "@/lib/icons";

export type { IconName };

export type NavSection = "connect" | "church" | "you";

export const NAV_SECTIONS: Array<{ key: NavSection; label: string }> = [
  { key: "church", label: "Church life" },
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
  { key: "media", label: "Teaching & media", icon: "podcasts", section: "church", status: "upcoming", phase: 7 },
  { key: "grow", label: "Bible reading", icon: "bible", section: "church", status: "upcoming", phase: 8 },
];

/**
 * The phone tab bar: the four most-used destinations, then More. Profile is
 * always one tap away from the avatar in the header, so it lives under More.
 */
export const MOBILE_PRIMARY_KEYS = ["home", "events", "community", "messages"] as const;

export type AdminNavItem = { key: string; label: string; href: string; icon: IconName; requires: Capability[] };

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
  { key: "settings", label: "Church settings", href: "/admin/settings", icon: "settings", requires: [CAPABILITIES.settingsManage] },
  { key: "audit", label: "Audit log", href: "/admin/audit", icon: "audit", requires: [CAPABILITIES.auditView] },
];

export function adminNavFor(capabilities: ReadonlySet<Capability>): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => item.requires.every((c) => capabilities.has(c)));
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/home") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
