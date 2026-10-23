import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Translation } from "@/lib/bible/types";
import { loadMemoryOptions, memoryEligibility, type IneligibleReason } from "./eligibility";
import type { MemoryTranslations } from "./types";

export type MemoryVersions = MemoryTranslations & {
  /** Published versions members can read but not memorize now, with the reason (shown disabled). */
  unavailable: Array<Translation & { memory_reason: IneligibleReason }>;
};

/**
 * The versions a member can memorize, plus the published ones that can't be
 * (shown disabled with the reason), by the shared eligibility rule
 * (./eligibility): a licensed version also needs its API key on this server.
 */
export async function loadMemoryVersions(supabase: SupabaseClient): Promise<MemoryVersions> {
  const [mem, options] = await Promise.all([supabase.rpc("memory_translations"), loadMemoryOptions(supabase)]);
  const versions = (mem.data as MemoryTranslations | null) ?? { effective_id: null, source: "none", church_id: null, reading_id: null, items: [] };
  const blocked = new Map(options.flatMap((o) => {
    const e = memoryEligibility(o);
    return e.eligible ? [] : [[o.id, { ...o, memory_reason: e.reason }] as const];
  }));
  const items = versions.items.filter((t) => !blocked.has(t.id));
  return {
    ...versions,
    items,
    // A default that can't be fetched here isn't offered as the starting choice.
    effective_id: items.some((t) => t.id === versions.effective_id) ? versions.effective_id : null,
    unavailable: [...blocked.values()],
  };
}
