"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { EVENT_IMAGE_BUCKET, processHomeBanner } from "@/lib/events/images";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Homepage "Coming up" banners: one per event, plus the church-wide default.
 * Requires events.manage here and again in the database; files go to the
 * private event-images bucket and are served only through signed URLs.
 */
const UNAVAILABLE = "The events service is unavailable. Nothing was changed.";
const NEEDS_MIGRATION = "Banner images need the latest database update (20261023000100). Nothing was changed.";

const input = z.object({
  scope: z.enum(["event", "default"]),
  id: z.uuid().optional(),
  intent: z.enum(["save", "remove"]).default("save"),
  alt: z.string().trim().max(300, "Keep the description to 300 characters or fewer."),
  focusX: z.coerce.number().int().min(0).max(100).catch(50),
  focusY: z.coerce.number().int().min(0).max(100).catch(50),
});

type Current = { path: string | null };

export async function saveHomeBannerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = formData.get("scope") === "default" ? "default" : "event";
  const rawId = String(formData.get("id") ?? "");
  await requireCapability(CAPABILITIES.eventsManage, scope === "default" ? "/admin/events/settings" : `/admin/events/${rawId}`);
  const values = formValues(formData, ["banner"]);
  const parsed = input.safeParse({ ...Object.fromEntries(formData), id: rawId || undefined, alt: String(formData.get("alt") ?? "") });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
  }
  const { intent, alt, focusX, focusY, id } = parsed.data;
  if (scope === "event" && !id) return errorState("That event couldn't be found.");

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  // Current path, read through the same manager-only functions.
  let current: Current;
  if (scope === "event") {
    const { data, error } = await supabase.rpc("events_admin_get", { p_series: id });
    if (error || !data) return errorState("That event couldn't be found.");
    const row = data as { home_banner_path?: string | null };
    if (!("home_banner_path" in row)) return errorState(NEEDS_MIGRATION);
    current = { path: row.home_banner_path ?? null };
  } else {
    const { data, error } = await supabase.rpc("events_home_banner_default");
    if (error) return errorState(NEEDS_MIGRATION);
    current = { path: (data as { path?: string } | null)?.path ?? null };
  }

  const save = (path: string | null) =>
    scope === "event"
      ? supabase.rpc("events_admin_home_banner_save", { p_series: id, p_path: path, p_alt: path ? alt : null, p_focus_x: focusX, p_focus_y: focusY })
      : supabase.rpc("events_admin_default_banner_save", { p_path: path, p_alt: path ? alt : null, p_focus_x: focusX, p_focus_y: focusY });

  const done = (message: string): FormState => {
    revalidatePath("/home");
    revalidatePath(scope === "event" ? `/admin/events/${id}` : "/admin/events/settings");
    return { status: "success", message };
  };

  if (intent === "remove") {
    if (!current.path) return errorState("There's no banner to remove.");
    const { error } = await save(null);
    if (error) return errorState(dbErrorMessage(error, "The banner couldn't be removed."));
    await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([current.path]);
    return done("Banner removed.");
  }

  const file = formData.get("banner");
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (!upload && !current.path) return { status: "error", message: "Choose an image to upload.", fieldErrors: { banner: ["Choose an image to upload."] }, values };
  if (!alt) {
    return { status: "error", message: "Describe the image for people using screen readers.", fieldErrors: { alt: ["Describe the image for people using screen readers."] }, values };
  }

  let uploaded: string | null = null;
  if (upload) {
    const processed = await processHomeBanner(upload, scope === "event" ? `home/${id}` : "home-default");
    if (!processed.ok) return { status: "error", message: processed.message, fieldErrors: { banner: [processed.message] }, values };
    const { error } = await supabase.storage.from(EVENT_IMAGE_BUCKET).upload(processed.path, processed.bytes, { contentType: "image/webp", upsert: false });
    if (error) return errorState("The image couldn't be uploaded. Nothing was saved.", { values });
    uploaded = processed.path;
  }

  const { error } = await save(uploaded ?? current.path);
  if (error) {
    if (uploaded) await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([uploaded]);
    return errorState(dbErrorMessage(error, "The banner couldn't be saved."), { values });
  }
  if (uploaded && current.path) await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([current.path]);
  return done(uploaded ? (current.path ? "Banner replaced." : "Banner added.") : "Banner details saved.");
}
