"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { readChannelForm } from "@/lib/notifications/channels";
import { readGatheringRows, settingsSchema, SOCIAL_NETWORKS } from "@/lib/settings/schema";
import { createClient } from "@/lib/supabase/server";
import { LIMITS, validateImageFile } from "@/lib/uploads";

const UNAVAILABLE = "The settings service is unavailable. Your changes were not saved.";

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const values = formValues(formData);
  const raw = {
    churchName: formData.get("churchName") ?? "",
    description: formData.get("description") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
    contactPhone: formData.get("contactPhone") ?? "",
    addressLine1: formData.get("addressLine1") ?? "",
    addressLine2: formData.get("addressLine2") ?? "",
    city: formData.get("city") ?? "",
    region: formData.get("region") ?? "",
    postalCode: formData.get("postalCode") ?? "",
    country: formData.get("country") ?? "",
    timezone: formData.get("timezone") ?? "",
    gatheringTimes: readGatheringRows(formData),
    socialLinks: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, formData.get(`social_${n}`) ?? ""])),
  };
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const d = parsed.data;

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase
    .from("church_settings")
    .update({
      church_name: d.churchName,
      description: d.description,
      contact_email: d.contactEmail,
      contact_phone: d.contactPhone,
      address_line1: d.addressLine1,
      address_line2: d.addressLine2,
      city: d.city,
      region: d.region,
      postal_code: d.postalCode,
      country: d.country,
      timezone: d.timezone,
      gathering_times: d.gatheringTimes,
      social_links: Object.fromEntries(Object.entries(d.socialLinks).filter(([, v]) => v)),
    })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) return errorState("Your changes couldn't be saved. Please try again.", { values });

  revalidatePath("/", "layout");
  return { status: "success", message: "Church settings saved.", values };
}

type BrandAsset = "logo" | "icon";

export async function uploadBrandAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const asset: BrandAsset = formData.get("asset") === "icon" ? "icon" : "logo";
  const file = formData.get("file");
  if (!(file instanceof File)) return errorState(`Choose a ${asset} file to upload.`);

  const check = await validateImageFile(file, {
    maxBytes: LIMITS.branding,
    label: asset,
    minSize: asset === "icon" ? 192 : 200,
    maxSize: 4096,
  });
  if (!check.ok) return { status: "error", message: check.message, fieldErrors: { file: [check.message] } };

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data: current } = await supabase.from("church_settings").select("logo_path, icon_path").maybeSingle();

  const path = `${asset}/${crypto.randomUUID()}.${check.kind === "jpeg" ? "jpg" : check.kind}`;
  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(path, check.bytes, { contentType: check.mime, cacheControl: "31536000", upsert: false });
  if (uploadError) return errorState("The file couldn't be uploaded. Please try again.");

  const column = asset === "logo" ? "logo_path" : "icon_path";
  const { error } = await supabase.from("church_settings").update({ [column]: path }).eq("id", true);
  if (error) {
    await supabase.storage.from("branding").remove([path]);
    return errorState("The new file couldn't be saved. Nothing was changed.");
  }
  const previous = current?.[column];
  if (previous) await supabase.storage.from("branding").remove([previous]);

  revalidatePath("/", "layout");
  return { status: "success", message: asset === "logo" ? "New logo saved." : "New icon saved." };
}

export async function restoreBrandAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const asset: BrandAsset = formData.get("asset") === "icon" ? "icon" : "logo";
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const column = asset === "logo" ? "logo_path" : "icon_path";
  const { data: current } = await supabase.from("church_settings").select("logo_path, icon_path").maybeSingle();
  const { error } = await supabase.from("church_settings").update({ [column]: null }).eq("id", true);
  if (error) return errorState("The approved artwork couldn't be restored. Please try again.");
  const previous = current?.[column];
  if (previous) await supabase.storage.from("branding").remove([previous]);
  revalidatePath("/", "layout");
  return { status: "success", message: `The approved ${asset} is back in use.` };
}

// Membership approval notifications (settings.manage; the database re-checks).

const recipientSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address.")
    .max(254, "That email address is too long.")
    .pipe(z.email("Enter one valid email address, like name@example.com.")),
});

function alertError(error: { code?: string; message?: string }, fallback: string): string {
  // The database's own messages for these codes are written for administrators.
  if (error.code && ["22023", "23505", "P0002"].includes(error.code) && error.message) return error.message;
  if (error.code === "42501") return "You don't have permission to change membership approval notifications.";
  return fallback;
}

export async function setMembershipAlertsEnabledAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const enabled = formData.get("enabled") === "on";
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("membership_alert_set_enabled", { p_enabled: enabled });
  if (error) return errorState(alertError(error, "The setting couldn't be saved. Please try again."));
  revalidatePath("/admin/settings");
  return {
    status: "success",
    message: enabled ? "Membership approval notifications are on." : "Membership approval notifications are off.",
  };
}

export async function addMembershipAlertRecipientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const values = formValues(formData);
  const parsed = recipientSchema.safeParse({ email: formData.get("email") ?? "" });
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("membership_alert_add_recipient", { p_email: parsed.data.email });
  if (error) {
    const message = alertError(error, "The recipient couldn't be added. Please try again.");
    return { status: "error", message, fieldErrors: { email: [message] }, values };
  }
  revalidatePath("/admin/settings");
  return { status: "success", message: `${parsed.data.email} was added.` };
}

export async function removeMembershipAlertRecipientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorState("That recipient couldn't be found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("membership_alert_remove_recipient", { p_id: id });
  if (error) return errorState(alertError(error, "The recipient couldn't be removed. Please try again."));
  revalidatePath("/admin/settings");
  return { status: "success", message: "Recipient removed." };
}

// Church-wide push and email settings per notification type (settings.manage;
// the database re-checks, validates the types, and records the change).

export async function saveNotificationChannelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/settings");
  const submission = readChannelForm(formData);
  if (!submission) return errorState("That notification channel couldn't be found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("notification_channel_set", {
    p_channel: submission.channel,
    p_all: submission.all,
    p_disabled: submission.disabled,
  });
  if (error) {
    if (error.code === "42501") return errorState("You don't have permission to change notification settings.");
    if (error.code === "22023" && error.message) return errorState(error.message);
    return errorState("The setting couldn't be saved. Please try again.");
  }
  revalidatePath("/admin/settings");
  const noun = submission.channel === "push" ? "Push" : "Email";
  return {
    status: "success",
    message: submission.all ? `${noun} notification settings saved. All types are on.` : `${noun} notification settings saved.`,
  };
}
