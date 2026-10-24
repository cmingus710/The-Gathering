import type { BadgeTone } from "@/components/ui/badge";

/**
 * Plain-language labels for the Youth & Families area. Members never see
 * internal names (capabilities, table states); every state is shown with
 * words (and an icon where it appears), never by color alone.
 */
export const PERMISSIONS = [
  { key: "manage_profile", label: "Update the child's profile", hint: "Preferred name, photo, participation, and (when the policy collects it) date of birth." },
  { key: "register", label: "Register for events", hint: "Sign the child up, cancel, and add event-specific details like an emergency contact." },
  { key: "sign_forms", label: "Permission forms", hint: "Give, decline, or withdraw permission for events." },
  { key: "media_consent", label: "Photo consent", hint: "Decide whether photos may appear in member galleries." },
  { key: "view_progress", label: "See learning progress", hint: "Summaries only (verses practiced, activities finished): never answers, journals, or reflections." },
  { key: "practice", label: "Practice with the child", hint: "Run memory verse practice and Learn & Play activities that are recorded for the child." },
  { key: "manage_account", label: "Youth account", hint: "Invite the child to their own account and authorize it, when the church's policy allows." },
  { key: "receive_updates", label: "Receive updates", hint: "Youth announcements, reminders, and registration updates." },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type Permissions = Record<PermissionKey, boolean>;

export const RELATIONSHIPS: Record<string, string> = {
  parent: "Parent",
  legal_guardian: "Legal guardian",
  caregiver: "Caregiver",
};

export const VERIFICATION_METHODS: Record<string, string> = {
  in_person: "Confirmed in person",
  known_to_staff: "Known to church staff",
  church_records: "Church records",
  other: "Other (described offline)",
};

export const RESTRICTION_REASONS: Record<string, string> = {
  disputed_relationship: "Disputed relationship",
  safeguarding: "Safeguarding concern",
  other: "Other",
};

type State = { label: string; tone: BadgeTone };

export const GUARDIAN_STATUS: Record<string, State> = {
  pending: { label: "Waiting for review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  suspended: { label: "Paused", tone: "danger" },
  revoked: { label: "Ended (revoked)", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
};

export const REQUEST_STATUS: Record<string, State> = {
  pending: { label: "Waiting for review", tone: "warning" },
  approved: { label: "Reviewed", tone: "success" },
  declined: { label: "Reviewed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const CONSENT_STATE: Record<string, State & { help: string }> = {
  granted: { label: "Permission given", tone: "success", help: "A verified guardian gave permission for the current version of this form." },
  needed: { label: "Needs a decision", tone: "warning", help: "No current decision from a verified guardian yet." },
  renewal_needed: { label: "Needs renewed permission", tone: "warning", help: "The form changed in a way that matters since permission was given. Please review it again." },
  declined: { label: "Permission declined", tone: "danger", help: "A verified guardian declined." },
  withdrawn: { label: "Permission withdrawn", tone: "danger", help: "Permission was withdrawn. The record of the earlier decision is kept." },
};

export const MEDIA_STATE: Record<string, State & { help: string }> = {
  granted: { label: "Allowed", tone: "success", help: "Photos may appear in member and group galleries inside the app." },
  declined: { label: "Not allowed", tone: "danger", help: "Photos that include this child won't be published." },
  withdrawn: { label: "Withdrawn", tone: "danger", help: "Permission was withdrawn. Photos already published are hidden for review." },
  unknown: { label: "No decision yet", tone: "warning", help: "Until a guardian decides, photos that include this child aren't published." },
  conflict: { label: "Guardians disagree", tone: "danger", help: "Verified guardians made different decisions, so photos aren't published until it's resolved." },
};

export const REGISTRATION_STATUS: Record<string, State> = {
  confirmed: { label: "Registered", tone: "success" },
  waitlisted: { label: "On the waitlist", tone: "warning" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export const CANCEL_REASONS: Record<string, string> = {
  guardian: "Canceled by a guardian",
  youth: "Canceled by the youth",
  staff: "Canceled by staff",
  consent_withdrawn: "Canceled because permission was declined or withdrawn",
  ineligible: "Canceled because the child is no longer in this group",
};

export const REPORT_REASONS: Record<string, string> = {
  unsafe: "Something unsafe",
  bullying: "Bullying or unkindness",
  inappropriate: "Inappropriate content",
  private_contact: "Someone asked to talk privately",
  other: "Something else",
};

export const POLICY_SETTINGS: Array<{
  key: string;
  label: string;
  hint: string;
  kind: "boolean" | "number" | "text" | "select";
  options?: Array<[string, string]>;
}> = [
  { key: "independent_accounts", label: "Allow independent youth accounts", hint: "Invitation only, after a family administrator confirms eligibility. Needs the eligibility rule below.", kind: "boolean" },
  { key: "eligibility_rule", label: "Who is eligible for an independent account", hint: "The church's own words, shown to staff and families. Required to allow independent accounts.", kind: "text" },
  { key: "minimum_age_years", label: "Minimum age in years (optional)", hint: "Only if the church sets one. When set, a recorded date of birth is required and checked; nothing is assumed without it.", kind: "number" },
  { key: "guardian_authorization_required", label: "A verified guardian must authorize each youth account", hint: "Recommended.", kind: "boolean" },
  { key: "multiple_guardians", label: "Allow more than one verified guardian per child", hint: "Each guardian is still verified separately, with their own permissions.", kind: "boolean" },
  { key: "birth_date_required", label: "Collect a date of birth for child profiles", hint: "Kept private to family administrators and guardians allowed to manage the profile.", kind: "boolean" },
  { key: "youth_rsvp", label: "Let independent youth register themselves", hint: "Only for events that need no permission form or extra details.", kind: "boolean" },
  { key: "youth_discussions", label: "Allow supervised group discussions", hint: "Leaders start discussions; youth reply. Always visible to the group's leaders.", kind: "boolean" },
  { key: "discussion_min_leaders", label: "Leaders required before a discussion can be used", hint: "1 to 5. Posting stops if a group drops below this.", kind: "number" },
  { key: "guardian_discussion_access", label: "Guardians' access to discussions", hint: "Whether verified guardians (who receive updates) can read their child's group discussions.", kind: "select", options: [["none", "No access"], ["read", "Can read"]] },
  { key: "group_prayer", label: "Allow moderated group prayer threads", hint: "Needs supervised discussions. Confidential youth care is not offered in the app.", kind: "boolean" },
  { key: "progress_sharing", label: "Learning progress sharing for independent youth", hint: "The youth chooses whether guardians see summaries.", kind: "select", options: [["off", "Off"], ["youth_choice", "The youth chooses"]] },
  { key: "public_media_consent", label: "Record consent for public use of photos", hint: "Websites, social media, banners. Separate from member galleries; the app itself never publishes photos publicly.", kind: "boolean" },
  { key: "adult_transition", label: "Allow reviewed transition to adult access", hint: "A family administrator starts it, the youth confirms, a second person completes it.", kind: "boolean" },
  { key: "logistics_retention_days", label: "Delete event logistics this many days after an event (optional)", hint: "7 to 3650. Empty keeps them until someone deletes them.", kind: "number" },
];

export function formatWhen(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || "America/Chicago",
  }).format(new Date(iso));
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}
