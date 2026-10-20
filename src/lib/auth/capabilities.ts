/**
 * Capability keys (Phase 1, Phase 3 finance, Phase 4 events, Phase 5 community, Phase 6 prayer and care, Phase 7 teaching and media). The database (public.capabilities,
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
  // Community: categories, guidelines, groups (Community administrator) and
  // reports/moderation (Community moderator). Group leaders hold neither.
  communityManage: "community.manage",
  communityModerate: "community.moderate",
  // Prayer and care: explicit roles only (never implied by super_admin).
  prayerConfidential: "prayer.confidential",
  prayerModerate: "prayer.moderate",
  prayerIdentity: "prayer.identity",
  careCoordinate: "care.coordinate",
  careAssign: "care.assign",
  // Teaching and media (Phase 7): drafts, publishing, the media library,
  // podcast configuration, and gallery moderation. None opens member records,
  // messages, prayer, care, or finance.
  contentEdit: "content.edit",
  contentPublish: "content.publish",
  mediaManage: "media.manage",
  podcastsManage: "podcasts.manage",
  galleryModerate: "gallery.moderate",
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
  CAPABILITIES.communityManage,
  CAPABILITIES.communityModerate,
  CAPABILITIES.prayerModerate,
  CAPABILITIES.contentEdit,
  CAPABILITIES.contentPublish,
  CAPABILITIES.mediaManage,
  CAPABILITIES.podcastsManage,
  CAPABILITIES.galleryModerate,
];

export function canAccessAdmin(capabilities: ReadonlySet<Capability>): boolean {
  return ADMIN_AREA_CAPABILITIES.some((c) => capabilities.has(c));
}

export type MembershipStatus = "pending" | "approved" | "suspended";
