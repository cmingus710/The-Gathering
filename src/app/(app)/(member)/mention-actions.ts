"use server";

import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { signGroupImages } from "@/lib/community/queries";
import type { GroupNotify, MentionSuggestions } from "@/lib/community/mentions";
import { signPhotoUrls } from "@/lib/profile/photos";
import { createClient } from "@/lib/supabase/server";

/**
 * @mention suggestions for every composer (Community posts and comments,
 * prayer requests and prayer comments). The database decides who and which
 * groups qualify for the place, with each module's own access rules
 * (community_mention_suggest: the post's category or group; prayer_mention_
 * suggest: the request's audience, never the writer of an anonymous request,
 * nothing for confidential requests or drafts). It returns at most 8 people
 * (name, shared photo, shared city) and 5 groups (name, image, whether
 * choosing it notifies, and how many people only when it does). Photos and
 * group images are signed here, so storage rules check them again.
 * Failures just mean no suggestions.
 */
const uuid = z.uuid();
const place = z.union([
  z.object({ module: z.literal("community"), threadId: uuid }),
  z.object({ module: z.literal("community"), categoryId: uuid.nullable(), groupId: uuid.nullable() }),
  z.object({ module: z.literal("prayer"), requestId: uuid, anonymous: z.boolean().optional() }),
  z.object({ module: z.literal("prayer"), audience: z.enum(["church", "group", "team", "private"]), groupId: uuid.nullable(), anonymous: z.boolean() }),
]);
const input = z.object({ query: z.string().max(100), place });

export type MentionPlace = z.input<typeof place>;

type PersonRow = { id: string; name: string; photo_path: string | null; detail: string | null };
type GroupRow = { id: string; name: string; image_path: string | null; notify: GroupNotify; reach: number | null };
type Answer = { members?: PersonRow[]; groups?: GroupRow[]; unavailable?: "team" | "private" | null };

const EMPTY: MentionSuggestions = { members: [], groups: [] };

export async function mentionSuggestionsAction(raw: z.input<typeof input>): Promise<MentionSuggestions> {
  await requireApprovedMember(raw?.place?.module === "prayer" ? "/prayer" : "/community");
  const parsed = input.safeParse(raw);
  if (!parsed.success || !parsed.data.query.trim()) return EMPTY;
  const supabase = await createClient();
  if (!supabase) return EMPTY;
  const p = parsed.data.place;
  const q = parsed.data.query;
  const { data, error } =
    p.module === "community"
      ? await supabase.rpc("community_mention_suggest", {
          p_query: q,
          p_thread: "threadId" in p ? p.threadId : null,
          p_category: "threadId" in p ? null : p.categoryId,
          p_group: "threadId" in p ? null : p.groupId,
        })
      : await supabase.rpc("prayer_mention_suggest", {
          p_query: q,
          p_request: "requestId" in p ? p.requestId : null,
          p_audience: "requestId" in p ? null : p.audience,
          p_group: "requestId" in p ? null : p.groupId,
          p_anonymous: p.anonymous ?? false,
        });
  let answer: Answer;
  if (!error && data && typeof data === "object") answer = data as Answer;
  else if (p.module === "community") {
    // Before migration 20261108000100: the people-only search from 20261107000100.
    const old = await supabase.rpc("community_mention_search", {
      p_query: q,
      p_thread: "threadId" in p ? p.threadId : null,
      p_category: "threadId" in p ? null : p.categoryId,
      p_group: "threadId" in p ? null : p.groupId,
    });
    if (old.error || !Array.isArray(old.data)) return EMPTY;
    answer = { members: old.data as PersonRow[] };
  } else return EMPTY;
  const people = Array.isArray(answer.members) ? answer.members : [];
  const groups = Array.isArray(answer.groups) ? answer.groups : [];
  const [photos, images] = await Promise.all([signPhotoUrls(supabase, people.map((r) => r.photo_path)), signGroupImages(groups.map((g) => g.image_path))]);
  return {
    members: people.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_path ? (photos.get(r.photo_path) ?? null) : null, detail: r.detail })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      imageUrl: g.image_path ? (images.get(g.image_path) ?? null) : null,
      notify: g.notify,
      reach: g.reach == null ? null : Number(g.reach),
    })),
    unavailable: answer.unavailable ?? null,
  };
}

/**
 * Prayer composer: before saving with a different audience, which chosen
 * people and groups couldn't be mentioned there, and which groups wouldn't
 * be notified. Ids only; nothing is saved.
 */
const checkInput = z.object({
  audience: z.enum(["church", "group", "team", "private"]),
  groupId: uuid.nullable(),
  anonymous: z.boolean(),
  people: z.array(uuid).max(10),
  groups: z.array(uuid).max(10),
});

export type MentionCheck = { unavailable: "team" | "private" | null; people: string[]; groups: string[]; quiet: string[] };

export async function prayerMentionCheckAction(raw: z.input<typeof checkInput>): Promise<MentionCheck | null> {
  await requireApprovedMember("/prayer");
  const parsed = checkInput.safeParse(raw);
  if (!parsed.success) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("prayer_mention_check", {
    p_audience: parsed.data.audience,
    p_group: parsed.data.groupId,
    p_anonymous: parsed.data.anonymous,
    p_people: parsed.data.people,
    p_groups: parsed.data.groups,
  });
  if (error || !data) return null;
  return data as MentionCheck;
}
