/**
 * Capability keys (Phase 1, Phase 3 finance, Phase 4 events). The database (public.capabilities,
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
  // Finance: granted only through explicit finance roles (never implied by super_admin).
  financeView: "finance.view",
  financeRecord: "finance.record",
  financeExport: "finance.export",
  financeManage: "finance.manage",
  financeRefund: "finance.refund",
  // Events: create, publish, cancel, attendee lists (Event coordinator role).
  eventsManage: "events.manage",
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
  CAPABILITIES.financeView,
  CAPABILITIES.eventsManage,
];

export function canAccessAdmin(capabilities: ReadonlySet<Capability>): boolean {
  return ADMIN_AREA_CAPABILITIES.some((c) => capabilities.has(c));
}

export type MembershipStatus = "pending" | "approved" | "suspended";
