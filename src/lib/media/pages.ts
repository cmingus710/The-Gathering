import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coverPaths } from "./format";
import { signPaths } from "./storage";
import type { ItemCard, ItemDetail, ItemKind } from "./types";

/**
 * Loads one item for its page with everything the page shows: signed cover
 * links (Storage RLS decides) and transcripts. Returns null when the viewer
 * can't see it (or it's another kind), so the page shows "not found".
 */
export async function loadItemPage(supabase: SupabaseClient, id: string, kinds: ItemKind[]) {
  const { data, error } = await supabase.rpc("media_item", { p_id: id });
  if (error || !data) return null;
  const item = data as ItemDetail;
  if (!kinds.includes(item.kind)) return null;
  return prepareDetail(supabase, item);
}

/** Signed cover links and transcripts for a detail the viewer may see. */
export async function prepareDetail(supabase: SupabaseClient, item: ItemDetail, extraCards: ItemCard[] = []) {
  const urls = await signPaths(supabase, [...coverPaths([item], "large"), ...coverPaths([...item.related, ...(item.assignments ?? []), ...extraCards])]);
  const transcripts: Record<string, string> = {};
  await Promise.all(
    item.attachments
      .filter((a) => a.has_transcript)
      .map(async (a) => {
        const { data: t } = await supabase.rpc("media_transcript", { p_asset: a.asset_id });
        if (typeof t === "string" && t.trim()) transcripts[a.asset_id] = t;
      }),
  );
  return { item, urls, transcripts };
}

export async function listItems(supabase: SupabaseClient, kind: ItemKind, filters: Record<string, unknown>, limit = 20, offset = 0) {
  const { data, error } = await supabase.rpc("media_items", { p_kind: kind, p_filters: filters, p_limit: limit, p_offset: offset });
  const r = (data ?? { items: [], total: 0 }) as { items: ItemCard[]; total: number };
  return { ok: !error, items: r.items, total: r.total };
}
