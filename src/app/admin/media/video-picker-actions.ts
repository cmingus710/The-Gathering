"use server";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { parseVideoUrl, type VideoRef } from "@/lib/media/embeds";
import type { AssetRow, VideoInfo } from "@/lib/media/types";
import { checkVideo } from "@/lib/media/video-provider";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The in-editor video picker: browse ready library videos, or add a
 * YouTube/Vimeo link without leaving the editor. Both act as the signed-in
 * person; the database decides who may browse (anyone who can open the
 * media library) and who may add a link (media managers, as in the
 * library). Nothing is attached until the editor's form is saved.
 */
const LIBRARY_ROLES = [CAPABILITIES.mediaManage, CAPABILITIES.contentEdit, CAPABILITIES.contentPublish, CAPABILITIES.podcastsManage];
const PAGE = 20;

export type VideoChoice = VideoInfo & { public_ok: boolean; provider_status: string | null };

type Row = AssetRow & { has_thumb?: boolean };

const choice = (r: Row): VideoChoice => ({
  asset_id: r.id,
  kind: r.kind === "external_video" ? "external_video" : "video",
  title: r.title,
  provider: r.provider,
  provider_ref: r.provider_ref,
  provider_hash: r.provider_hash,
  duration_seconds: r.duration_seconds,
  width: r.width,
  height: r.height,
  has_thumb: r.has_thumb ?? (r.kind === "external_video" && r.provider === "youtube"),
  unavailable: r.provider_status === "unavailable" || r.provider_status === "not_embeddable",
  attribution: r.attribution,
  captions: [],
  public_ok: r.public_ok,
  provider_status: r.provider_status ?? null,
});

export async function listLibraryVideos(input: { q: string; offset: number }): Promise<{ ok: true; items: VideoChoice[]; more: boolean } | { ok: false; message: string }> {
  await requireAnyCapability(LIBRARY_ROLES, "/admin/media");
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "The media library is unavailable." };
  const q = String(input.q ?? "").trim().slice(0, 80) || null;
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  // Two kinds, newest first; each page asks both for the next slice.
  const [ext, files] = await Promise.all(
    ["external_video", "video"].map((kind) => supabase.rpc("media_admin_assets", { p_kind: kind, p_status: "ready", p_q: q, p_limit: PAGE, p_offset: offset })),
  );
  if (ext.error && files.error) return { ok: false, message: dbErrorMessage(ext.error, "The media library couldn't be loaded.") };
  const rows = [ext, files].flatMap((r) => ((r.data as { items?: Row[] } | null)?.items ?? []));
  const totals = [ext, files].map((r) => (r.data as { total?: number } | null)?.total ?? 0);
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { ok: true, items: rows.map(choice), more: totals.some((t) => t > offset + PAGE) };
}

function canonicalUrl(ref: VideoRef): string {
  return ref.provider === "youtube" ? `https://www.youtube.com/watch?v=${ref.id}` : ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`;
}

/** Adds a link to the library (or finds the existing record for that video) and returns it for the picker. */
export async function addVideoLink(input: { url: string }): Promise<{ ok: true; video: VideoChoice; created: boolean } | { ok: false; message: string }> {
  await requireCapability(CAPABILITIES.mediaManage, "/admin/media");
  const ref = parseVideoUrl(String(input.url ?? ""));
  if (!ref) return { ok: false, message: "Paste a YouTube or Vimeo video link, such as https://www.youtube.com/watch?v=… (embed code isn't accepted)." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "The media library is unavailable." };
  const check = await checkVideo(ref);
  const { data, error } = await supabase.rpc("media_admin_video_link_add", {
    p_provider: ref.provider,
    p_ref: ref.id,
    p_hash: ref.provider === "vimeo" ? ref.hash : null,
    p_url: canonicalUrl(ref),
    // The provider's own title when it answered; otherwise a plain label to rename in the library.
    p_title: check.title ?? (ref.provider === "youtube" ? "YouTube video" : "Vimeo video"),
  });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The video couldn't be added.") };
  const row = data as Row & { created: boolean };
  await supabase.rpc("media_admin_video_check_save", { p_id: row.id, p_status: check.status, p_thumb: check.thumb });
  return { ok: true, video: choice({ ...row, provider_status: check.status }), created: row.created };
}
