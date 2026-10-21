"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { CAMPAIGN_IMAGE_BUCKET, processCampaignImage } from "@/lib/giving/campaign-images";
import { parseDollarsToCents } from "@/lib/giving/money";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Campaign administration (finance.manage, checked here and again in the
 * database). Nothing here logs amounts or donor details.
 */
const UNAVAILABLE = "The finance service is unavailable. Nothing was changed.";
const optionalUuid = z.union([z.uuid(), z.literal("")]).transform((v) => v || null);
const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date."), z.literal("")]).transform((v) => v || null);

const campaignInput = z.object({
  id: optionalUuid,
  title: z.string().trim().min(1, "Enter a title.").max(120, "Use 120 characters or fewer."),
  description: z.string().trim().max(2000, "Use 2,000 characters or fewer.").default(""),
  goal: z.string().max(20),
  startsOn: optionalDate,
  endsOn: optionalDate,
  fundId: z.uuid({ message: "Choose a fund." }),
  visibility: z.enum(["public", "members"], { message: "Choose who can see it." }),
  imageAlt: z.string().trim().max(200, "Use 200 characters or fewer.").default(""),
});

export async function saveCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/campaigns");
  const values = formValues(formData, ["image"]);
  const parsed = campaignInput.safeParse(Object.fromEntries([...formData.entries()].filter(([k]) => k !== "image")));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { values, fieldErrors });
  }
  const d = parsed.data;
  const goal = parseDollarsToCents(d.goal);
  if (goal === null || goal < 100) return errorState("Please correct the goal.", { values, fieldErrors: { goal: ["Enter the goal in dollars, like 5000."] } });
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) {
    return errorState("Please correct the dates.", { values, fieldErrors: { endsOn: ["The end date must be on or after the start date."] } });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  let current: { image_path: string | null } | null = null;
  if (d.id) {
    const { data } = await supabase.rpc("finance_campaign", { p_id: d.id });
    if (!data) return errorState("That campaign wasn't found.");
    current = data as { image_path: string | null };
  }

  const file = formData.get("image");
  const newImage = file instanceof File && file.size > 0 ? file : null;
  const removeImage = formData.get("removeImage") === "on";
  let uploaded: string | null = null;
  let imagePath: string | null = removeImage ? null : (current?.image_path ?? null);
  if (newImage) {
    const processed = await processCampaignImage(newImage);
    if (!processed.ok) return errorState(processed.message, { values, fieldErrors: { image: [processed.message] } });
    const { error } = await supabase.storage.from(CAMPAIGN_IMAGE_BUCKET).upload(processed.path, processed.bytes, { contentType: "image/webp", upsert: false });
    if (error) return errorState("The image couldn't be uploaded. Nothing was saved.", { values });
    uploaded = processed.path;
    imagePath = uploaded;
  }

  const { data, error } = await supabase.rpc("finance_campaign_save", {
    p_id: d.id,
    p_title: d.title,
    p_description: d.description || null,
    p_goal_cents: goal,
    p_starts_on: d.startsOn,
    p_ends_on: d.endsOn,
    p_fund: d.fundId,
    p_visibility: d.visibility,
    p_image_path: imagePath,
    p_image_alt: imagePath ? d.imageAlt || null : null,
  });
  if (error || !data) {
    if (uploaded) await supabase.storage.from(CAMPAIGN_IMAGE_BUCKET).remove([uploaded]);
    return errorState(dbErrorMessage(error, "The campaign couldn't be saved. Please check the details and try again."), { values });
  }
  if ((uploaded || removeImage) && current?.image_path && current.image_path !== imagePath) {
    await supabase.storage.from(CAMPAIGN_IMAGE_BUCKET).remove([current.image_path]);
  }
  revalidatePath("/admin/finance", "layout");
  revalidatePath("/give", "layout");
  if (!d.id) redirect(`/admin/finance/campaigns/${data as string}?created=1`);
  return { status: "success", message: "Campaign saved. Gifts already made keep counting toward it." };
}

const statusInput = z.object({ id: z.uuid(), status: z.enum(["published", "closed", "archived"]) });

export async function campaignStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/campaigns");
  const parsed = statusInput.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("finance_campaign_status", { p_id: parsed.data.id, p_status: parsed.data.status });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/finance", "layout");
  revalidatePath("/give", "layout");
  const done: Record<string, string> = {
    published: "Published. It now appears on the giving page for its audience.",
    closed: "Closed. It still shows its total, but takes no new online gifts.",
    archived: "Archived. It's hidden from the giving page; its gifts and total are kept.",
  };
  return { status: "success", message: done[parsed.data.status] };
}
