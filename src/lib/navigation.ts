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
  { key: "profile", label: "Profile", icon: "profile", status: "available", href: "/profile" },
  { key: "directory", label: "Directory", icon: "directory", status: "upcoming", phase: 2 },
  { key: "give", label: "Give", icon: "give", status: "upcoming", phase: 3 },
  { key: "events", label: "Events", icon: "events", status: "upcoming", phase: 4 },
  { key: "community", label: "Community", icon: "community", status: "upcoming", phase: 5 },
  { key: "prayer", label: "Prayer", icon: "prayer", status: "upcoming", phase: 6 },
  { key: "media", label: "Media", icon: "media", status: "upcoming", phase: 7 },
  { key: "grow", label: "Grow", icon: "grow", status: "upcoming", phase: 8 },
];

/** The small set shown in the phone tab bar; everything else lives under More. */
export const MOBILE_PRIMARY_KEYS = ["home", "announcements", "profile"] as const;

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
    key: "announcements",
    label: "Announcements",
    href: "/admin/announcements",
    icon: "announcements",
    requires: [CAPABILITIES.announcementsManage],
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
