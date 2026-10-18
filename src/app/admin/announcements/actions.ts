"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseAnnouncementForm, ANNOUNCEMENT_INTENTS } from "@/lib/announcements/schema";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";
import { LIMITS, validateImageFile } from "@/lib/uploads";

const BUCKET = "announcement-images";
const UNAVAILABLE = "The announcement service is unavailable. Nothing was saved.";
const idSchema = z.uuid();

export async function saveAnnouncementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.announcementsManage, "/admin/announcements");
  const values = formValues(formData);
  const rawId = formData.get("id");
  const id = rawId ? idSchema.safeParse(rawId).data : undefined;
  if (rawId && !id) return errorState("That announcement couldn't be found.");

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { settings } = await getChurchSettings();

  let current: { status: string; image_path: string | null } | null = null;
  if (id) {
    const { data } = await supabase.from("announcements").select("status, image_path").eq("id", id).maybeSingle();
    if (!data) return errorState("That announcement couldn't be found.");
    current = data;
  }

  const file = formData.get("image");
  const newImage = file instanceof File && file.size > 0 ? file : null;
  const removeImage = formData.get("removeImage") === "on";
  const keepsImage = Boolean(current?.image_path) && !removeImage;

  const intentRaw = String(formData.get("intent") ?? "");
  const intent = (ANNOUNCEMENT_INTENTS as readonly string[]).includes(intentRaw) ? intentRaw : "save_draft";
  const parsed = parseAnnouncementForm(
    {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      visibility: formData.get("visibility") as "public" | "members",
      pinned: formData.get("pinned") === "on",
      publishAt: String(formData.get("publishAt") ?? ""),
      expiresAt: String(formData.get("expiresAt") ?? ""),
      imageAlt: String(formData.get("imageAlt") ?? ""),
      intent: intent as (typeof ANNOUNCEMENT_INTENTS)[number],
    },
    { timeZone: settings.timezone, hasImage: Boolean(newImage) || keepsImage, currentStatus: current?.status },
  );
  if (!parsed.ok) return validationErrorState(parsed.error, values);

  let imagePath: string | null | undefined; // undefined = unchanged
  if (newImage) {
    const check = await validateImageFile(newImage, { maxBytes: LIMITS.announcement, label: "image", maxSize: 6000 });
    if (!check.ok) return { status: "error", message: check.message, fieldErrors: { image: [check.message] }, values };
    imagePath = `${id ?? "new"}/${crypto.randomUUID()}.${check.kind === "jpeg" ? "jpg" : check.kind}`;
    const { error } = await supabase.storage.from(BUCKET).upload(imagePath, check.bytes, { contentType: check.mime, upsert: false });
    if (error) return errorState("The image couldn't be uploaded. Nothing was saved.", { values });
  } else if (removeImage) {
    imagePath = null;
  }

  const row = { ...parsed.data, ...(imagePath !== undefined ? { image_path: imagePath } : {}) };
  if (imagePath === null) row.image_alt = null;

  if (!id) {
    const { data, error } = await supabase.from("announcements").insert(row).select("id").single();
    if (error || !data) {
      if (imagePath) await supabase.storage.from(BUCKET).remove([imagePath]);
      return errorState("The announcement couldn't be saved. Please try again.", { values });
    }
    revalidatePath("/", "layout");
    redirect(`/admin/announcements/${data.id}?saved=${intent}`);
  }

  const { error } = await supabase.from("announcements").update(row).eq("id", id);
  if (error) {
    if (imagePath) await supabase.storage.from(BUCKET).remove([imagePath]);
    return errorState("Your changes couldn't be saved. Please try again.", { values });
  }
  if (imagePath !== undefined && current?.image_path) await supabase.storage.from(BUCKET).remove([current.image_path]);
  revalidatePath("/", "layout");
  redirect(`/admin/announcements/${id}?saved=${intent}`);
}

export async function setAnnouncementStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.announcementsManage, "/admin/announcements");
  const id = idSchema.safeParse(formData.get("id")).data;
  const target = formData.get("status");
  if (!id || (target !== "archived" && target !== "draft")) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.from("announcements").update({ status: target }).eq("id", id).select("id");
  if (error || !data?.length) return errorState("That change couldn't be saved. Please try again.");
  revalidatePath("/", "layout");
  redirect(`/admin/announcements/${id}?saved=${target === "archived" ? "archived" : "restored"}`);
}
