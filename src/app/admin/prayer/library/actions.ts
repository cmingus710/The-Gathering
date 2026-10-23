"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireApprovedMember, requireCapability } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer Library moderation (prayer moderators) and categories (settings
 * managers). The database decides scope and records every action with its
 * reason; nothing here notifies anyone.
 */
const UNAVAILABLE = "The Prayer Library is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

function refresh(prayerId?: string | null, reportId?: string | null) {
  revalidatePath("/admin/prayer/library", "layout");
  revalidatePath("/prayer/library", "layout");
  if (prayerId) revalidatePath(`/prayer/library/${prayerId}`);
  if (reportId) revalidatePath(`/admin/prayer/library/${reportId}`);
}

export async function libraryModAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Moderators also act from the member page, so only membership is required here; the database requires prayer.moderate.
  await requireApprovedMember("/admin/prayer/library");
  const id = uuid.safeParse(formData.get("prayerId")).data;
  const report = uuid.safeParse(formData.get("reportId")).data ?? null;
  const action = String(formData.get("action") ?? "");
  if (!id || !["hide", "restore", "archive"].includes(action)) return errorState("That prayer wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_library_mod_action", { p_id: id, p_action: action, p_reason: String(formData.get("reason") ?? ""), p_report: report });
  if (error) return errorState(dbErrorMessage(error, "That action couldn't be completed."));
  refresh(id, report);
  // The button that was pressed goes away with the state it changed (and the
  // member page now reads "not found"), so confirm on the page that follows.
  redirect(report ? `/admin/prayer/library/${report}?done=${action}` : `/admin/prayer/library?done=${action}`);
}

export async function libraryResolveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("reportId")).data;
  await requireCapability(CAPABILITIES.prayerModerate, "/admin/prayer/library");
  if (!id) return errorState("That report wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_library_mod_resolve", { p_id: id, p_status: String(formData.get("status") ?? ""), p_resolution: String(formData.get("resolution") ?? "") });
  if (error) return errorState(dbErrorMessage(error, "The report couldn't be updated."));
  refresh(null, id);
  return { status: "success", message: "Report updated." };
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(60, "Keep it to 60 characters."),
  sortOrder: z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").max(10000, "Use 10000 or less."),
});

export async function categorySaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/library/categories");
  const id = uuid.safeParse(formData.get("categoryId")).data ?? null;
  const kind = String(formData.get("kind") ?? "");
  const values = { name: String(formData.get("name") ?? ""), sortOrder: String(formData.get("sortOrder") ?? "100") };
  const parsed = categorySchema.safeParse(values);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { [String(parsed.error.issues[0].path[0])]: [parsed.error.issues[0].message] }, values });
  if (!id && !["topic", "purpose", "use"].includes(kind)) return errorState("Choose a topic, purpose, or use.", { values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("prayer_library_category_save", { p_id: id, p_kind: id ? null : kind, p_name: parsed.data.name, p_sort_order: parsed.data.sortOrder });
  if (error) return errorState(dbErrorMessage(error, "That couldn't be saved."), { values });
  refresh();
  return { status: "success", message: id ? "Saved." : `Added “${parsed.data.name}”.` };
}

export async function categoryArchiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/library/categories");
  const id = uuid.safeParse(formData.get("categoryId")).data;
  if (!id) return errorState("That category wasn't found.");
  const archived = formData.get("archived") === "true";
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_library_category_archive", { p_id: id, p_archived: archived });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  refresh();
  return { status: "success", message: archived ? "Archived." : "Restored." };
}
