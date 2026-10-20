import "server-only";
import { z } from "zod";
import { PERMISSIONS, POLICY_SETTINGS } from "./format";

/**
 * Every Youth & Families form posts one operation name plus its fields. The
 * table below turns the fields into a database call; the database checks the
 * caller's relationship, capability, and the church policy on every call.
 * Validation here only catches obvious mistakes early and never decides
 * access. Nothing in this file logs field values.
 */
const uuid = z.uuid();

export class Fields {
  constructor(private readonly fd: FormData) {}
  id(name: string): string | null {
    return uuid.safeParse(this.fd.get(name)).data ?? null;
  }
  text(name: string, max = 5000): string {
    return String(this.fd.get(name) ?? "").slice(0, max);
  }
  trimmed(name: string, max = 5000): string {
    return this.text(name, max).trim();
  }
  bool(name: string): boolean {
    const v = this.fd.get(name);
    return v === "on" || v === "true" || v === "1";
  }
  all(name: string): string[] {
    return this.fd.getAll(name).map(String);
  }
  date(name: string): string | null {
    const v = this.trimmed(name, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
}

export type Op = {
  fn: string;
  /** Named arguments for supabase.rpc, or a message when the input is incomplete. */
  args: (f: Fields) => Record<string, unknown> | string;
  success: string | ((data: unknown) => string);
  /** Values echoed back to the form (e.g. a one-time code). */
  values?: (data: unknown) => Record<string, string>;
  /** Where to go next (server redirect) after success. */
  next?: (data: unknown, f: Fields) => string | null;
};

const permissions = (f: Fields) => Object.fromEntries(PERMISSIONS.map((p) => [p.key, f.bool(`perm_${p.key}`)]));

function policySettings(f: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of POLICY_SETTINGS) {
    if (s.kind === "boolean") out[s.key] = f.bool(s.key);
    else if (s.kind === "number") {
      const v = f.trimmed(s.key, 10);
      out[s.key] = v === "" ? null : Number(v);
    } else out[s.key] = f.trimmed(s.key, 2000);
  }
  return out;
}

const need = (...vals: unknown[]) => vals.every((v) => v !== null && v !== "");

export const OPS: Record<string, Op> = {
  // --- Guardians -----------------------------------------------------------
  request: {
    fn: "youth_guardian_request",
    args: (f) => {
      const p = { kind: f.text("kind", 20), child_name: f.trimmed("child_name", 60), relationship: f.text("relationship", 20), details: f.trimmed("details", 500), birth_date: f.date("birth_date") ?? "" };
      return p.child_name ? { p } : "Enter the child's preferred name.";
    },
    success: "Request sent. The church office will review it in person; nothing changes until it's verified.",
    next: () => "/youth/family?sent=1",
  },
  request_withdraw: { fn: "youth_guardian_request_withdraw", args: (f) => ({ p_id: f.id("id") }), success: "Request withdrawn." },
  child_save: {
    fn: "youth_child_save",
    args: (f) => {
      const p: Record<string, unknown> = { display_name: f.trimmed("display_name", 60), participation: f.text("participation", 10) };
      if (f.text("has_birth_date", 1) === "1") p.birth_date = f.date("birth_date") ?? "";
      return { p_child: f.id("child"), p };
    },
    success: "Saved.",
  },
  leave_group: { fn: "youth_unenroll", args: (f) => ({ p_group: f.id("group"), p_child: f.id("child") }), success: "Removed from the group. Upcoming registrations for its events were canceled." },
  consent: {
    fn: "youth_consent_submit",
    args: (f) => ({ p_series: f.id("series"), p_child: f.id("child"), p_version: f.id("version"), p: { decision: f.text("decision", 10), agree: f.bool("agree") } }),
    success: (d) => ((d as { state?: string })?.state === "granted" ? "Permission recorded." : "Your decision was recorded."),
  },
  consent_withdraw: { fn: "youth_consent_withdraw", args: (f) => ({ p_consent: f.id("id") }), success: "Permission withdrawn. The child's place for this event was released." },
  logistics: {
    fn: "youth_logistics_save",
    args: (f) => ({
      p_series: f.id("series"),
      p_child: f.id("child"),
      p: { emergency_name: f.trimmed("emergency_name", 120), emergency_phone: f.trimmed("emergency_phone", 40), pickup_note: f.trimmed("pickup_note", 500), accommodation_note: f.trimmed("accommodation_note", 500) },
    }),
    success: "Event details saved. Only the people staffing this event can see them.",
  },
  register: {
    fn: "youth_child_register",
    args: (f) => ({ p_occurrence: f.id("occurrence"), p_child: f.id("child") }),
    success: (d) => {
      const r = d as { status?: string; position?: number; already?: boolean };
      if (r?.already) return "Already registered.";
      return r?.status === "waitlisted" ? `Added to the waitlist (number ${r.position ?? "?"}).` : "Registered.";
    },
  },
  cancel: { fn: "youth_child_cancel", args: (f) => ({ p_occurrence: f.id("occurrence"), p_child: f.id("child") }), success: "Registration canceled." },
  media_consent: {
    fn: "youth_media_consent_set",
    args: (f) => ({ p_child: f.id("child"), p: { scope: f.text("scope", 20), decision: f.text("decision", 10), series_id: f.id("series") ?? "" } }),
    success: "Photo consent decision recorded.",
  },
  media_withdraw: { fn: "youth_media_consent_withdraw", args: (f) => ({ p_id: f.id("id") }), success: "Photo consent withdrawn. Published photos are hidden for review." },
  invite: {
    fn: "youth_account_invite",
    args: (f) => (f.trimmed("email", 254) ? { p_child: f.id("child"), p_email: f.trimmed("email", 254) } : "Enter the youth's own email address."),
    success: "Invitation created. Give the code to the youth in person; it is shown only once.",
    values: (d) => ({ code: String((d as { code?: string })?.code ?? ""), expires_at: String((d as { expires_at?: string })?.expires_at ?? "") }),
  },
  authorize: { fn: "youth_account_authorize", args: (f) => ({ p_invitation: f.id("invitation") }), success: "Authorized. The youth can now finish activating their account." },
  invite_revoke: { fn: "youth_account_invite_revoke", args: (f) => ({ p_invitation: f.id("invitation") }), success: "Invitation revoked." },
  card_add: { fn: "youth_child_card_add", args: (f) => ({ p_child: f.id("child"), p_item: f.id("item") }), success: "Added to their verses." },

  // --- Independent youth ---------------------------------------------------
  rsvp: {
    fn: "youth_rsvp",
    args: (f) => ({ p_occurrence: f.id("occurrence") }),
    success: (d) => ((d as { status?: string })?.status === "waitlisted" ? "You're on the waitlist." : "You're registered."),
  },
  rsvp_cancel: { fn: "youth_child_cancel", args: (f) => ({ p_occurrence: f.id("occurrence"), p_child: f.id("child") }), success: "Registration canceled." },
  sharing: { fn: "youth_progress_sharing_set", args: (f) => ({ p_on: f.text("on", 5) === "true" }), success: "Your sharing choice was saved." },
  transition_confirm: { fn: "youth_transition_confirm", args: (f) => ({ p_id: f.id("id"), p_confirm: f.trimmed("confirm", 40) }), success: "Thanks. The church office will complete the change." },

  // --- Discussions -----------------------------------------------------------
  discussion_create: {
    fn: "youth_discussion_create",
    args: (f) => ({ p_group: f.id("group"), p: { title: f.trimmed("title", 160), body: f.trimmed("body", 4000), kind: f.text("kind", 20) || "discussion" } }),
    success: "Discussion started.",
    next: (d) => `/youth/discussions/${(d as { id: string }).id}`,
  },
  post: {
    fn: "youth_post",
    args: (f) => (f.trimmed("body", 4000) ? { p_discussion: f.id("discussion"), p_body: f.trimmed("body", 4000), p_client_key: f.id("client_key") } : "Write a message first."),
    success: "Posted.",
  },
  post_delete: { fn: "youth_post_delete", args: (f) => ({ p_id: f.id("id") }), success: "Deleted." },
  report: {
    fn: "youth_report",
    args: (f) => ({ p_discussion: f.id("discussion"), p_post: f.id("post"), p: { reason: f.text("reason", 30), note: f.trimmed("note", 500) } }),
    success: "Thank you. A safeguarding reviewer will look at this. The person you reported isn't told who reported it.",
  },
  moderate: { fn: "youth_moderate", args: (f) => ({ p_target: f.text("target", 20), p_id: f.id("id"), p_action: f.text("action", 20) }), success: "Done." },
  report_resolve: { fn: "youth_report_resolve", args: (f) => ({ p_id: f.id("id"), p: { outcome: f.text("outcome", 20), hide: f.bool("hide") } }), success: "Report resolved." },

  // --- Leaders ---------------------------------------------------------------
  announcement_save: {
    fn: "youth_announcement_save",
    args: (f) => ({
      p_id: f.id("id"),
      p: { group_id: f.id("group") ?? "", title: f.trimmed("title", 160), body: f.text("body", 5000), to_youth: f.bool("to_youth"), to_guardians: f.bool("to_guardians") },
    }),
    success: "Draft saved.",
  },
  announcement_publish: { fn: "youth_announcement_publish", args: (f) => ({ p_id: f.id("id"), p_publish_at: null }), success: "Published." },
  announcement_archive: { fn: "youth_announcement_archive", args: (f) => ({ p_id: f.id("id") }), success: "Archived." },
  learning_assign: {
    fn: "youth_learning_assign",
    args: (f) => {
      const [kind, ref] = f.text("ref", 80).split(":");
      return need(f.id("group"), ref) ? { p_group: f.id("group"), p: { kind, ref_id: ref, note: f.trimmed("note", 300), starts_on: f.date("starts_on") ?? "", ends_on: f.date("ends_on") ?? "" } } : "Choose what to assign.";
    },
    success: "Assigned.",
  },
  learning_archive: { fn: "youth_learning_archive", args: (f) => ({ p_id: f.id("id") }), success: "Removed from the group." },
  enroll: { fn: "youth_enroll", args: (f) => ({ p_group: f.id("group"), p_child: f.id("child") }), success: "Enrolled." },
  unenroll: { fn: "youth_unenroll", args: (f) => ({ p_group: f.id("group"), p_child: f.id("child") }), success: "Removed from the group." },

  // --- Administration --------------------------------------------------------
  policy_save: {
    fn: "youth_admin_policy_save",
    args: (f) => ({ p_id: f.id("id"), p: { title: f.trimmed("title", 160), body: f.text("body", 20000), settings: policySettings(f) } }),
    success: "Draft saved. Someone else with policy rights must approve it.",
  },
  policy_approve: {
    fn: "youth_admin_policy_approve",
    args: (f) => ({ p_id: f.id("id"), p_confirm: f.trimmed("confirm", 40), p_reference: f.trimmed("reference", 300) }),
    success: "Policy approved. It applies now; the previous version is retired.",
  },
  policy_discard: { fn: "youth_admin_policy_discard", args: (f) => ({ p_id: f.id("id") }), success: "Draft discarded." },
  request_decide: {
    fn: "youth_admin_request_decide",
    args: (f) => ({
      p_id: f.id("id"),
      p: { decision: f.text("decision", 10), child_id: f.id("child_id") ?? "", display_name: f.trimmed("display_name", 60), verification_method: f.text("verification_method", 30), permissions: permissions(f) },
    }),
    success: (d) => ((d as { status?: string })?.status === "approved" ? "Verified. The guardian can now see this child with the permissions you chose." : "Request declined."),
  },
  admin_child_save: {
    fn: "youth_admin_child_save",
    args: (f) => {
      const p: Record<string, unknown> = { display_name: f.trimmed("display_name", 60), participation: f.text("participation", 10) || "active" };
      if (f.text("has_birth_date", 1) === "1") p.birth_date = f.date("birth_date") ?? "";
      return p.display_name ? { p_id: f.id("id"), p } : "Enter a preferred name.";
    },
    success: "Saved.",
    next: (d, f) => (f.id("id") ? null : `/admin/youth/families/children/${(d as { id: string }).id}`),
  },
  guardian_update: {
    fn: "youth_admin_guardian_update",
    args: (f) => ({ p_id: f.id("id"), p: { status: f.text("status", 20), verification_method: f.text("verification_method", 30), permissions: permissions(f) } }),
    success: "Guardianship updated.",
  },
  child_restrict: {
    fn: "youth_admin_child_restrict",
    args: (f) => ({ p_id: f.id("id"), p_on: f.text("on", 5) === "true", p_reason: f.text("reason", 40) || null }),
    success: "Saved.",
  },
  child_archive: { fn: "youth_admin_child_archive", args: (f) => ({ p_id: f.id("id"), p_confirm: f.trimmed("confirm", 20) }), success: "Child profile archived." },
  eligibility: { fn: "youth_admin_eligibility_set", args: (f) => ({ p_child: f.id("child"), p_independent: f.text("independent", 5) === "true" }), success: "Eligibility recorded under the current policy." },
  transition_start: {
    fn: "youth_admin_transition_start",
    args: (f) => ({ p_child: f.id("child"), p: { eligibility_confirmed: f.bool("eligibility_confirmed"), identity_confirmed: f.bool("identity_confirmed") } }),
    success: "Transition started. The youth confirms from their account; then a second person completes it.",
  },
  transition_complete: { fn: "youth_admin_transition_complete", args: (f) => ({ p_id: f.id("id"), p_confirm: f.trimmed("confirm", 40) }), success: "Transition completed." },
  transition_cancel: { fn: "youth_admin_transition_cancel", args: (f) => ({ p_id: f.id("id") }), success: "Transition canceled." },
  group_save: {
    fn: "youth_admin_group_save",
    args: (f) => ({ p_id: f.id("id"), p: { name: f.trimmed("name", 80), description: f.trimmed("description", 1000) } }),
    success: "Group saved.",
    next: (d, f) => (f.id("id") ? null : `/admin/youth/groups/${(d as { id: string }).id}`),
  },
  group_archive: { fn: "youth_admin_group_archive", args: (f) => ({ p_id: f.id("id"), p_on: f.text("on", 5) === "true" }), success: "Saved." },
  leader_set: {
    fn: "youth_admin_leader_set",
    args: (f) => ({
      p_group: f.id("group"),
      p_profile: f.id("profile"),
      p: { role: f.text("role", 10) || "leader", can_publish: f.bool("can_publish"), can_manage_enrollment: f.bool("can_manage_enrollment"), status: f.text("status", 10) || "active" },
    }),
    success: "Leader assignment saved.",
  },
  form_save: { fn: "youth_admin_form_save", args: (f) => ({ p_id: f.id("id"), p: { title: f.trimmed("title", 160), status: f.text("status", 10) || "active" } }), success: "Form saved." },
  form_draft: {
    fn: "youth_admin_form_draft",
    args: (f) => ({ p_form: f.id("form"), p: { body: f.text("body", 20000), statement: f.trimmed("statement", 1000), material: f.text("material", 5) !== "false", change_summary: f.trimmed("change_summary", 500) } }),
    success: "Draft version saved.",
  },
  form_publish: {
    fn: "youth_admin_form_publish",
    args: (f) => ({ p_version: f.id("version"), p_confirm: f.trimmed("confirm", 20) }),
    success: (d) => {
      const r = d as { renewals_needed?: number; material?: boolean };
      return r?.material && r.renewals_needed ? `Published. Guardians of ${r.renewals_needed} registered ${r.renewals_needed === 1 ? "child were" : "children were"} asked to review it again.` : "Published.";
    },
  },
  event_set: {
    fn: "youth_admin_event_set",
    args: (f) => ({
      p_series: f.id("series"),
      p: {
        group_id: f.id("group") ?? "",
        youth_rsvp: f.bool("youth_rsvp"),
        collect_emergency_contact: f.bool("collect_emergency_contact"),
        collect_pickup: f.bool("collect_pickup"),
        collect_accommodation: f.bool("collect_accommodation"),
        form_ids: f.all("form_ids").filter((v) => uuid.safeParse(v).success),
      },
    }),
    success: "Youth event settings saved.",
  },
  event_unset: { fn: "youth_admin_event_unset", args: (f) => ({ p_series: f.id("series") }), success: "This draft is a members event again." },
  personnel: { fn: "youth_admin_personnel_set", args: (f) => ({ p_series: f.id("series"), p_profile: f.id("profile"), p_on: f.text("on", 5) === "true" }), success: "Event personnel updated." },
  event_fill: { fn: "youth_admin_event_fill", args: (f) => ({ p_occurrence: f.id("occurrence") }), success: (d) => `${Number(d) || 0} waitlisted ${Number(d) === 1 ? "child was" : "children were"} given a place.` },
  photo_subject: { fn: "youth_admin_photo_subject_set", args: (f) => ({ p_photo: f.id("photo"), p_child: f.id("child"), p_on: f.text("on", 5) === "true" }), success: "Photo associations updated." },
  review_resolve: { fn: "youth_admin_photo_review_resolve", args: (f) => ({ p_review: f.id("id"), p_outcome: f.text("outcome", 20) }), success: "Review resolved." },
  reuse: {
    fn: "youth_admin_media_reuse",
    args: (f) => ({ p_photo: f.id("photo"), p: f.id("remove") ? { remove: f.id("remove") } : { kind: f.text("kind", 20), location: f.trimmed("location", 300) } }),
    success: "Saved.",
  },
};
