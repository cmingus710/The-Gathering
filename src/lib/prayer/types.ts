import type { MentionRef } from "@/lib/community/mentions";

/** Shapes returned by the prayer_* and care_* database functions. */
export type Audience = "private" | "group" | "team" | "church";
export type RequestStatus = "open" | "answered" | "closed" | "archived";
export type ContentStatus = "visible" | "hidden" | "deleted";

export type PrayerCard = {
  id: string;
  title: string;
  excerpt: string;
  audience: Audience;
  group: { id: string; name: string } | null;
  status: RequestStatus;
  anonymous: boolean;
  /** "Anonymous" for anonymous requests; never an id. */
  author: string;
  mine: boolean;
  hidden: boolean;
  comments_open: boolean;
  created_at: string;
  published_at: string | null;
  last_activity_at: string;
  answered_at: string | null;
  prayer_count: number;
  praying: boolean;
  following: boolean;
  comment_count: number;
  update_count: number;
};

export type PrayerPage = { items: PrayerCard[]; has_more: boolean };

export type PrayerComment = {
  id: string;
  status: ContentStatus;
  body: string | null;
  author: string | null;
  is_requester: boolean;
  anonymous: boolean;
  mine: boolean;
  created_at: string;
  edited_at: string | null;
  /** People and groups mentioned (null when the text isn't shown); absent before migration 20261108000100. */
  mentions?: MentionRef[] | null;
};

export type PrayerUpdate = {
  id: string;
  kind: "update" | "answered";
  body: string;
  author: string;
  mine: boolean;
  created_at: string;
  edited_at: string | null;
};

export type PrayerDetail = PrayerCard & {
  body: string;
  /** People and groups mentioned in the request; absent before migration 20261108000100. */
  mentions?: MentionRef[];
  comments_enabled: boolean;
  mod_locked: boolean;
  edited_at: string | null;
  closed_at: string | null;
  archived_at: string | null;
  audience_changed_at: string | null;
  can_comment: boolean;
  can_pray: boolean;
  posting_restricted: boolean;
  updates: PrayerUpdate[];
  comments: PrayerComment[];
  comments_has_more: boolean;
  withheld: boolean;
  can_moderate: boolean;
  can_lookup: boolean;
  group_member: boolean;
};

export type PrayerGuidance = {
  guidance: string;
  is_team: boolean;
  can_moderate: boolean;
  can_coordinate: boolean;
  can_assign: boolean;
  posting_restricted: boolean;
};

export type GroupOption = { id: string; name: string };

export type PrayerReportRow = {
  id: string;
  target_type: "request" | "comment" | "update";
  reason: string;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  audience: Audience;
  created_at: string;
  reported: string;
};

export type PrayerReportDetail = PrayerReportRow & {
  target_id: string;
  details: string | null;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  reporter: string;
  reported_anonymous: boolean;
  evidence: { type: string; title?: string; body: string; author: string; created_at: string; edited_at: string | null } | null;
  evidence_cleared_at: string | null;
  request_exists: boolean;
  request_id: string | null;
  can_open: boolean;
  current: { hidden?: boolean; mod_locked?: boolean; status?: string; exists?: boolean } | null;
  can_lookup: boolean;
  log: { action: string; actor: string; reason: string | null; at: string }[];
};

export type LogRow = { action: string; actor: string; target_type: string; reason: string | null; at: string };

export type PrayerSettings = {
  guidance: string;
  retention_enabled: boolean;
  closed_archive_days: number;
  archived_delete_days: number;
  care_delete_days: number;
  report_evidence_days: number;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Care
// ---------------------------------------------------------------------------
export type CareKind = "meal" | "transportation" | "visit" | "other";
export type CareStatus = "submitted" | "in_review" | "coordinating" | "fulfilled" | "closed";
export type ContactMethod = "app" | "phone" | "email";

export type CareMessage = { id: string; body: string; from_team: boolean; author: string; mine: boolean; created_at: string };

export type MyCareRow = {
  id: string;
  kind: CareKind;
  summary: string;
  status: CareStatus;
  needed_on: string | null;
  created_at: string;
  updated_at: string;
  has_coordinator: boolean;
};

export type MyCareRequest = {
  id: string;
  kind: CareKind;
  summary: string;
  details: string;
  needed_on: string | null;
  needed_until: string | null;
  contact_method: ContactMethod;
  contact_note: string | null;
  status: CareStatus;
  closed_reason: string | null;
  coordinator: string | null;
  share_consent: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  messages: CareMessage[];
  opportunities: {
    id: string;
    title: string;
    starts_at: string;
    status: OpportunityStatus;
    helpers_needed: number;
    share_name: boolean;
    has_logistics: boolean;
    accepted_count: number;
  }[];
};

export type CareQueueRow = {
  id: string;
  kind: CareKind;
  summary: string;
  status: CareStatus;
  needed_on: string | null;
  needed_until: string | null;
  requester: string;
  assigned: string | null;
  assigned_me: boolean;
  follow_up_on: string | null;
  follow_up_due: boolean;
  created_at: string;
  updated_at: string;
};

export type CareQueue = {
  items: CareQueueRow[];
  counts: { unassigned: number; mine: number; due: number };
  can_assign: boolean;
};

export type OpportunityStatus = "draft" | "open" | "filled" | "completed" | "canceled";
export type SignupStatus = "offered" | "accepted" | "declined" | "withdrawn" | "completed";

export type OpportunityCard = {
  id: string;
  title: string;
  details: string;
  starts_at: string;
  ends_at: string | null;
  helpers_needed: number;
  status: OpportunityStatus;
  audience: "church" | "group" | "team";
  group_name: string | null;
  accepted_count: number;
  my_status: SignupStatus | null;
};

export type OpportunityPrivate = {
  consent: boolean;
  logistics: string | null;
  requester_first_name: string | null;
  coordinator: string | null;
};

export type OpportunityDetail = OpportunityCard & { can_volunteer: boolean; private?: OpportunityPrivate };

export type TeamOpportunity = OpportunityCard & {
  logistics: string;
  share_name: boolean;
  group_id: string | null;
  signups: { profile_id: string; name: string; status: SignupStatus; note: string | null; created_at: string }[];
};

export type TeamCareRequest = Omit<MyCareRequest, "coordinator" | "opportunities"> & {
  contact: string | null;
  requester: string;
  assigned: string | null;
  assigned_me: boolean;
  follow_up_on: string | null;
  consent_at: string | null;
  can_act: boolean;
  can_assign: boolean;
  can_read_notes: boolean;
  notes: { id: string; body: string; author: string; created_at: string }[] | null;
  activity: { action: string; actor: string | null; detail: Record<string, unknown>; assignee: string | null; at: string }[];
  opportunities: TeamOpportunity[];
};

export type OpportunityPreview = {
  listing: Omit<OpportunityCard, "my_status" | "accepted_count">;
  accepted: OpportunityPrivate;
  consent: boolean;
  blocked: boolean;
  status: OpportunityStatus;
};
