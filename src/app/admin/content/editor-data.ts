import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetRow, ItemKind, ItemState } from "@/lib/media/types";

export type EditorOptions = {
  shows: Array<{ id: string; title: string; status: string; audience: string }>;
  books: Array<{ id: string; title: string; state: ItemState }>;
  groups: Array<{ id: string; name: string }>;
  threads: Array<{ id: string; title: string; group_id: string | null; group: string | null }>;
  can_publish: boolean;
  can_manage_media: boolean;
};

export type Taxonomy = {
  series: Array<{ id: string; scope: string; title: string; description: string; cover_asset_id: string | null; archived: boolean; items: number }>;
  people: Array<{ id: string; name: string; archived: boolean; items: number }>;
  topics: Array<{ id: string; name: string; items: number }>;
};

export type AssetChoice = Pick<AssetRow, "id" | "kind" | "title" | "mime" | "duration_seconds" | "public_ok" | "rights" | "rights_confirmed_at" | "provider">;

export type EditorData = {
  options: EditorOptions;
  taxonomy: Taxonomy;
  assets: Record<"audio" | "video" | "document", AssetChoice[]>;
  /** Media library upload limit for images (the cover image control). */
  imageMaxMb: number | undefined;
  items: Array<{ id: string; kind: ItemKind; title: string; state: ItemState }>;
};

export async function loadEditorData(supabase: SupabaseClient): Promise<EditorData | null> {
  const ready = (kind: string) => supabase.rpc("media_admin_assets", { p_kind: kind, p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 });
  const [options, taxonomy, audio, video, external, document, items, settings] = await Promise.all([
    supabase.rpc("media_admin_item_options"),
    supabase.rpc("media_admin_taxonomy"),
    ready("audio"),
    ready("video"),
    ready("external_video"),
    ready("document"),
    supabase.rpc("media_admin_items", { p_kind: null, p_state: null, p_q: null, p_limit: 100, p_offset: 0 }),
    supabase.rpc("media_admin_settings"),
  ]);
  if (options.error || !options.data || taxonomy.error) return null;
  const list = (r: { data: unknown }) => ((r.data as { items: AssetChoice[] } | null)?.items ?? []) as AssetChoice[];
  return {
    options: options.data as EditorOptions,
    taxonomy: taxonomy.data as Taxonomy,
    assets: { audio: list(audio), video: [...list(video), ...list(external)], document: list(document) },
    imageMaxMb: (settings.data as { image_max_mb?: number } | null)?.image_max_mb,
    items: ((items.data as { items: EditorData["items"] } | null)?.items ?? []) as EditorData["items"],
  };
}
