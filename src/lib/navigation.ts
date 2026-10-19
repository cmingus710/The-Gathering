import type { Capability } from "@/lib/auth/capabilities";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export type IconName =
  | "home"
  | "announcements"
  | "profile"
  | "community"
  | "prayer"
  | "events"
  | "grow"
  | "media"
  | "give"
  | "directory"
  | "dashboard"
  | "members"
  | "settings"
  | "audit";

export type NavItem = {
  key: string;
  label: string;
  icon: IconName;
} & ({ status: "available"; href: string } | { status: "upcoming"; phase: number });

/**
 * Member navigation. Upcoming modules are listed (clearly labelled, not links)
 * so members can see what is coming without hitting dead ends.
 */
export const MEMBER_NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "home", status: "available", href: "/home" },
  { key: "announcements", label: "Announcements", icon: "announcements", status: "available", href: "/announcements" },
  { key: "directory", label: "Directory", icon: "directory", status: "available", href: "/directory" },
  { key: "profile", label: "Profile", icon: "profile", status: "available", href: "/profile" },
  { key: "give", label: "Give", icon: "give", status: "available", href: "/give" },
  { key: "events", label: "Events", icon: "events", status: "available", href: "/events" },
  { key: "community", label: "Community", icon: "community", status: "upcoming", phase: 5 },
  { key: "prayer", label: "Prayer", icon: "prayer", status: "upcoming", phase: 6 },
  { key: "media", label: "Media", icon: "media", status: "upcoming", phase: 7 },
  { key: "grow", label: "Grow", icon: "grow", status: "upcoming", phase: 8 },
];

/** The small set shown in the phone tab bar; everything else lives under More. */
export const MOBILE_PRIMARY_KEYS = ["home", "announcements", "directory", "profile"] as const;

export type AdminNavItem = { key: string; label: string; href: string; icon: IconName; requires: Capability[] };

export const ADMIN_NAV: AdminNavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: "dashboard", requires: [] },
  {
    key: "members",
    label: "Members",
    href: "/admin/members",
    icon: "members",
    requires: [CAPABILITIES.membersView],
  },
  {
    key: "interests",
    label: "Ministry interests",
    href: "/admin/ministry-interests",
    icon: "grow",
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
    key: "finance",
    label: "Giving",
    href: "/admin/finance",
    icon: "give",
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
