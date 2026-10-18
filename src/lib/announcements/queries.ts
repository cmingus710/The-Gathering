import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnnouncementStatus, AnnouncementVisibility } from "./status";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  image_path: string | null;
  image_alt: string | null;
  status: AnnouncementStatus;
  visibility: AnnouncementVisibility;
  pinned: boolean;
  publish_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnnouncementWithImage = Announcement & { imageUrl: string | null };

const COLUMNS =
  "id, title, body, image_path, image_alt, status, visibility, pinned, publish_at, expires_at, created_at, updated_at";

/**
 * Announcements the current caller may read *as a reader*. RLS already limits
 * rows by audience and schedule; the explicit filters below make managers see
 * the same reader view here (their drafts appear only in the admin area).
 */
export async function listLiveAnnouncements(
  supabase: SupabaseClient,
  opts: { limit?: number; audience?: "public" | "all" } = {},
): Promise<AnnouncementWithImage[]> {
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("announcements")
    .select(COLUMNS)
    .in("status", ["scheduled", "published"])
    .lte("publish_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt."${nowIso}"`)
    .order("pinned", { ascending: false })
    .order("publish_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.audience === "public") query = query.eq("visibility", "public");
  const { data, error } = await query;
  if (error) throw new Error("Announcements could not be loaded.");
  return withImageUrls(supabase, (data ?? []) as Announcement[]);
}

export async function getLiveAnnouncement(supabase: SupabaseClient, id: string): Promise<AnnouncementWithImage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcements")
    .select(COLUMNS)
    .eq("id", id)
    .in("status", ["scheduled", "published"])
    .lte("publish_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt."${nowIso}"`)
    .maybeSingle();
  if (error) throw new Error("The announcement could not be loaded.");
  if (!data) return null;
  const [withUrl] = await withImageUrls(supabase, [data as Announcement]);
  return withUrl;
}

/** Short-lived signed URLs; storage RLS re-checks that the caller may see each image. */
export async function withImageUrls(supabase: SupabaseClient, rows: Announcement[]): Promise<AnnouncementWithImage[]> {
  const paths = rows.map((r) => r.image_path).filter((p): p is string => Boolean(p));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from("announcement-images").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return rows.map((r) => ({ ...r, imageUrl: r.image_path ? (urls.get(r.image_path) ?? null) : null }));
}
