"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deliverCommunityNow } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { CARE_LIMITS } from "@/lib/prayer/format";
import { getChurchSettings } from "@/lib/settings/queries";
import { zonedLocalToUtc } from "@/lib/time";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Practical care actions (requester, care team, volunteers). The database
 * decides who may do what; these validate input, keep drafts on failure,
 * and never log or echo request details.
 */
const UNAVAILABLE = "Care requests are unavailable right now. Nothing was changed.";
const uuid = z.uuid();
const ymd = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")]).transform((v) => v || null);

function deliverLater() {
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
}

function fieldErrorsOf(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const i of error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
  return fieldErrors;
}

const careSchema = z.object({
  kind: z.enum(["meal", "transportation", "visit", "other"], { message: "Choose the kind of help you need." }),
  summary: z.string().trim().min(3, "Describe the need in a few words.").max(CARE_LIMITS.summary, `Keep it to ${CARE_LIMITS.summary} characters.`),
  details: z.string().trim().max(CARE_LIMITS.details, `Keep the details to ${CARE_LIMITS.details.toLocaleString()} characters.`),
  neededOn: ymd,
  neededUntil: ymd,
  contactMethod: z.enum(["app", "phone", "email"], { message: "Choose how the care team should contact you." }),
  contactNote: z.string().trim().max(CARE_LIMITS.contactNote, `Keep it to ${CARE_LIMITS.contactNote} characters.`),
});

export async function createCareAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/prayer/care/new");
  const values = Object.fromEntries(
    ["kind", "summary", "details", "neededOn", "neededUntil", "contactMethod", "contactNote"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const parsed = careSchema.safeParse(values);
  if (!parsed.success) return errorState("Please correct the highlighted fields.", { fieldErrors: fieldErrorsOf(parsed.error), values });
  const d = parsed.data;
  if (d.neededOn && d.neededUntil && d.neededUntil < d.neededOn) {
    return errorState("Please correct the highlighted fields.", { fieldErrors: { neededUntil: ["The end date must be on or after the start date."] }, values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("care_request_create", {
    p_kind: d.kind,
    p_summary: d.summary,
    p_details: d.details,
    p_needed_on: d.neededOn,
    p_needed_until: d.neededUntil,
    p_contact_method: d.contactMethod,
    p_contact_note: d.contactNote || null,
    p_consent: formData.get("consent") === "on",
    p_client_key: uuid.safeParse(formData.get("clientKey")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error, "Your request couldn't be sent. Your text is still here; please try again."), { values });
  revalidatePath("/prayer/care");
  redirect(`/prayer/care/${data as string}?sent=1`);
}

/** Requester ↔ care team messages (either side). */
export async function careMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/care");
  const body = String(formData.get("body") ?? "");
  if (!id) return errorState("That care request wasn't found.", { values: { body } });
  const parsed = z.string().trim().min(1, "Write a message first.").max(CARE_LIMITS.message).safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { error } = await supabase.rpc("care_message", { p_id: id, p_body: parsed.data });
  if (error) return errorState(dbErrorMessage(error, "Your message couldn't be sent. Your text is still here."), { values: { body } });
  revalidatePath(`/prayer/care/${id}`);
  revalidatePath(`/prayer/team/care/${id}`);
  deliverLater();
  return { status: "success", message: "Message sent." };
}

export async function withdrawCareAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/care");
  if (!id) return errorState("That care request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_request_withdraw", { p_id: id });
  if (error) return errorState(dbErrorMessage(error, "The request couldn't be withdrawn."));
  revalidatePath(`/prayer/care/${id}`);
  deliverLater();
  return { status: "success", message: "Your request is withdrawn and closed." };
}

export async function consentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/care");
  if (!id) return errorState("That care request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const on = formData.get("on") === "true";
  const { error } = await supabase.rpc("care_set_consent", { p_id: id, p_consent: on });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  revalidatePath(`/prayer/care/${id}`);
  return { status: "success", message: on ? "Thank you. Accepted volunteers can now see the details the care team shares." : "Volunteers no longer see your name or the logistics." };
}

export async function volunteerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("opportunityId")).data;
  await requireApprovedMember("/prayer/serve");
  if (!id) return errorState("That opportunity wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const on = formData.get("on") === "true";
  const note = String(formData.get("note") ?? "").slice(0, 300);
  const { error } = await supabase.rpc("care_volunteer", { p_id: id, p_on: on, p_note: note || null });
  if (error) return errorState(dbErrorMessage(error, "That didn't work. Please try again."));
  revalidatePath(`/prayer/serve/${id}`);
  revalidatePath("/prayer/serve");
  return { status: "success", message: on ? "Thank you for offering. A coordinator will confirm." : "You've withdrawn your offer." };
}

// ---------------------------------------------------------------------------
// Care team
// ---------------------------------------------------------------------------
function refreshTeam(id: string) {
  revalidatePath(`/prayer/team/care/${id}`);
  revalidatePath("/prayer/team");
}

export async function teamUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  if (!id) return errorState("That care request wasn't found.");
  const followUp = ymd.safeParse(String(formData.get("followUpOn") ?? ""));
  if (!followUp.success) return errorState("Use a valid follow-up date.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_team_update", {
    p_id: id,
    p_status: String(formData.get("status") ?? ""),
    p_follow_up_on: followUp.data,
    p_closed_reason: String(formData.get("closedReason") ?? "") || null,
  });
  if (error) return errorState(dbErrorMessage(error, "The request couldn't be updated."));
  refreshTeam(id);
  deliverLater();
  return { status: "success", message: "Saved." };
}

export async function assignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  if (!id) return errorState("That care request wasn't found.");
  const assignee = uuid.safeParse(formData.get("assignee")).data ?? null;
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_team_assign", { p_id: id, p_assignee: assignee });
  if (error) return errorState(dbErrorMessage(error, "The assignment couldn't be saved."));
  refreshTeam(id);
  deliverLater();
  return { status: "success", message: assignee ? "Assigned." : "Unassigned." };
}

export async function noteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  const body = String(formData.get("body") ?? "");
  if (!id) return errorState("That care request wasn't found.", { values: { body } });
  const parsed = z.string().trim().min(1, "Write a note first.").max(CARE_LIMITS.note, `Keep notes to ${CARE_LIMITS.note} characters.`).safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { error } = await supabase.rpc("care_team_note", { p_id: id, p_body: parsed.data });
  if (error) return errorState(dbErrorMessage(error, "The note couldn't be saved."), { values: { body } });
  refreshTeam(id);
  return { status: "success", message: "Note added." };
}

const opportunitySchema = z.object({
  title: z.string().trim().min(3, "Describe the task in a few words.").max(CARE_LIMITS.oppTitle),
  details: z.string().trim().max(CARE_LIMITS.oppDetails, `Keep it to ${CARE_LIMITS.oppDetails} characters.`),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time."),
  endTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/, "Use a valid end time.")]),
  helpers: z.coerce.number().int().min(1, "At least one helper.").max(20, "Up to 20 helpers."),
  audience: z.enum(["church", "group", "team"]),
  logistics: z.string().trim().max(CARE_LIMITS.logistics, `Keep it to ${CARE_LIMITS.logistics} characters.`),
});

export async function opportunitySaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const careId = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  const values = Object.fromEntries(
    ["opportunityId", "title", "details", "date", "time", "endTime", "helpers", "audience", "groupId", "logistics"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  values.shareName = formData.get("shareName") === "on" ? "on" : "";
  if (!careId) return errorState("That care request wasn't found.", { values });
  const parsed = opportunitySchema.safeParse(values);
  if (!parsed.success) return errorState("Please correct the highlighted fields.", { fieldErrors: fieldErrorsOf(parsed.error), values });
  const d = parsed.data;
  const { settings } = await getChurchSettings();
  const startsAt = zonedLocalToUtc(`${d.date}T${d.time}`, settings.timezone);
  const endsAt = d.endTime ? zonedLocalToUtc(`${d.date}T${d.endTime}`, settings.timezone) : null;
  if (!startsAt || (d.endTime && !endsAt)) return errorState("Use a valid date and time.", { values });
  if (endsAt && endsAt <= startsAt) return errorState("The end time must be after the start time.", { fieldErrors: { endTime: ["End after the start."] }, values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("care_opportunity_save", {
    p: {
      id: uuid.safeParse(values.opportunityId).data ?? null,
      care_id: careId,
      title: d.title,
      details: d.details,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() ?? null,
      helpers_needed: d.helpers,
      audience: d.audience,
      group_id: d.audience === "group" ? (uuid.safeParse(values.groupId).data ?? null) : null,
      logistics: d.logistics,
      share_name: values.shareName === "on",
    },
  });
  if (error) return errorState(dbErrorMessage(error, "The opportunity couldn't be saved."), { values });
  refreshTeam(careId);
  return { status: "success", message: "Saved as a draft. Review the preview before publishing." };
}

export async function opportunityPublishAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("opportunityId")).data;
  const careId = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  if (!id || !careId) return errorState("That opportunity wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_opportunity_publish", { p_id: id, p_confirm: formData.get("confirm") === "on" });
  if (error) return errorState(dbErrorMessage(error, "The opportunity couldn't be published."));
  refreshTeam(careId);
  revalidatePath("/prayer/serve");
  return { status: "success", message: "Published to eligible volunteers." };
}

export async function opportunityStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("opportunityId")).data;
  const careId = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  if (!id || !careId) return errorState("That opportunity wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_opportunity_status", { p_id: id, p_status: String(formData.get("status") ?? "") });
  if (error) return errorState(dbErrorMessage(error, "The opportunity couldn't be updated."));
  refreshTeam(careId);
  revalidatePath("/prayer/serve");
  return { status: "success", message: "Updated." };
}

export async function signupDecideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const opp = uuid.safeParse(formData.get("opportunityId")).data;
  const profile = uuid.safeParse(formData.get("profileId")).data;
  const careId = uuid.safeParse(formData.get("careId")).data;
  await requireApprovedMember("/prayer/team");
  if (!opp || !profile || !careId) return errorState("That volunteer wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("care_signup_decide", { p_opportunity: opp, p_profile: profile, p_action: String(formData.get("decision") ?? "") });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  refreshTeam(careId);
  deliverLater();
  return { status: "success", message: "Saved." };
}
