"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { isUuid, isYmd } from "@/lib/media/format";
import { reencodeWebp } from "@/lib/media/images";
import { downloadObject, removePaths, uploadBytes } from "@/lib/media/storage";
import type { Photo } from "@/lib/media/types";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The gallery service is unavailable. Nothing was saved.";

export async function saveAlbumAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAnyCapability([CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage], "/admin/gallery");
  const values = formValues(formData);
  const id = formData.get("id");
  const albumId = id ? (isUuid(id) ? String(id) : null) : null;
  if (id && !albumId) return errorState("That album couldn't be found.");
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 160) return errorState("Give the album a title.", { values, fieldErrors: { title: ["Required, up to 160 characters."] } });
  const audience = String(formData.get("audience") ?? "members");
  if (audience !== "members" && audience !== "group") return errorState("Albums are for approved members or one group.", { values });
  const groupId = audience === "group" ? String(formData.get("group_id") ?? "") : "";
  if (audience === "group" && !isUuid(groupId)) return errorState("Choose a group.", { values, fieldErrors: { group_id: ["Choose a group."] } });
  const date = String(formData.get("album_on") ?? "");
  if (date && !isYmd(date)) return errorState("Enter a valid date.", { values, fieldErrors: { album_on: ["Enter a valid date."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("media_admin_album_save", {
    p_id: albumId,
    p: {
      title,
      description: String(formData.get("description") ?? "").slice(0, 2000),
      album_on: date || null,
      event_series_id: isUuid(formData.get("event_series_id")) ? formData.get("event_series_id") : null,
      audience,
      group_id: groupId || null,
      uploads_open: formData.get("uploads_open") === "on",
      sort_order: Math.max(0, Math.min(100_000, Number(formData.get("sort_order")) || 100)),
    },
  });
  if (error || !data) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/admin/gallery");
  redirect(`/admin/gallery/${data as string}?saved=${albumId ? "saved" : "created"}`);
}

export async function albumStatusAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery");
  const id = formData.get("id");
  const action = String(formData.get("action") ?? "");
  if (!isUuid(id) || !["publish", "unpublish", "archive", "restore", "delete"].includes(action)) redirect("/admin/gallery");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/gallery/${id}?error=unavailable`);
  const { error } = await supabase.rpc("media_admin_album_status", { p_id: id, p_action: action });
  if (error) redirect(`/admin/gallery/${id}?error=${encodeURIComponent(dbErrorMessage(error))}`);
  revalidatePath("/", "layout");
  redirect(action === "delete" ? "/admin/gallery?saved=deleted" : `/admin/gallery/${id}?saved=${action}`);
}

/**
 * Review a photo. Approval re-encodes the uploader's review copies (already
 * stripped of metadata) once more, as the moderator, into the served
 * bucket, so nothing a member's own session wrote is ever served directly.
 */
export async function reviewPhotoAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery");
  const albumId = formData.get("album");
  const photoId = formData.get("photo");
  const action = String(formData.get("action") ?? "");
  const back = (q: string) => `/admin/gallery/${albumId}?${q}#photo-${photoId}`;
  if (!isUuid(albumId) || !isUuid(photoId) || !["approve", "reject", "hide", "unhide", "remove"].includes(action)) redirect("/admin/gallery");
  const supabase = await createClient();
  if (!supabase) redirect(back("error=unavailable"));
  const reason = String(formData.get("reason") ?? "").slice(0, 500) || null;
  let display: string | null = null;
  let thumb: string | null = null;

  if (action === "approve") {
    const minors = String(formData.get("minors") ?? "");
    if (minors !== "none" && minors !== "permission_confirmed") {
      redirect(back(`error=${encodeURIComponent("Confirm whether the photo shows anyone under 18 before approving it.")}`));
    }
    const { data } = await supabase.rpc("media_admin_album", { p_id: albumId, p_status: "pending" });
    const photo = ((data as { photos?: Photo[] } | null)?.photos ?? []).find((p) => p.id === photoId);
    if (!photo?.review_display_path || !photo.review_thumb_path) redirect(back(`error=${encodeURIComponent("That photo is no longer waiting for review.")}`));
    const [d, t] = await Promise.all([
      downloadObject(supabase, "media-uploads", photo.review_display_path, 8 * 1024 * 1024),
      downloadObject(supabase, "media-uploads", photo.review_thumb_path, 2 * 1024 * 1024),
    ]);
    const [dOut, tOut] = await Promise.all([d ? reencodeWebp(d, 2048, 82) : null, t ? reencodeWebp(t, 480, 74) : null]);
    if (!dOut || !tOut) redirect(back(`error=${encodeURIComponent("The photo couldn't be processed. Reject it and ask for a different file.")}`));
    const stem = `gallery/${albumId}/${photoId}/${randomBytes(9).toString("base64url")}`;
    display = `${stem}-display.webp`;
    thumb = `${stem}-thumb.webp`;
    const ok = (await uploadBytes(supabase, "media", display, dOut, "image/webp")) && (await uploadBytes(supabase, "media", thumb, tOut, "image/webp"));
    if (!ok) {
      await removePaths(supabase, "media", [display, thumb]);
      redirect(back(`error=${encodeURIComponent("The published copies couldn't be stored. Try again.")}`));
    }
  }

  const { data: result, error } = await supabase.rpc("media_admin_photo_review", {
    p_id: photoId,
    p_action: action,
    p_reason: reason,
    p_minors: action === "approve" ? String(formData.get("minors")) : null,
    p_display: display,
    p_thumb: thumb,
  });
  if (error || !result) {
    if (display && thumb) await removePaths(supabase, "media", [display, thumb]);
    redirect(back(`error=${encodeURIComponent(dbErrorMessage(error, "That change couldn't be saved."))}`));
  }
  const r = result as { uploads: string[]; media: string[] };
  const okUploads = await removePaths(supabase, "media-uploads", r.uploads ?? []);
  const okMedia = await removePaths(supabase, "media", r.media ?? []);
  if ((action === "reject" || action === "remove") && okUploads && okMedia) {
    await supabase.rpc("media_admin_objects_deleted", { p_asset_ids: [], p_photo_ids: [photoId] });
  }
  revalidatePath(`/admin/gallery/${albumId}`);
  redirect(back(`saved=${action}`));
}

export async function movePhotoAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery");
  const albumId = formData.get("album");
  const order = String(formData.get("order") ?? "").split(",").filter(isUuid);
  if (!isUuid(albumId)) redirect("/admin/gallery");
  const supabase = await createClient();
  if (supabase && order.length) await supabase.rpc("media_admin_photo_order", { p_album: albumId, p_ids: order });
  revalidatePath(`/admin/gallery/${albumId}`);
  redirect(`/admin/gallery/${albumId}?saved=order`);
}

export async function setCoverAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery");
  const albumId = formData.get("album");
  const photoId = formData.get("photo");
  if (!isUuid(albumId) || !isUuid(photoId)) redirect("/admin/gallery");
  const supabase = await createClient();
  if (supabase) await supabase.rpc("media_admin_album_cover", { p_album: albumId, p_photo: photoId });
  revalidatePath(`/admin/gallery/${albumId}`);
  redirect(`/admin/gallery/${albumId}?saved=cover`);
}

export async function resolveReportAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.galleryModerate, "/admin/gallery/reports");
  const id = formData.get("id");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(id) || !["actioned", "dismissed"].includes(status)) redirect("/admin/gallery/reports");
  const supabase = await createClient();
  if (supabase) {
    await supabase.rpc("media_admin_photo_report_resolve", { p_id: id, p_status: status, p_resolution: String(formData.get("resolution") ?? "").slice(0, 1000) });
  }
  revalidatePath("/admin/gallery/reports");
  redirect("/admin/gallery/reports?saved=1");
}
