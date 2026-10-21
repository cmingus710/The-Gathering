"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { deleteAttachmentFiles, type AttachmentFiles } from "@/lib/community/attachment-files";
import { removePaths } from "@/lib/media/storage";
import { createClient } from "@/lib/supabase/server";

const PAGE = "/admin/moderation/attachments";

/**
 * Deletes the reviewed attachment files a moderator selected: abandoned
 * drafts (never posted), removed attachments whose files remain, and
 * unreferenced files under community/. The database re-lists candidates and
 * only discards drafts that are actually abandoned.
 */
export async function runAttachmentCleanupAction(formData: FormData): Promise<void> {
  await requireAnyCapability([CAPABILITIES.communityModerate, CAPABILITIES.mediaManage], PAGE);
  if (formData.get("confirm") !== "on") redirect(`${PAGE}?error=${encodeURIComponent("Confirm that the selected files can be deleted.")}`);
  const supabase = await createClient();
  if (!supabase) redirect(`${PAGE}?error=unavailable`);
  const { data } = await supabase.rpc("community_mod_attachment_cleanup");
  const c = (data ?? {}) as { abandoned?: AttachmentFiles[]; removed?: AttachmentFiles[]; orphans?: Array<{ bucket: "media" | "media-uploads"; path: string }> };
  const chosen = new Set(formData.getAll("pick").map(String));
  const ids = [...(c.abandoned ?? []), ...(c.removed ?? [])].map((a) => a.id).filter((id) => chosen.has(`attachment:${id}`));
  const orphans = (c.orphans ?? []).filter((o) => chosen.has(`orphan:${o.bucket}:${o.path}`) && o.path.startsWith("community/"));
  let done = 0;
  if (ids.length) {
    const { data: files } = await supabase.rpc("community_mod_attachment_discard", { p_ids: ids });
    done += await deleteAttachmentFiles(supabase, files as AttachmentFiles[] | null);
  }
  for (const bucket of ["media", "media-uploads"] as const) {
    const paths = orphans.filter((o) => o.bucket === bucket).map((o) => o.path);
    if (paths.length && (await removePaths(supabase, bucket, paths))) done += paths.length;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${done}`);
}
