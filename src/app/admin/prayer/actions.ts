"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedMember, requireCapability } from "@/lib/auth/viewer";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer moderation and settings. Scope is decided by the database: prayer
 * moderators act only on reported items (team-audience items also need
 * confidential access) or on requests they could read anyway.
 */
const UNAVAILABLE = "Prayer moderation is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

export async function prayerModAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/admin/prayer");
  const type = String(formData.get("type") ?? "");
  const id = uuid.safeParse(formData.get("id")).data;
  const report = uuid.safeParse(formData.get("reportId")).data ?? null;
  const requestId = uuid.safeParse(formData.get("requestId")).data;
  if (!id || !["request", "comment"].includes(type)) return errorState("That item wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_mod_action", {
    p_type: type,
    p_id: id,
    p_action: String(formData.get("action") ?? ""),
    p_reason: String(formData.get("reason") ?? ""),
    p_report: report,
  });
  if (error) return errorState(dbErrorMessage(error, "That action couldn't be completed."));
  if (report) revalidatePath(`/admin/prayer/${report}`);
  if (requestId) revalidatePath(`/prayer/${requestId}`);
  revalidatePath("/prayer", "layout");
  return { status: "success", message: "Done. The author has been told, without your name." };
}

export async function prayerResolveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("reportId")).data;
  await requireApprovedMember("/admin/prayer");
  if (!id) return errorState("That report wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_mod_resolve", {
    p_id: id,
    p_status: String(formData.get("status") ?? ""),
    p_resolution: String(formData.get("resolution") ?? ""),
  });
  if (error) return errorState(dbErrorMessage(error, "The report couldn't be updated."));
  revalidatePath(`/admin/prayer/${id}`);
  revalidatePath("/admin/prayer");
  return { status: "success", message: "Report updated." };
}

const settingsSchema = z.object({
  guidance: z.string().trim().min(1, "Add some guidance for members.").max(4000),
  closedArchiveDays: z.coerce.number().int().min(7).max(3650),
  archivedDeleteDays: z.coerce.number().int().min(30).max(3650),
  careDeleteDays: z.coerce.number().int().min(30).max(3650),
  reportEvidenceDays: z.coerce.number().int().min(7).max(1095),
});

export async function prayerSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/settings");
  const values = Object.fromEntries(
    ["guidance", "closedArchiveDays", "archivedDeleteDays", "careDeleteDays", "reportEvidenceDays"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const enabled = formData.get("retentionEnabled") === "on";
  if (enabled && formData.get("policyConfirmed") !== "on") {
    return errorState("Confirm that the church has adopted this retention policy before turning on automatic deletion.", { values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const d = parsed.data;
  const { error } = await supabase.rpc("prayer_admin_save_settings", {
    p_guidance: d.guidance,
    p_retention_enabled: enabled,
    p_closed_archive_days: d.closedArchiveDays,
    p_archived_delete_days: d.archivedDeleteDays,
    p_care_delete_days: d.careDeleteDays,
    p_report_evidence_days: d.reportEvidenceDays,
  });
  if (error) return errorState(dbErrorMessage(error, "Settings couldn't be saved."), { values });
  revalidatePath("/admin/prayer/settings");
  revalidatePath("/prayer");
  return { status: "success", message: "Prayer settings saved." };
}
