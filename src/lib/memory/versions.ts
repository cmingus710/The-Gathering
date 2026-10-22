import type { SupabaseClient } from "@supabase/supabase-js";
import type { Translation } from "@/lib/bible/types";
import type { MemoryTranslations } from "./types";

export type MemoryVersions = MemoryTranslations & {
  /** Active Bible versions members can read but not memorize (read live from an outside service, never stored). */
  unavailable: Translation[];
};

/** The versions a member can memorize, plus the readable ones that can't be (shown disabled with the reason). */
export async function loadMemoryVersions(supabase: SupabaseClient): Promise<MemoryVersions> {
  const [mem, all] = await Promise.all([supabase.rpc("memory_translations"), supabase.rpc("bible_translations")]);
  const versions = (mem.data as MemoryTranslations | null) ?? { effective_id: null, source: "none", church_id: null, reading_id: null, items: [] };
  const usable = new Set(versions.items.map((t) => t.id));
  const readable = (all.data as { items: Translation[] } | null)?.items ?? [];
  return { ...versions, unavailable: readable.filter((t) => !usable.has(t.id)) };
}
