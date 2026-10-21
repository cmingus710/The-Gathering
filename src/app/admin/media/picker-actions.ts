"use server";

import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { signPaths } from "@/lib/media/storage";
import type { AssetRow } from "@/lib/media/types";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Read-only lookups for the in-editor image picker (cover images). They act
 * as the signed-in person: media_admin_assets / media_admin_asset decide who
 * may browse the library (the same people who can open /admin/media), and
 * thumbnails are 5-minute signed links that Storage RLS allows or refuses.
 */
const LIBRARY_ROLES = [CAPABILITIES.mediaManage, CAPABILITIES.contentEdit, CAPABILITIES.contentPublish, CAPABILITIES.podcastsManage];
const PAGE = 24;

export type ImageChoice = {
  id: string;
  title: string;
  alt_text: string;
  width: number | null;
  height: number | null;
  public_ok: boolean;
  status: AssetRow["status"];
  /** Short-lived signed link to the small (640 px) copy, or null if storage refused it. */
  url: string | null;
};

type Row = Pick<AssetRow, "id" | "kind" | "status" | "title" | "path" | "variant_path" | "alt_text" | "width" | "height" | "public_ok">;

async function withUrls(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, rows: Row[]): Promise<ImageChoice[]> {
  const signed = await signPaths(supabase, rows.map((r) => r.variant_path ?? r.path));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    alt_text: r.alt_text ?? "",
    width: r.width,
    height: r.height,
    public_ok: r.public_ok,
    status: r.status,
    url: signed.get((r.variant_path ?? r.path) as string) ?? null,
  }));
}

export async function listLibraryImages(input: {
  q: string;
  offset: number;
}): Promise<{ ok: true; items: ImageChoice[]; total: number } | { ok: false; message: string }> {
  await requireAnyCapability(LIBRARY_ROLES, "/admin/media");
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "The media library is unavailable." };
  const q = String(input.q ?? "").trim().slice(0, 80);
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const { data, error } = await supabase.rpc("media_admin_assets", { p_kind: "image", p_status: "ready", p_q: q || null, p_limit: PAGE, p_offset: offset });
  if (error || !data) return { ok: false, message: dbErrorMessage(error, "The media library couldn't be loaded.") };
  const d = data as { items: Row[]; total: number };
  return { ok: true, items: await withUrls(supabase, d.items ?? []), total: d.total ?? 0 };
}

/** One image's preview and saved description (the current cover, or one just uploaded). */
export async function describeLibraryImage(assetId: string): Promise<ImageChoice | null> {
  await requireAnyCapability(LIBRARY_ROLES, "/admin/media");
  if (!z.uuid().safeParse(assetId).success) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("media_admin_asset", { p_id: assetId });
  const row = data as Row | null;
  if (error || !row || row.kind !== "image") return null;
  return (await withUrls(supabase, [row]))[0];
}
