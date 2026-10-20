"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getSupabasePublicConfig } from "@/lib/env";
import { declaredMime } from "@/lib/media/files";
import { isUuid } from "@/lib/media/format";
import { GALLERY_VARIANTS, processImage } from "@/lib/media/images";
import { createUploadToken, downloadObject, removePaths, uploadBytes } from "@/lib/media/storage";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The gallery is unavailable right now. Nothing was uploaded.";

export type PhotoBegin =
  | { ok: true; id: string; path: string; token: string; supabaseUrl: string; publishableKey: string; contentType: string; status: string }
  | { ok: false; message: string };

/**
 * Registers one photo (membership, album, permission, size, batch and daily
 * limits are checked in the database) and returns a one-time token to
 * upload the original straight to the restricted quarantine bucket.
 * Retrying with the same key returns the same photo, never a duplicate.
 */
export async function beginPhotoUpload(input: {
  albumId: string;
  clientKey: string;
  batchKey: string;
  name: string;
  type: string;
  size: number;
  permission: boolean;
}): Promise<PhotoBegin> {
  await requireApprovedMember("/gallery");
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  if (!isUuid(input.albumId) || !isUuid(input.clientKey) || !isUuid(input.batchKey)) return { ok: false, message: "That upload request wasn't valid." };
  const mime = declaredMime("image", input.name, input.type);
  const { data, error } = await supabase.rpc("media_photo_begin", {
    p_album: input.albumId,
    p_client_key: input.clientKey,
    p_batch_key: input.batchKey,
    p_name: input.name.slice(0, 200),
    p_mime: mime,
    p_size: input.size,
    p_permission: input.permission,
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The photo couldn't be added.") };
  const begun = data as { id: string; path: string | null; status: string };
  if (begun.status !== "uploading" || !begun.path) {
    return { ok: true, id: begun.id, path: begun.path ?? "", token: "", supabaseUrl: config.url, publishableKey: config.publishableKey, contentType: mime, status: begun.status };
  }
  const token = await createUploadToken(supabase, "media-uploads", begun.path);
  if (!token) return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  return { ok: true, id: begun.id, path: begun.path, token: token.token, supabaseUrl: config.url, publishableKey: config.publishableKey, contentType: mime, status: begun.status };
}

/**
 * After the original arrives: check and decode it (HEIC included), apply
 * orientation, convert to sRGB, strip all metadata (GPS included), store the
 * review copies, and delete the original. The photo then waits for a
 * moderator; nobody else sees it until it's approved.
 */
export async function processPhoto(photoId: string, caption: string, alt: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireApprovedMember("/gallery");
  if (!isUuid(photoId)) return { ok: false, message: "That photo wasn't found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_photo_processing", { p_id: photoId });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The photo couldn't be processed.") };
  const { original_path: original } = data as { original_path: string };
  const failWith = async (message: string) => {
    await supabase.rpc("media_photo_fail", { p_id: photoId, p_error: message });
    return { ok: false as const, message };
  };
  const bytes = await downloadObject(supabase, "media-uploads", original, 60 * 1024 * 1024);
  if (!bytes) return failWith("The photo couldn't be read. Try uploading it again.");
  const processed = await processImage(bytes, GALLERY_VARIANTS);
  if (!processed.ok) return failWith(processed.message);
  const segments = original.split("/");
  const stem = `${segments.slice(0, 3).join("/")}/review-${randomBytes(6).toString("base64url")}`;
  const display = `${stem}-display.webp`;
  const thumb = `${stem}-thumb.webp`;
  const stored =
    (await uploadBytes(supabase, "media-uploads", display, processed.outputs.display.bytes, "image/webp")) &&
    (await uploadBytes(supabase, "media-uploads", thumb, processed.outputs.thumb.bytes, "image/webp"));
  if (!stored) {
    await removePaths(supabase, "media-uploads", [display, thumb]);
    return failWith("The processed photo couldn't be stored. Try again.");
  }
  const { error: readyError } = await supabase.rpc("media_photo_ready", {
    p_id: photoId,
    p_display: display,
    p_thumb: thumb,
    p_width: processed.outputs.display.width,
    p_height: processed.outputs.display.height,
    p_size: processed.outputs.display.bytes.byteLength,
    p_hash: processed.hash,
    p_caption: caption.slice(0, 500),
    p_alt: alt.slice(0, 500),
  });
  if (readyError) {
    await removePaths(supabase, "media-uploads", [display, thumb]);
    const message = dbErrorMessage(readyError, "The photo couldn't be saved.");
    await supabase.rpc("media_photo_fail", { p_id: photoId, p_error: message });
    await removePaths(supabase, "media-uploads", [original]);
    return { ok: false, message };
  }
  // The original (with its camera and location data) is never kept.
  await removePaths(supabase, "media-uploads", [original]);
  revalidatePath("/gallery/mine");
  return { ok: true };
}

export async function cancelPhotoUpload(photoId: string, path: string): Promise<void> {
  await requireApprovedMember("/gallery");
  if (!isUuid(photoId)) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_photo_fail", { p_id: photoId, p_error: "Cancelled" });
  if (path.startsWith("photos/") && path.includes(`/${photoId}/`)) await removePaths(supabase, "media-uploads", [path]);
}

export async function updatePhotoAction(formData: FormData): Promise<void> {
  await requireApprovedMember("/gallery");
  const id = formData.get("id");
  if (!isUuid(id)) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_photo_update", {
    p_id: id,
    p_caption: String(formData.get("caption") ?? "").slice(0, 500),
    p_alt: String(formData.get("alt") ?? "").slice(0, 500),
  });
  revalidatePath("/gallery", "layout");
}

/** The uploader removes their own photo; its stored files are deleted at once. */
export async function removeMyPhotoAction(formData: FormData): Promise<void> {
  await requireApprovedMember("/gallery");
  const id = formData.get("id");
  if (!isUuid(id)) return;
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase.rpc("media_photo_remove", { p_id: id });
  const r = data as { uploads: string[]; media: string[] } | null;
  if (r) {
    await removePaths(supabase, "media-uploads", r.uploads);
    await removePaths(supabase, "media", r.media);
  }
  revalidatePath("/gallery", "layout");
}

export async function reportPhotoAction(photoId: string, reason: string, details: string): Promise<{ ok: boolean; message: string }> {
  await requireApprovedMember("/gallery");
  if (!isUuid(photoId)) return { ok: false, message: "That photo wasn't found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "The gallery is unavailable right now." };
  const { error } = await supabase.rpc("media_photo_report", { p_id: photoId, p_reason: reason, p_details: details.slice(0, 1000) });
  if (error) return { ok: false, message: dbErrorMessage(error, "The report couldn't be sent.") };
  return { ok: true, message: "Thank you. A gallery moderator will review it." };
}
