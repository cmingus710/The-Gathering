import { formatCents } from "./money";

/**
 * Fundraising campaigns (Phase 13). Totals are computed in the database from
 * the payment rows on every read (see docs/phase-13/campaigns.md for the
 * exact definition); the public shape carries aggregates only.
 */
export type CampaignStatus = "draft" | "published" | "closed" | "archived";
export type CampaignVisibility = "public" | "members";

export type PublicCampaign = {
  id: string;
  title: string;
  description: string | null;
  image_path: string | null;
  image_alt: string | null;
  goal_cents: number;
  raised_cents: number;
  percent: number;
  goal_reached: boolean;
  status: "published" | "closed";
  visibility: CampaignVisibility;
  accepting_gifts: boolean;
  starts_on: string | null;
  ends_on: string | null;
  fund_id: string;
  fund_name: string;
};

export type AdminCampaign = Omit<PublicCampaign, "status"> & {
  status: CampaignStatus;
  fund_active: boolean;
  livemode: boolean;
  gross_cents: number;
  refunded_cents: number;
  disputed_open_cents: number;
  disputed_lost_cents: number;
  gift_count: number;
  by_source: Array<{ source: "stripe" | "cash" | "check"; gross_cents: number; raised_cents: number; count: number }>;
  published_at: string | null;
  closed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminCampaignDetail = AdminCampaign & {
  pending_count: number;
  active_commitments: number;
  history: Array<{ action: string; at: string; actor: string | null; details: Record<string, unknown> }>;
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
  archived: "Archived",
};

/** Allowed moves, mirrored from public.finance_campaign_status (the database decides). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, Array<{ to: CampaignStatus; label: string }>> = {
  draft: [
    { to: "published", label: "Publish" },
    { to: "archived", label: "Archive" },
  ],
  published: [{ to: "closed", label: "Close to new gifts" }],
  closed: [
    { to: "published", label: "Reopen" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "closed", label: "Restore (as closed)" }],
};

/** Screen-reader text for the meter, e.g. "$1,250 raised of $5,000 goal". */
export function meterText(raisedCents: number, goalCents: number): string {
  const whole = (c: number) => formatCents(c).replace(/\.00$/, "");
  return `${whole(raisedCents)} raised of ${whole(goalCents)} goal`;
}

/** "Through Dec 31, 2026" style date range for display (dates are church-local calendar dates). */
export function campaignDates(startsOn: string | null, endsOn: string | null): string | null {
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (startsOn && endsOn) return `${fmt(startsOn)} – ${fmt(endsOn)}`;
  if (endsOn) return `Through ${fmt(endsOn)}`;
  if (startsOn) return `From ${fmt(startsOn)}`;
  return null;
}
