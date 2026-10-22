"use server";

import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import type { MentionSuggestion } from "@/lib/community/mentions";
import { signPhotoUrls } from "@/lib/profile/photos";
import { createClient } from "@/lib/supabase/server";

/**
 * Members the composer may suggest after "@". The database decides who
 * qualifies for this place (directory listing, the group's members, blocks;
 * never pending, suspended, or youth accounts) and returns at most 8, with
 * only a name, a shared photo, and a shared city. Photos are signed here,
 * so storage rules check them again. Failures just mean no suggestions.
 */
const input = z.object({
  query: z.string().max(100),
  threadId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  groupId: z.uuid().nullish(),
});

type Row = { id: string; name: string; photo_path: string | null; detail: string | null };

export async function mentionSuggestionsAction(raw: z.input<typeof input>): Promise<MentionSuggestion[]> {
  await requireApprovedMember("/community");
  const parsed = input.safeParse(raw);
  if (!parsed.success || !parsed.data.query.trim()) return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("community_mention_search", {
    p_query: parsed.data.query,
    p_thread: parsed.data.threadId ?? null,
    p_category: parsed.data.threadId ? null : (parsed.data.categoryId ?? null),
    p_group: parsed.data.threadId ? null : (parsed.data.groupId ?? null),
  });
  if (error || !Array.isArray(data)) return [];
  const rows = data as Row[];
  const urls = await signPhotoUrls(supabase, rows.map((r) => r.photo_path));
  return rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null, detail: r.detail }));
}
