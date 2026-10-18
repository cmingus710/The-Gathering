export type AnnouncementStatus = "draft" | "scheduled" | "published" | "archived";
export type AnnouncementVisibility = "public" | "members";

/** What a reader would experience right now, derived from status and dates. */
export type EffectiveStatus = "draft" | "scheduled" | "live" | "expired" | "archived";

export type AnnouncementTiming = {
  status: AnnouncementStatus;
  publish_at: string | null;
  expires_at: string | null;
};

export function effectiveStatus(a: AnnouncementTiming, now: Date = new Date()): EffectiveStatus {
  if (a.status === "archived") return "archived";
  if (a.status === "draft") return "draft";
  const publishAt = a.publish_at ? new Date(a.publish_at) : null;
  if (!publishAt || publishAt > now) return "scheduled";
  if (a.expires_at && new Date(a.expires_at) <= now) return "expired";
  return "live";
}

export const EFFECTIVE_STATUS_LABEL: Record<EffectiveStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Published",
  expired: "Expired",
  archived: "Archived",
};

export const VISIBILITY_LABEL: Record<AnnouncementVisibility, string> = {
  public: "Public",
  members: "Members only",
};
