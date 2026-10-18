"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
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
