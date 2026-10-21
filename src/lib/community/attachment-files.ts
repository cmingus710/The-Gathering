import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removePaths } from "@/lib/media/storage";

/** Stored files of one attachment, as the database returns them for deletion. */
export type AttachmentFiles = { id: string; uploads: string[]; media: string[] };

/**
 * Deletes attachment files with the caller's own session (Storage RLS:
 * owners, community moderators, media managers), then records it. The
 * database checks Storage itself before recording, so a failed delete just
 * leaves the item in Moderation → Attachment cleanup.
 */
export async function deleteAttachmentFiles(supabase: SupabaseClient, files: AttachmentFiles[] | null | undefined): Promise<number> {
  const done: string[] = [];
  for (const f of files ?? []) {
    const uploads = await removePaths(supabase, "media-uploads", f.uploads ?? []);
    const media = await removePaths(supabase, "media", f.media ?? []);
    if (uploads && media) done.push(f.id);
  }
  if (!done.length) return 0;
  const { data } = await supabase.rpc("community_attachments_objects_deleted", { p_ids: done });
  return Number(data) || 0;
}
