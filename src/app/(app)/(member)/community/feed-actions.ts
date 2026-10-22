"use server";

import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { renderCommunityText } from "@/lib/community/format";
import { communityRpc } from "@/lib/community/queries";
import type { CommentPage, FeedPage, FeedPost, RenderedComment, RenderedPost } from "@/lib/community/types";
import { dbErrorMessage } from "@/lib/supabase/errors";

/**
 * Reads for the Community feed after the first page: more posts, one post
 * again after an action, comments, and the "new posts" count. Each runs the
 * access-checked database function as the signed-in member and renders text
 * with the safe community renderer, so the browser never sees more than the
 * server pages do.
 */
const LOAD_FAILED = "That couldn't be loaded right now. Please try again.";
const uuid = z.uuid();
const optionalUuid = z.union([z.uuid(), z.null(), z.undefined()]).transform((v) => v ?? null);
const cursor = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).nullish().transform((v) => v ?? null);
const place = z.object({ category: optionalUuid, group: optionalUuid });

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function renderPost(post: FeedPost): RenderedPost {
  return { ...post, html: post.body ? renderCommunityText(post.body, { mentions: post.mentions }) : null };
}

export async function loadFeedAction(input: { category?: string | null; group?: string | null; cursor?: { at: string; id: string } | null }): Promise<
  Result<{ items: RenderedPost[]; next_cursor: FeedPage["next_cursor"] }>
> {
  await requireApprovedMember("/community");
  const parsed = place.extend({ cursor }).safeParse(input);
  if (!parsed.success) return { ok: false, message: LOAD_FAILED };
  try {
    const page = await communityRpc<FeedPage>("community_feed", {
      p_category: parsed.data.category,
      p_group: parsed.data.group,
      p_cursor_at: parsed.data.cursor?.at ?? null,
      p_cursor_id: parsed.data.cursor?.id ?? null,
      p_limit: 10,
    });
    return { ok: true, data: { items: page.items.map(renderPost), next_cursor: page.next_cursor } };
  } catch (error) {
    return { ok: false, message: dbErrorMessage(error as { code?: string; message?: string }, LOAD_FAILED) };
  }
}

/** One post again (after following, moderating, and so on). Null when it's no longer available. */
export async function loadPostAction(id: string): Promise<Result<RenderedPost | null>> {
  await requireApprovedMember("/community");
  if (!uuid.safeParse(id).success) return { ok: true, data: null };
  try {
    const post = await communityRpc<FeedPost | null>("community_feed_post", { p_id: id });
    return { ok: true, data: post ? renderPost(post) : null };
  } catch (error) {
    return { ok: false, message: dbErrorMessage(error as { code?: string; message?: string }, LOAD_FAILED) };
  }
}

/** Newest comments first; `through` extends the page to include that comment. Null data when the post can't be read. */
export async function loadCommentsAction(input: { threadId: string; cursor?: { at: string; id: string } | null; through?: string | null }): Promise<
  Result<(Omit<CommentPage, "items"> & { items: RenderedComment[] }) | null>
> {
  await requireApprovedMember("/community");
  const parsed = z.object({ threadId: z.uuid(), cursor, through: optionalUuid }).safeParse(input);
  if (!parsed.success) return { ok: false, message: LOAD_FAILED };
  try {
    const page = await communityRpc<CommentPage | null>("community_comments", {
      p_thread: parsed.data.threadId,
      p_cursor_at: parsed.data.cursor?.at ?? null,
      p_cursor_id: parsed.data.cursor?.id ?? null,
      p_limit: 10,
      p_through: parsed.data.through,
    });
    if (!page) return { ok: true, data: null };
    return { ok: true, data: { ...page, items: page.items.map((c) => ({ ...c, html: c.body ? renderCommunityText(c.body, { mentions: c.mentions }) : null })) } };
  } catch (error) {
    return { ok: false, message: dbErrorMessage(error as { code?: string; message?: string }, LOAD_FAILED) };
  }
}

/** How many newer posts the member may see (for the "New posts" notice). */
export async function feedNewerAction(input: { category?: string | null; group?: string | null; at: string; id: string }): Promise<number> {
  await requireApprovedMember("/community");
  const parsed = place.extend({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).safeParse(input);
  if (!parsed.success) return 0;
  try {
    return await communityRpc<number>("community_feed_newer", { p_category: parsed.data.category, p_group: parsed.data.group, p_at: parsed.data.at, p_id: parsed.data.id });
  } catch {
    return 0;
  }
}
