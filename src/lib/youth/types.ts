import type { Permissions } from "./format";

export type YouthMe =
  | { kind: "youth"; child_id: string; display_name: string; groups: number }
  | { kind: "youth_inactive" | "none" }
  | {
      kind: "adult";
      guardian_of: number;
      paused_guardianships: number;
      pending_requests: number;
      leads: number;
      personnel: number;
      caps: string[];
    };

export type GroupRef = { id: string; name: string };

export type FormStateRow = { form_id: string; title: string; version_id: string | null; version: number | null; state: string; consent_id: string | null };

export type ChildEvent = {
  occurrence_id: string;
  series_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location_name: string | null;
  status: string;
  group: string | null;
  rsvp_enabled: boolean;
  closes_at: string;
  registration_open: boolean;
  places_left: number | null;
  waitlist_enabled: boolean;
  registration: { status: string; source: string; cancel_reason: string | null; position: number | null } | null;
  forms: FormStateRow[];
  collects: { emergency_contact: boolean; pickup: boolean; accommodation: boolean };
  logistics_on_file: boolean;
  youth_rsvp: boolean;
  needs_guardian?: boolean;
};

export type FamilyChild = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  participation: string;
  groups: GroupRef[];
  account_linked: boolean;
  relationship: string;
  permissions: Permissions;
  outstanding_forms: number;
  upcoming: number;
};

export type Announcement = {
  id: string;
  group_id: string | null;
  group: string | null;
  title: string;
  body: string;
  to_youth: boolean;
  to_guardians: boolean;
  status: string;
  publish_at: string | null;
  author: string | null;
};

export type Learning = {
  id: string;
  group_id: string;
  kind: "memory_collection" | "reading_plan" | "resource";
  title: string | null;
  note: string;
  starts_on: string | null;
  ends_on: string | null;
  href: string | null;
};

export type Audience = { leaders: string[]; youth: number; guardians_can_read: boolean };
