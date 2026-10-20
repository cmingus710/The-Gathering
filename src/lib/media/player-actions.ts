"use server";

import { createClient } from "@/lib/supabase/server";

const KEY = /^[ae]:[0-9a-f-]{36}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves the member's own listening/viewing position. The database checks
 * that the member may play this media right now; visitors and anything the
 * member can't see are ignored. Positions are private to the member: there
 * is no administrator view of who listened to what.
 */
export async function saveProgress(key: string, itemId: string | null, position: number, duration: number | null, completed: boolean): Promise<boolean> {
  if (!KEY.test(key) || (itemId && !UUID.test(itemId)) || !Number.isFinite(position)) return false;
  const supabase = await createClient();
  if (!supabase) return false;
  const { error } = await supabase.rpc("media_progress_save", {
    p_key: key,
    p_item: itemId,
    p_position: Math.max(0, Math.min(position, 86_400)),
    p_duration: duration && Number.isFinite(duration) ? Math.min(duration, 86_400) : null,
    p_completed: completed,
  });
  return !error;
}
