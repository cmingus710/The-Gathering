"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { getSupabasePublicConfig } from "@/lib/env";
import { declaredMime } from "@/lib/media/files";
import { isUuid } from "@/lib/media/format";
import { cleanFraming, type Framing } from "@/lib/media/framing";
import { ALBUM_COVER_VARIANTS, processImage } from "@/lib/media/images";
import { createUploadToken, downloadObject, removePaths, uploadBytes } from "@/lib/media/storage";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Album cover images (20261119000100). Uploads use the gallery's pipeline:
 * the original goes from the browser straight to the restricted
 * `media-uploads` bucket with a one-time token, then this server decodes it
 * (HEIC included), applies orientation, converts to sRGB, strips all
 * metadata, and stores WebP copies under album-covers/<album>/ in the private
 * `media` bucket. Every step acts as the signed-in editor, so the database
 * and Storage RLS decide who may change which album. Replacing or removing a
 * cover deletes only that cover's own files, never a photo or library file.
 */

const UNAVAILABLE = "The gallery service is unavailable. The cover wasn't changed.";
type Result = { ok: true } | { ok: false; message: string };

export type CoverBegin =
  | { ok: true; id: string; path: string; token: string; supabaseUrl: string; publishableKey: string; contentType: string }
  | { ok: false; message: string };

const guard = () => requireAnyCapability([CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage], "/admin/gallery");
const framingJson = (f: Framing | null | undefined) => (f ? cleanFraming(f) : null);

function refresh(albumId: string) {
  revalidatePath(`/admin/gallery/${albumId}`);
  revalidatePath("/admin/gallery");
  revalidatePath("/gallery", "layout");
}

/** Old cover files are deleted after the change is saved; a failure only leaves files for Media → Cleanup. */
async function removeOld(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, r: unknown) {
  const out = r as { remove?: string[]; uploads?: string[] } | null;
  const own = (paths: string[] | undefined) => (paths ?? []).filter((p) => typeof p === "string" && p.startsWith("album-covers/"));
  await removePaths(supabase, "media", own(out?.remove));
  await removePaths(supabase, "media-uploads", own(out?.uploads));
}

/** Registers one cover image (type and the gallery size limit are checked in the database) and returns a one-time upload token. */
export async function beginAlbumCoverUpload(input: { albumId: string; name: string; type: string; size: number }): Promise<CoverBegin> {
  await guard();
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  if (!isUuid(input.albumId)) return { ok: false, message: "That album couldn't be found." };
  const mime = declaredMime("image", input.name, input.type);
  const { data, error } = await supabase.rpc("media_admin_album_cover_begin", { p_album: input.albumId, p_mime: mime, p_size: input.size });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The cover image couldn't be added.") };
  const begun = data as { id: string; path: string };
  const token = await createUploadToken(supabase, "media-uploads", begun.path);
  if (!token) {
    await supabase.rpc("media_admin_album_cover_fail", { p_upload: begun.id, p_error: "Storage refused the upload" });
    return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  }
  return { ok: true, id: begun.id, path: begun.path, token: token.token, supabaseUrl: config.url, publishableKey: config.publishableKey, contentType: mime };
}

/**
 * After the original arrives: process it, store the served copies, and make
 * it the cover with the editor's framing and description. The original
 * (with its camera and location data) is never kept.
 */
export async function finishAlbumCoverUpload(input: {
  uploadId: string;
  framing: Framing | null;
  alt: string;
  noMinors: boolean;
}): Promise<Result> {
  await guard();
  if (!isUuid(input.uploadId)) return { ok: false, message: "That upload wasn't found." };
  if (!input.noMinors) {
    return { ok: false, message: "Confirm that no one under 18 can be identified in the cover image." };
  }
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_album_cover_processing", { p_upload: input.uploadId });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The cover image couldn't be processed.") };
  const { album_id: albumId, original_path: original } = data as { album_id: string; original_path: string };
  const failWith = async (message: string) => {
    const { data: failed } = await supabase.rpc("media_admin_album_cover_fail", { p_upload: input.uploadId, p_error: message });
    await removeOld(supabase, failed);
    return { ok: false as const, message };
  };
  const bytes = await downloadObject(supabase, "media-uploads", original, 60 * 1024 * 1024);
  if (!bytes) return failWith("The image couldn't be read. Try uploading it again.");
  const processed = await processImage(bytes, ALBUM_COVER_VARIANTS);
  if (!processed.ok) return failWith(processed.message);
  const stem = `album-covers/${albumId}/${input.uploadId}/${randomBytes(9).toString("base64url")}`;
  const display = `${stem}-display.webp`;
  const thumb = `${stem}-thumb.webp`;
  const stored =
    (await uploadBytes(supabase, "media", display, processed.outputs.display.bytes, "image/webp")) &&
    (await uploadBytes(supabase, "media", thumb, processed.outputs.thumb.bytes, "image/webp"));
  if (!stored) {
    await removePaths(supabase, "media", [display, thumb]);
    return failWith("The processed cover couldn't be stored. Try again.");
  }
  const { data: ready, error: readyError } = await supabase.rpc("media_admin_album_cover_ready", {
    p_upload: input.uploadId,
    p_display: display,
    p_thumb: thumb,
    p_width: processed.outputs.display.width,
    p_height: processed.outputs.display.height,
    p_alt: input.alt.slice(0, 500),
    p_framing: framingJson(input.framing),
    p_no_minors: input.noMinors,
  });
  if (readyError || !ready) {
    await removePaths(supabase, "media", [display, thumb]);
    return failWith(dbErrorMessage(readyError, "The cover couldn't be saved."));
  }
  await removeOld(supabase, ready);
  refresh(albumId);
  return { ok: true };
}

/** Cancelling a chosen file (or a failed upload): the saved cover stays as it was. */
export async function cancelAlbumCoverUpload(uploadId: string, reason = "Cancelled"): Promise<void> {
  await guard();
  if (!isUuid(uploadId)) return;
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase.rpc("media_admin_album_cover_fail", { p_upload: uploadId, p_error: reason.slice(0, 300) });
  await removeOld(supabase, data);
}

/** A published photo from the album (gallery moderators). */
export async function chooseAlbumCoverPhoto(input: { albumId: string; photoId: string; framing: Framing | null }): Promise<Result> {
  await guard();
  if (!isUuid(input.albumId) || !isUuid(input.photoId)) return { ok: false, message: "That photo couldn't be found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_album_cover_choose", {
    p_album: input.albumId,
    p_photo: input.photoId,
    p_framing: framingJson(input.framing),
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The cover couldn't be changed.") };
  await removeOld(supabase, data);
  refresh(input.albumId);
  return { ok: true };
}

/** Repositions the current cover (and updates an uploaded cover's description). */
export async function frameAlbumCover(input: { albumId: string; cover: string; framing: Framing | null; alt: string | null }): Promise<Result> {
  await guard();
  if (!isUuid(input.albumId)) return { ok: false, message: "That album couldn't be found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_album_cover_framing", {
    p_album: input.albumId,
    p_cover: input.cover,
    p_framing: framingJson(input.framing),
    p_alt: input.alt === null ? null : input.alt.slice(0, 500),
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "The cover couldn't be saved.") };
  if (data !== true) return { ok: false, message: "The cover was changed by someone else meanwhile. Reload the page and try again." };
  refresh(input.albumId);
  return { ok: true };
}

/** Back to the automatic cover. A chosen photo stays in the album. */
export async function removeAlbumCover(albumId: string): Promise<Result> {
  await guard();
  if (!isUuid(albumId)) return { ok: false, message: "That album couldn't be found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_album_cover_remove", { p_album: albumId });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The cover couldn't be removed.") };
  await removeOld(supabase, data);
  refresh(albumId);
  return { ok: true };
}
