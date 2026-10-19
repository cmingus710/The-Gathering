"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deliverCommunityNow } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Report outcomes and community restrictions. Used by community moderators
 * (Administration → Moderation) and by group leaders for their own group's
 * reports; the database checks which reports each person may act on and
 * records every action in the moderation log.
 */
const UNAVAILABLE = "Moderation is unavailable right now. Nothing was changed.";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

function refresh() {
  revalidatePath("/admin/moderation", "layout");
  revalidatePath("/groups", "layout");
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
}

export async function resolveReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/admin/moderation");
  const parsed = z
    .object({
      reportId: z.uuid(),
      status: z.enum(["actioned", "dismissed", "open"]),
      resolution: z.string().trim().max(1000, "Keep it to 1,000 characters."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message);
  const { error } = await rpc("community_mod_resolve", { p_id: parsed.data.reportId, p_status: parsed.data.status, p_resolution: parsed.data.resolution });
  if (error) return errorState(dbErrorMessage(error), { values: { resolution: parsed.data.resolution } });
  refresh();
  return { status: "success", message: parsed.data.status === "open" ? "Report reopened." : "Report closed and recorded." };
}

export async function restrictAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/admin/moderation");
  const parsed = z
    .object({
      profileId: z.uuid(),
      scope: z.enum(["posting", "messaging", "all"]),
      days: z.enum(["1", "3", "7", "30", "90", "none"]),
      reason: z.string().trim().min(3, "Give a reason.").max(500),
      reportId: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message);
  const { error } = await rpc("community_mod_restrict", {
    p_profile: parsed.data.profileId,
    p_scope: parsed.data.scope,
    p_days: parsed.data.days === "none" ? null : Number(parsed.data.days),
    p_reason: parsed.data.reason,
    p_report: parsed.data.reportId || null,
  });
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  return { status: "success", message: "Restriction applied. The member was told; their church membership is unchanged." };
}

export async function liftRestrictionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/admin/moderation");
  const parsed = z.object({ restrictionId: z.uuid(), reason: z.string().trim().max(500).default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That restriction wasn't found.");
  const { error } = await rpc("community_mod_lift_restriction", { p_id: parsed.data.restrictionId, p_reason: parsed.data.reason || null });
  if (error) return errorState(dbErrorMessage(error));
  refresh();
  return { status: "success", message: "Restriction lifted." };
}

export async function memberSearchForModeration(query: string): Promise<Array<{ id: string; name: string }>> {
  await requireApprovedMember("/admin/moderation");
  const { data } = await rpc("community_mod_member_search", { p_query: query.slice(0, 80) });
  return (data as Array<{ id: string; name: string }>) ?? [];
}
