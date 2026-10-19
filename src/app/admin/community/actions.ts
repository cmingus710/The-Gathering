"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { deliverCommunityNow } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The community service is unavailable. Nothing was changed.";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

function done(message: string): FormState {
  revalidatePath("/admin/community", "layout");
  revalidatePath("/community", "layout");
  revalidatePath("/groups", "layout");
  return { status: "success", message };
}

export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community");
  const parsed = z
    .object({
      id: z.union([z.uuid(), z.literal("")]).optional(),
      name: z.string().trim().min(1, "Enter a name.").max(60),
      description: z.string().trim().max(300).default(""),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { name: [parsed.error.issues[0].message] } });
  const { error } = await rpc("community_admin_category_save", {
    p_id: parsed.data.id || null,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_active: parsed.data.id ? formData.get("active") === "on" : true,
    p_sort: null,
  });
  if (error) return errorState(dbErrorMessage(error));
  return done(parsed.data.id ? "Category saved." : "Category added at the end of the list.");
}

export async function moveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community");
  const id = z.uuid().safeParse(formData.get("id")).data;
  const dir = formData.get("direction") === "up" ? -1 : 1;
  if (!id) return errorState("That category wasn't found.");
  const { error } = await rpc("community_admin_category_move", { p_id: id, p_direction: dir });
  if (error) return errorState(dbErrorMessage(error));
  return done(dir < 0 ? "Moved up." : "Moved down.");
}

export async function saveGuidelinesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community");
  const text = String(formData.get("guidelines") ?? "");
  if (text.trim().length < 20) return errorState("The guidelines need at least a sentence or two.", { values: { guidelines: text } });
  const { error } = await rpc("community_admin_save_guidelines", { p_text: text, p_require_reack: formData.get("reack") === "on" });
  if (error) return errorState(dbErrorMessage(error), { values: { guidelines: text } });
  return done(formData.get("reack") === "on" ? "Guidelines saved. Members will be asked to accept them before posting again." : "Guidelines saved.");
}

export async function saveCommunitySettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community");
  const parsed = z
    .object({
      digestHour: z.coerce.number().int().min(0).max(23),
      weeklyDow: z.coerce.number().int().min(0).max(6),
      dmRetentionDays: z.coerce.number().int().min(30, "Keep messages at least 30 days.").max(3650),
      reportEvidenceDays: z.coerce.number().int().min(7, "Keep report evidence at least 7 days.").max(1095),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message);
  const { error } = await rpc("community_admin_save_settings", {
    p_digest_hour: parsed.data.digestHour,
    p_weekly_dow: parsed.data.weeklyDow,
    p_dm_retention_days: parsed.data.dmRetentionDays,
    p_report_evidence_days: parsed.data.reportEvidenceDays,
  });
  if (error) return errorState(dbErrorMessage(error));
  return done("Settings saved.");
}

export async function createGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community/groups");
  const values = { name: String(formData.get("name") ?? ""), summary: String(formData.get("summary") ?? "") };
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Enter a group name.").max(80),
      summary: z.string().trim().max(400),
      visibility: z.enum(["discoverable", "hidden"]),
      leaderId: z.uuid({ message: "Choose the group's first leader." }),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values });
  const { data, error } = await rpc("community_group_save", {
    p: {
      name: parsed.data.name,
      summary: parsed.data.summary,
      visibility: parsed.data.visibility,
      accepts_requests: parsed.data.visibility === "discoverable" && formData.get("acceptsRequests") === "on",
      leader_id: parsed.data.leaderId,
    },
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  done("");
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
  redirect(`/groups/${String(data)}/manage?created=1`);
}

export async function archiveGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community/groups");
  const id = z.uuid().safeParse(formData.get("groupId")).data;
  if (!id) return errorState("That group wasn't found.");
  const archive = formData.get("archive") === "true";
  const { error } = await rpc("community_group_archive", { p_group: id, p_archive: archive });
  if (error) return errorState(dbErrorMessage(error));
  return done(archive ? "Group archived. Its discussions are read-only and open invitations were withdrawn." : "Group restored.");
}

export async function setEligibilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.membersManage, "/admin/members");
  const parsed = z
    .object({ profileId: z.uuid(), eligible: z.enum(["true", "false"]), note: z.string().trim().max(300).default("") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That member wasn't found.");
  if (parsed.data.eligible === "true" && formData.get("confirmAdult") !== "on") {
    return errorState("Confirm that you've verified this person is an adult (18 or older).");
  }
  const { error } = await rpc("community_admin_set_dm_eligibility", {
    p_profile: parsed.data.profileId,
    p_eligible: parsed.data.eligible === "true",
    p_note: parsed.data.note || null,
  });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(`/admin/members/${parsed.data.profileId}`);
  return { status: "success", message: parsed.data.eligible === "true" ? "Direct messaging turned on (recorded in the audit log)." : "Direct messaging turned off (recorded in the audit log)." };
}
