/**
 * Capability keys implemented in Phase 1. The database (public.capabilities,
 * public.has_capability) is the source of truth; these constants keep the app
 * code typed. Add a key here only after adding it in a migration.
 */
export const CAPABILITIES = {
  membersView: "members.view",
  membersManage: "members.manage",
  rolesManage: "roles.manage",
  settingsManage: "settings.manage",
  announcementsManage: "announcements.manage",
  auditView: "audit.view",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const KNOWN = new Set<string>(Object.values(CAPABILITIES));

export function isCapability(value: string): value is Capability {
  return KNOWN.has(value);
}

/** Capabilities that open the admin area. Any one is enough to enter. */
export const ADMIN_AREA_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.membersView,
  CAPABILITIES.membersManage,
  CAPABILITIES.rolesManage,
  CAPABILITIES.settingsManage,
  CAPABILITIES.announcementsManage,
  CAPABILITIES.auditView,
];

export function canAccessAdmin(capabilities: ReadonlySet<Capability>): boolean {
  return ADMIN_AREA_CAPABILITIES.some((c) => capabilities.has(c));
}

export type MembershipStatus = "pending" | "approved" | "suspended";
