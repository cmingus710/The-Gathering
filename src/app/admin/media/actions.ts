"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { getSupabasePublicConfig } from "@/lib/env";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { parseVideoUrl, storedVideoRef } from "@/lib/media/embeds";
import { checkVideo } from "@/lib/media/video-provider";
import { declaredMime, sniffAsset, vttToTranscript, type AssetKind } from "@/lib/media/files";
import { LIBRARY_VARIANTS, processImage } from "@/lib/media/images";
import { createUploadToken, downloadObject, readRange, removePaths, uploadBytes } from "@/lib/media/storage";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The media service is unavailable. Nothing was changed.";
const id = z.uuid();

export type BeginResult =
  | { ok: true; id: string; path: string; token: string; supabaseUrl: string; publishableKey: string; contentType: string; maxBytes: number }
  | { ok: false; message: string };

/** Registers an upload and returns a one-time token for the browser to upload directly to storage. */
export async function beginAssetUpload(input: {
  kind: AssetKind;
  title: string;
  name: string;
  type: string;
  size: number;
  clientKey: string;
  parentId?: string | null;
  language?: string | null;
}): Promise<BeginResult> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  if (!["audio", "video", "image", "document", "captions"].includes(input.kind) || !id.safeParse(input.clientKey).success) {
    return { ok: false, message: "That upload request wasn't valid." };
  }
  const mime = declaredMime(input.kind, input.name, input.type);
  const { data, error } = await supabase.rpc("media_admin_asset_begin", {
    p_kind: input.kind,
    p_title: input.title.slice(0, 160),
    p_name: input.name.slice(0, 200),
    p_mime: mime,
    p_size: input.size,
    p_client_key: input.clientKey,
    p_parent: input.parentId ?? null,
    p_language: input.language ?? null,
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The upload couldn't be started.") };
  const begun = data as { id: string; upload_path: string; max_bytes: number };
  const token = await createUploadToken(supabase, "media", begun.upload_path);
  if (!token) return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  return {
    ok: true,
    id: begun.id,
    path: begun.upload_path,
    token: token.token,
    supabaseUrl: config.url,
    publishableKey: config.publishableKey,
    contentType: mime,
    maxBytes: begun.max_bytes,
  };
}

async function fail(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, assetId: string, path: string | null, message: string) {
  await supabase.rpc("media_admin_asset_fail", { p_id: assetId, p_error: message });
  if (path) await removePaths(supabase, "media", [path]);
  return { ok: false as const, message };
}

/**
 * The browser finished uploading: check the stored bytes (not the file
 * name), re-encode images (orientation, sRGB, no metadata, two sizes), and
 * mark the file ready. Large audio/video is checked from its first and last
 * bytes only.
 */
export async function finishAssetUpload(
  assetId: string,
  probe: { duration: number | null; width: number | null; height: number | null },
): Promise<{ ok: true; id: string; note?: string } | { ok: false; message: string }> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  if (!id.safeParse(assetId).success) return { ok: false, message: "That upload wasn't found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("media_admin_asset_processing", { p_id: assetId });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The upload couldn't be checked.") };
  const a = data as { id: string; kind: AssetKind; upload_path: string; mime: string; size: number };

  if (a.kind === "image") {
    const bytes = await downloadObject(supabase, "media", a.upload_path, 60 * 1024 * 1024);
    if (!bytes) return fail(supabase, a.id, a.upload_path, "The image couldn't be read from storage.");
    const processed = await processImage(bytes, LIBRARY_VARIANTS);
    if (!processed.ok) return fail(supabase, a.id, a.upload_path, processed.message);
    const stem = `assets/${a.id}/${randomBytes(9).toString("base64url")}`;
    const main = `${stem}.webp`;
    const small = `${stem}-sm.webp`;
    const okMain = await uploadBytes(supabase, "media", main, processed.outputs.main.bytes, "image/webp");
    const okSmall = okMain && (await uploadBytes(supabase, "media", small, processed.outputs.small.bytes, "image/webp"));
    if (!okMain || !okSmall) {
      await removePaths(supabase, "media", [main, small]);
      return fail(supabase, a.id, a.upload_path, "The processed image couldn't be stored.");
    }
    const { error: completeError } = await supabase.rpc("media_admin_asset_complete", {
      p_id: a.id,
      p_path: main,
      p_variant: small,
      p_mime: "image/webp",
      p_width: processed.outputs.main.width,
      p_height: processed.outputs.main.height,
      p_duration: null,
      p_duration_source: null,
    });
    // The original (which may carry GPS and other metadata) is never kept.
    await removePaths(supabase, "media", [a.upload_path]);
    if (completeError) return { ok: false, message: dbErrorMessage(completeError, "The image couldn't be saved.") };
    revalidatePath("/admin/media");
    return { ok: true, id: a.id };
  }

  const head = await readRange(supabase, "media", a.upload_path, { start: 0, length: 64 * 1024 });
  if (!head) return fail(supabase, a.id, a.upload_path, "The file couldn't be read from storage.");
  const tail = a.kind === "document" && head[0] === 0x50 ? await readRange(supabase, "media", a.upload_path, { suffix: 64 * 1024 }) : null;
  const sniffed = sniffAsset(a.kind, head, tail ?? undefined);
  if (!sniffed.ok) return fail(supabase, a.id, a.upload_path, sniffed.message);
  if (a.kind === "captions") {
    const whole = await downloadObject(supabase, "media", a.upload_path, 2 * 1024 * 1024);
    if (!whole || !/-->/.test(whole.toString("utf8"))) return fail(supabase, a.id, a.upload_path, "That captions file has no cues.");
  }
  let note: string | undefined;
  if (a.kind === "video" && probe.width === null) {
    note = "This browser couldn't preview the video track. It may use a codec (such as HEVC) that some browsers can't play; MP4 with H.264 video and AAC audio plays everywhere.";
  }
  const duration = probe.duration && probe.duration > 0 && probe.duration <= 86_400 ? Math.round(probe.duration * 100) / 100 : null;
  const { error: completeError } = await supabase.rpc("media_admin_asset_complete", {
    p_id: a.id,
    p_path: a.upload_path,
    p_variant: null,
    p_mime: sniffed.mime,
    p_width: a.kind === "video" ? probe.width : null,
    p_height: a.kind === "video" ? probe.height : null,
    p_duration: a.kind === "audio" || a.kind === "video" ? duration : null,
    p_duration_source: duration ? "browser" : null,
  });
  if (completeError) return { ok: false, message: dbErrorMessage(completeError, "The file couldn't be saved.") };
  revalidatePath("/admin/media");
  return { ok: true, id: a.id, note };
}

/** Cancel: marks the upload failed and deletes whatever reached storage. */
export async function cancelAssetUpload(assetId: string, path: string | null): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  if (!id.safeParse(assetId).success) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.rpc("media_admin_asset_fail", { p_id: assetId, p_error: "Cancelled" });
  if (path && path.startsWith(`assets/${assetId}/`)) await removePaths(supabase, "media", [path]);
}

const details = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Give the file a title.").max(160),
  alt_text: z.string().trim().max(500, "Keep the description under 500 characters."),
  rights: z.enum(["unknown", "church_owned", "licensed", "permission", "public_domain"]),
  source: z.string().trim().max(300),
  attribution: z.string().trim().max(300),
  rights_notes: z.string().trim().max(1000),
  confirm_rights: z.boolean(),
  public_ok: z.boolean(),
  label: z.string().trim().max(60),
  language: z.string().trim().max(12),
});

export async function saveAssetDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const values = formValues(formData);
  const parsed = details.safeParse({
    id: formData.get("id"),
    title: formData.get("title") ?? "",
    alt_text: formData.get("alt_text") ?? "",
    rights: formData.get("rights") ?? "unknown",
    source: formData.get("source") ?? "",
    attribution: formData.get("attribution") ?? "",
    rights_notes: formData.get("rights_notes") ?? "",
    confirm_rights: formData.get("confirm_rights") === "on",
    public_ok: formData.get("public_ok") === "on",
    label: formData.get("label") ?? "",
    language: formData.get("language") ?? "",
  });
  if (!parsed.success) return errorState(parsed.error.issues[0]?.message ?? "Please check the details.", { values });
  if (parsed.data.language && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(parsed.data.language)) {
    return errorState("Use a language code such as en or es.", { values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { id: assetId, ...p } = parsed.data;
  const { error } = await supabase.rpc("media_admin_asset_update", { p_id: assetId, p });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath(`/admin/media/${assetId}`);
  return { status: "success", message: "Saved." };
}

export async function saveTranscriptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const assetId = id.safeParse(formData.get("id")).data;
  const transcript = String(formData.get("transcript") ?? "").replace(/\r\n?/g, "\n").slice(0, 200_000);
  if (!assetId) return errorState("That file wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("media_admin_asset_update", { p_id: assetId, p: { transcript } });
  if (error) return errorState(dbErrorMessage(error), { values: { transcript } });
  revalidatePath(`/admin/media/${assetId}`);
  return { status: "success", message: transcript.trim() ? "Transcript saved." : "Transcript removed." };
}

/** Fills the transcript from a captions file (cue text only). */
export async function transcriptFromCaptionsAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const assetId = id.safeParse(formData.get("id")).data;
  const captionId = id.safeParse(formData.get("caption")).data;
  if (!assetId || !captionId) return;
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase.rpc("media_file", { p_asset: captionId });
  const file = data as { path: string; kind: string } | null;
  if (!file || file.kind !== "captions") return;
  const bytes = await downloadObject(supabase, "media", file.path, 2 * 1024 * 1024);
  if (!bytes) return;
  await supabase.rpc("media_admin_asset_update", { p_id: assetId, p: { transcript: vttToTranscript(bytes.toString("utf8")) } });
  revalidatePath(`/admin/media/${assetId}`);
  redirect(`/admin/media/${assetId}?saved=transcript`);
}

export async function addExternalVideoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const values = formValues(formData);
  const url = String(formData.get("url") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  const ref = parseVideoUrl(url);
  if (!ref) {
    return errorState("Paste a YouTube or Vimeo video link (for example https://www.youtube.com/watch?v=… or https://vimeo.com/…). Embed code isn't accepted.", {
      values,
      fieldErrors: { url: ["Use a YouTube or Vimeo video link."] },
    });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const canonical = ref.provider === "youtube" ? `https://www.youtube.com/watch?v=${ref.id}` : ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`;
  // The provider's oEmbed answer: whether it can be embedded, and its real title.
  const check = await checkVideo(ref);
  const { data, error } = await supabase.rpc("media_admin_external_video_save", {
    p_id: null,
    p_provider: ref.provider,
    p_ref: ref.id,
    p_hash: ref.provider === "vimeo" ? ref.hash : null,
    p_url: canonical,
    p_title: title || check.title || (ref.provider === "youtube" ? "YouTube video" : "Vimeo video"),
  });
  if (error || !data) return errorState(dbErrorMessage(error), { values });
  await supabase.rpc("media_admin_video_check_save", { p_id: data, p_status: check.status, p_thumb: check.thumb });
  revalidatePath("/admin/media");
  redirect(`/admin/media/${data as string}?saved=added`);
}

/** Removal (refused while in use): the record first, then the stored files. */
export async function removeAssetAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const assetId = id.safeParse(formData.get("id")).data;
  if (!assetId) redirect("/admin/media");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/media/${assetId}?error=unavailable`);
  const { data, error } = await supabase.rpc("media_admin_asset_remove", { p_id: assetId });
  if (error || !data) redirect(`/admin/media/${assetId}?error=${encodeURIComponent(dbErrorMessage(error, "The file couldn't be removed."))}`);
  const r = data as { paths: string[]; asset_ids: string[] };
  if (await removePaths(supabase, "media", r.paths)) {
    await supabase.rpc("media_admin_objects_deleted", { p_asset_ids: r.asset_ids, p_photo_ids: [] });
  }
  revalidatePath("/admin/media");
  redirect("/admin/media?saved=removed");
}

export async function replaceAssetAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const oldId = id.safeParse(formData.get("id")).data;
  const newId = id.safeParse(formData.get("replacement")).data;
  if (!oldId) redirect("/admin/media");
  if (!newId) redirect(`/admin/media/${oldId}?error=${encodeURIComponent("Choose the replacement file.")}`);
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/media/${oldId}?error=unavailable`);
  const { data, error } = await supabase.rpc("media_admin_asset_replace", {
    p_old: oldId,
    p_new: newId,
    p_move_captions: formData.get("move_captions") === "on",
  });
  if (error || !data) redirect(`/admin/media/${oldId}?error=${encodeURIComponent(dbErrorMessage(error, "The file couldn't be replaced."))}`);
  const r = data as { paths: string[]; asset_ids: string[] };
  if (await removePaths(supabase, "media", r.paths)) {
    await supabase.rpc("media_admin_objects_deleted", { p_asset_ids: r.asset_ids, p_photo_ids: [] });
  }
  revalidatePath("/admin/media");
  redirect(`/admin/media/${newId}?saved=replaced`);
}

/** Deletes the reviewed cleanup candidates the administrator selected. */
export async function runCleanupAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media/cleanup");
  if (formData.get("confirm") !== "on") redirect(`/admin/media/cleanup?error=${encodeURIComponent("Confirm that the selected files can be deleted.")}`);
  const supabase = await createClient();
  if (!supabase) redirect("/admin/media/cleanup?error=unavailable");
  const { data } = await supabase.rpc("media_admin_cleanup_candidates");
  const c = (data ?? {}) as {
    abandoned?: Array<{ id: string; paths: string[] }>;
    removed?: Array<{ id: string; paths: string[] }>;
    photos?: Array<{ id: string; uploads: string[]; media: string[] }>;
    orphans?: Array<{ bucket: "media" | "media-uploads"; path: string }>;
  };
  const chosen = new Set(formData.getAll("pick").map(String));
  const assets = [...(c.abandoned ?? []), ...(c.removed ?? [])].filter((a) => chosen.has(`asset:${a.id}`));
  const photos = (c.photos ?? []).filter((p) => chosen.has(`photo:${p.id}`));
  // Discussion attachments (community/) have their own cleanup in Moderation.
  const orphans = (c.orphans ?? []).filter((o) => chosen.has(`orphan:${o.bucket}:${o.path}`) && !o.path.startsWith("community/"));
  const doneAssets: string[] = [];
  for (const a of assets) if (await removePaths(supabase, "media", a.paths)) doneAssets.push(a.id);
  const donePhotos: string[] = [];
  for (const p of photos) {
    const okUploads = await removePaths(supabase, "media-uploads", p.uploads);
    const okMedia = await removePaths(supabase, "media", p.media);
    if (okUploads && okMedia) donePhotos.push(p.id);
  }
  for (const bucket of ["media", "media-uploads"] as const) {
    await removePaths(supabase, bucket, orphans.filter((o) => o.bucket === bucket).map((o) => o.path));
  }
  if (doneAssets.length || donePhotos.length) {
    await supabase.rpc("media_admin_objects_deleted", { p_asset_ids: doneAssets, p_photo_ids: donePhotos });
  }
  revalidatePath("/admin/media/cleanup");
  redirect(`/admin/media/cleanup?saved=${doneAssets.length + donePhotos.length + orphans.length}`);
}

export async function saveMediaSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Each setting is checked against its own capability in the database.
  await requireAnyCapability([CAPABILITIES.mediaManage, CAPABILITIES.galleryModerate, CAPABILITIES.podcastsManage], "/admin/media/settings");
  const values = formValues(formData);
  const keys = [
    "audio_max_mb", "video_max_mb", "document_max_mb", "image_max_mb", "storage_quota_mb", "abandoned_upload_hours",
    "gallery_file_mb", "gallery_batch_max", "gallery_daily_max", "gallery_pending_max", "feed_refresh_minutes",
  ];
  const p: Record<string, number> = {};
  for (const k of keys) {
    const raw = formData.get(k);
    if (raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return errorState("Use whole numbers.", { values, fieldErrors: { [k]: ["Use a whole number."] } });
    p[k] = n;
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("media_admin_settings_save", { p });
  if (error) return errorState(dbErrorMessage(error, "The settings couldn't be saved. Check that each value is within its allowed range."), { values });
  revalidatePath("/admin/media/settings");
  return { status: "success", message: "Settings saved." };
}

/** Asks YouTube/Vimeo again whether a library video can be played here, and records the answer. */
export async function checkVideoAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const assetId = id.safeParse(formData.get("id")).data;
  if (!assetId) redirect("/admin/media");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/media/${assetId}?error=unavailable`);
  const { data } = await supabase.rpc("media_admin_asset", { p_id: assetId });
  const ref = data ? storedVideoRef(data as { provider: string | null; provider_ref: string | null; provider_hash: string | null }) : null;
  if (!ref) redirect(`/admin/media/${assetId}`);
  const check = await checkVideo(ref);
  await supabase.rpc("media_admin_video_check_save", { p_id: assetId, p_status: check.status, p_thumb: check.thumb });
  revalidatePath(`/admin/media/${assetId}`);
  redirect(`/admin/media/${assetId}?saved=checked`);
}

/** "Publish for members": a draft video page for this library video (or the existing one), opened in the editor. */
export async function publishVideoAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.contentEdit, "/admin/media");
  const assetId = id.safeParse(formData.get("id")).data;
  if (!assetId) redirect("/admin/media");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/media/${assetId}?error=unavailable`);
  const { data, error } = await supabase.rpc("media_admin_video_publish", { p_asset: assetId });
  if (error || !data) redirect(`/admin/media/${assetId}?error=${encodeURIComponent(dbErrorMessage(error, "The video page couldn't be created."))}`);
  const r = data as { id: string; created: boolean };
  revalidatePath("/admin/content");
  redirect(`/admin/content/${r.id}?saved=${r.created ? "video_created" : "video_existing"}`);
}
