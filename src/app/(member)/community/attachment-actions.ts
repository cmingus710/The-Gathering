"use server";

import { randomBytes } from "node:crypto";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deleteAttachmentFiles, type AttachmentFiles } from "@/lib/community/attachment-files";
import { ATTACHMENT_LIMITS, checkForumVideo, classifyAttachment } from "@/lib/community/attachments";
import { getSupabasePublicConfig } from "@/lib/env";
import { isUuid } from "@/lib/media/format";
import { GALLERY_VARIANTS, processImage } from "@/lib/media/images";
import { createUploadToken, downloadObject, readRange, removePaths, uploadBytes, type Bucket } from "@/lib/media/storage";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Photo and video attachments for discussions and replies. The same steps
 * as gallery uploads (src/app/(member)/gallery/actions.ts), always as the
 * signed-in member so the database and Storage RLS check every request:
 *   begin    → a one-time token to upload straight to Storage
 *   process  → photos: decode (HEIC too), orient, strip location and camera
 *              data, WebP copies; the original is deleted.
 *              video: MP4 with H.264 only (checked from its bytes)
 *   discard  → cancel or remove before posting; files deleted at once
 * The draft is attached when the post is created (see actions.ts).
 */
const UNAVAILABLE = "Uploads are unavailable right now. Nothing was uploaded.";

export type AttachmentBegin =
  | {
      ok: true;
      id: string;
      kind: "image" | "video";
      bucket: Bucket;
      path: string;
      token: string;
      supabaseUrl: string;
      publishableKey: string;
      contentType: string;
      status: string;
    }
  | { ok: false; message: string };

export type AttachmentProcessed = { ok: true } | { ok: false; message: string; retryable: boolean };

export async function beginAttachment(input: {
  batchKey: string;
  clientKey: string;
  name: string;
  type: string;
  size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}): Promise<AttachmentBegin> {
  await requireApprovedMember("/community");
  const config = getSupabasePublicConfig();
  const supabase = await createClient();
  if (!supabase || !config) return { ok: false, message: UNAVAILABLE };
  if (!isUuid(input.batchKey) || !isUuid(input.clientKey)) return { ok: false, message: "That upload request wasn't valid." };
  const kind = classifyAttachment(String(input.name ?? ""), String(input.type ?? ""), Number(input.size));
  if (!kind.ok) return { ok: false, message: kind.message };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const { data, error } = await supabase.rpc("community_attachment_begin", {
    p_batch_key: input.batchKey,
    p_client_key: input.clientKey,
    p_kind: kind.kind,
    p_mime: kind.mime,
    p_size: Math.round(Number(input.size)),
    p_width: num(input.width) ? Math.round(input.width!) : null,
    p_height: num(input.height) ? Math.round(input.height!) : null,
    p_duration: num(input.duration),
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "That file couldn't be added.") };
  const begun = data as { id: string; bucket: Bucket; path: string | null; status: string };
  const base = { ok: true as const, id: begun.id, kind: kind.kind, bucket: begun.bucket, supabaseUrl: config.url, publishableKey: config.publishableKey, contentType: kind.mime, status: begun.status };
  if (begun.status !== "uploading" || !begun.path) return { ...base, path: begun.path ?? "", token: "" };
  const token = await createUploadToken(supabase, begun.bucket, begun.path);
  if (!token) return { ok: false, message: "Storage didn't accept the upload. Try again in a moment." };
  return { ...base, path: begun.path, token: token.token };
}

export async function processAttachment(id: string): Promise<AttachmentProcessed> {
  await requireApprovedMember("/community");
  if (!isUuid(id)) return { ok: false, message: "That upload wasn't found.", retryable: false };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE, retryable: true };
  const { data, error } = await supabase.rpc("community_attachment_processing", { p_id: id });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The file couldn't be processed."), retryable: false };
  const job = data as { kind: "image" | "video"; bucket: Bucket; path: string };

  // A problem with the file itself: remove it, so nothing unusable is kept.
  const reject = async (message: string): Promise<AttachmentProcessed> => {
    await supabase.rpc("community_attachment_fail", { p_id: id, p_error: message });
    const { data: files } = await supabase.rpc("community_attachment_discard", { p_id: id });
    await deleteAttachmentFiles(supabase, files ? [files as AttachmentFiles] : []);
    return { ok: false, message, retryable: false };
  };
  // A storage hiccup: keep the upload so Retry can process it again.
  const later = async (message: string): Promise<AttachmentProcessed> => {
    await supabase.rpc("community_attachment_fail", { p_id: id, p_error: message });
    return { ok: false, message, retryable: true };
  };

  if (job.kind === "video") {
    const head = await readRange(supabase, job.bucket, job.path, { start: 0, length: 1024 * 1024 });
    if (!head) return later("The video couldn't be checked. Try again.");
    const tail = await readRange(supabase, job.bucket, job.path, { suffix: 1024 * 1024 });
    const checked = checkForumVideo(head, tail ?? undefined);
    if (!checked.ok) return reject(checked.message);
    const { error: readyError } = await supabase.rpc("community_attachment_ready", { p_id: id });
    if (readyError) return reject(dbErrorMessage(readyError, "The video couldn't be saved."));
    return { ok: true };
  }

  const bytes = await downloadObject(supabase, job.bucket, job.path, (ATTACHMENT_LIMITS.imageMb + 1) * 1024 * 1024);
  if (!bytes) return later("The photo couldn't be read. Try again.");
  const processed = await processImage(bytes, GALLERY_VARIANTS);
  if (!processed.ok) return reject(processed.message);
  const stem = `${job.path.split("/").slice(0, 3).join("/")}/v-${randomBytes(6).toString("base64url")}`;
  const display = `${stem}-display.webp`;
  const thumb = `${stem}-thumb.webp`;
  const stored =
    (await uploadBytes(supabase, "media", display, processed.outputs.display.bytes, "image/webp")) &&
    (await uploadBytes(supabase, "media", thumb, processed.outputs.thumb.bytes, "image/webp"));
  if (!stored) {
    await removePaths(supabase, "media", [display, thumb]);
    return later("The processed photo couldn't be stored. Try again.");
  }
  const { error: readyError } = await supabase.rpc("community_attachment_ready", {
    p_id: id,
    p_display: display,
    p_thumb: thumb,
    p_width: processed.outputs.display.width,
    p_height: processed.outputs.display.height,
    p_size: processed.outputs.display.bytes.byteLength,
    p_hash: processed.hash,
  });
  if (readyError) {
    await removePaths(supabase, "media", [display, thumb]);
    return reject(dbErrorMessage(readyError, "The photo couldn't be saved."));
  }
  // The original (with its camera and location data) is never kept.
  await removePaths(supabase, job.bucket, [job.path]);
  return { ok: true };
}

/** Cancel an upload, or remove a photo or video before posting. */
export async function discardAttachment(id: string): Promise<void> {
  await requireApprovedMember("/community");
  if (!isUuid(id)) return;
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase.rpc("community_attachment_discard", { p_id: id });
  if (data) await deleteAttachmentFiles(supabase, [data as AttachmentFiles]);
}
