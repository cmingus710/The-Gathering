import type { Audience, CareKind, CareStatus, ContactMethod, OpportunityStatus, RequestStatus, SignupStatus } from "./types";

/**
 * Wording and small rules shared by prayer and care pages. The database is
 * the authority for every rule here; these only decide what to show (for
 * example, whether to ask for confirmation before the server would).
 */
export const PRAYER_LIMITS = { title: 120, body: 4000, update: 2000, comment: 2000, report: 1000 } as const;
export const CARE_LIMITS = { summary: 120, details: 2000, contactNote: 200, message: 2000, note: 1000, oppTitle: 120, oppDetails: 600, logistics: 1000 } as const;

export const AUDIENCES: Audience[] = ["church", "group", "team", "private"];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  church: "Church members",
  group: "My group",
  team: "Prayer & care team",
  private: "Private draft",
};

/** Who exactly can read a request with this audience. */
export function audienceDescription(audience: Audience, groupName?: string | null): string {
  switch (audience) {
    case "church":
      return "All approved members of the church can read it. It's never public.";
    case "group":
      return `Only current members of ${groupName ?? "the group you choose"} can read it.`;
    case "team":
      return "Only the designated prayer and care team can read it. It's confidential, but not monitored around the clock.";
    case "private":
      return "Only you can see it. Nothing is shared until you choose an audience.";
  }
}

/**
 * Mirrors prayer.is_narrowing(): a change that only removes readers takes
 * effect at once; anything else is a broadening the member must confirm.
 */
export function isNarrowing(from: { audience: Audience; groupId: string | null }, to: { audience: Audience; groupId: string | null }): boolean {
  return to.audience === "private" || from.audience === "church" || (from.audience === to.audience && from.groupId === to.groupId);
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  open: "Open",
  answered: "Answered",
  closed: "Closed",
  archived: "Archived",
};

export const ANONYMOUS_NOTICE =
  "Your name is hidden from readers. Designated prayer and care leads can look up who wrote a request when needed, and each lookup is recorded.";

export const CARE_KIND_LABEL: Record<CareKind, string> = {
  meal: "Meals",
  transportation: "Transportation",
  visit: "A visit",
  other: "Other help",
};

export const CARE_STATUS_LABEL: Record<CareStatus, string> = {
  submitted: "Submitted",
  in_review: "In review",
  coordinating: "Coordinating",
  fulfilled: "Fulfilled",
  closed: "Closed",
};

export const CARE_STATUSES: CareStatus[] = ["submitted", "in_review", "coordinating", "fulfilled", "closed"];

export const CONTACT_LABEL: Record<ContactMethod, string> = {
  app: "Messages here in the app",
  phone: "Phone (the number on your profile)",
  email: "Email (your sign-in address)",
};

export const CLOSED_REASON_LABEL: Record<string, string> = {
  fulfilled: "Help was provided",
  resolved: "Resolved another way",
  declined: "Not able to help",
  withdrawn: "Withdrawn by the requester",
};

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  completed: "Completed",
  canceled: "Canceled",
};

export const SIGNUP_LABEL: Record<SignupStatus, string> = {
  offered: "You offered",
  accepted: "You're confirmed",
  declined: "Not needed this time",
  withdrawn: "You withdrew",
  completed: "Done. Thank you!",
};

export const PRAYER_REPORT_REASONS = [
  { value: "inappropriate", label: "Inappropriate or unkind" },
  { value: "privacy", label: "Shares someone's private information" },
  { value: "harassment", label: "Harassment" },
  { value: "safety", label: "Someone may be at risk" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

export const CARE_ACTIVITY_LABEL: Record<string, string> = {
  submitted: "Request submitted",
  assigned: "Assigned",
  unassigned: "Unassigned",
  status_changed: "Status changed",
  follow_up_set: "Follow-up date set",
  note_added: "Internal note added",
  team_responded: "Care team responded",
  requester_replied: "Requester replied",
  consent_changed: "Sharing consent changed",
  withdrawn: "Withdrawn by the requester",
  opportunity_created: "Volunteer opportunity drafted",
  opportunity_edited: "Volunteer opportunity edited",
  opportunity_published: "Volunteer opportunity published",
  opportunity_open: "Opportunity reopened",
  opportunity_filled: "Opportunity filled",
  opportunity_completed: "Opportunity completed",
  opportunity_canceled: "Opportunity canceled",
  volunteer_offered: "A volunteer offered to help",
  volunteer_withdrew: "A volunteer withdrew",
  volunteer_accepted: "Volunteer accepted",
  volunteer_declined: "Volunteer declined",
  volunteer_completed: "Volunteer marked complete",
};

/** A date-only value ("2026-11-01") formatted without shifting time zones. */
export function formatDay(ymd: string | null | undefined): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export function dateRange(from: string | null, until: string | null): string | null {
  const a = formatDay(from);
  const b = formatDay(until);
  if (a && b && from !== until) return `${a} – ${b}`;
  return a ?? b;
}

/** Feed tabs and filters, validated from search params. */
export const VIEWS = ["feed", "mine", "following", "answered"] as const;
export type View = (typeof VIEWS)[number];
export const STATUS_FILTERS = ["active", "open", "answered", "closed", "archived", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const AUDIENCE_FILTERS = ["any", "church", "group", "team", "private"] as const;
export type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Keyset cursor for "Show more": the last card's activity time (exactly as
 * the database returned it, microseconds included) and its id.
 */
export function encodeCursor(card: { last_activity_at: string; id: string }): string {
  return `${card.last_activity_at}~${card.id}`;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function decodeCursor(value: unknown): { before: string; beforeId: string } | null {
  if (typeof value !== "string") return null;
  const m = CURSOR.exec(value);
  return m && !Number.isNaN(Date.parse(m[1])) ? { before: m[1], beforeId: m[2] } : null;
}
