"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { parsePodcastProvider, providerRefString, safeHttpsUrl } from "@/lib/media/embeds";
import { fetchFeed } from "@/lib/media/feeds";
import { isUuid } from "@/lib/media/format";
import { checkFetchUrl } from "@/lib/media/safe-fetch";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The podcast service is unavailable. Nothing was saved.";

async function refresh(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, showId: string) {
  const { data: claim, error } = await supabase.rpc("media_admin_show_claim", { p_show: showId });
  if (error || !claim) return { ok: false as const, message: dbErrorMessage(error, "The feed couldn't be refreshed.") };
  const c = claim as { feed_url: string; etag: string | null; last_modified: string | null };
  const result = await fetchFeed(c.feed_url, c);
  const { data, error: ingestError } = await supabase.rpc("media_admin_show_ingest", { p_show: showId, p_result: result });
  if (ingestError) return { ok: false as const, message: dbErrorMessage(ingestError, "The feed couldn't be saved.") };
  if (!result.ok) return { ok: false as const, message: result.error };
  const r = data as { added?: number; updated?: number; missing?: number; not_modified?: boolean };
  return {
    ok: true as const,
    message: r.not_modified ? "The feed hasn't changed." : `Imported: ${r.added ?? 0} new, ${r.updated ?? 0} updated, ${r.missing ?? 0} no longer in the feed.`,
  };
}

export async function saveShowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts");
  const values = formValues(formData);
  const id = formData.get("id");
  const showId = id ? (isUuid(id) ? String(id) : null) : null;
  if (id && !showId) return errorState("That show couldn't be found.");
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "church" && kind !== "external") return errorState("Choose a church show or an external show.");
  const errors: Record<string, string[]> = {};
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 160) errors.title = ["Give the show a title (up to 160 characters)."];
  const audience = String(formData.get("audience") ?? "members");
  const groupId = audience === "group" ? String(formData.get("group_id") ?? "") : "";
  if (audience === "group" && !isUuid(groupId)) errors.group_id = ["Choose a group."];
  const website = String(formData.get("website_url") ?? "").trim();
  if (website && !safeHttpsUrl(website)) errors.website_url = ["Use an https address."];

  const p: Record<string, unknown> = {
    title,
    description: String(formData.get("description") ?? "").slice(0, 4000),
    author: String(formData.get("author") ?? "").trim().slice(0, 160),
    artwork_asset_id: isUuid(formData.get("artwork_asset_id")) ? formData.get("artwork_asset_id") : null,
    website_url: website ? safeHttpsUrl(website) : null,
    audience,
    group_id: groupId || null,
    confirm_public: formData.get("confirm_public") === "on" ? "public" : null,
    featured: formData.get("featured") === "on",
    sort_order: Math.max(0, Math.min(100_000, Number(formData.get("sort_order")) || 100)),
  };
  if (!showId) p.kind = kind;
  if (kind === "external") {
    const feed = String(formData.get("feed_url") ?? "").trim();
    const provider = String(formData.get("provider_url") ?? "").trim();
    if (!feed && !provider) errors.feed_url = ["Add the show's public RSS feed, a Spotify or Apple Podcasts link, or both."];
    if (feed) {
      try {
        p.feed_url = checkFetchUrl(feed).toString();
      } catch (e) {
        errors.feed_url = [(e as Error).message];
      }
    } else p.feed_url = null;
    if (provider) {
      const ref = parsePodcastProvider(provider);
      if (!ref) errors.provider_url = ["Use a Spotify show or episode link, or an Apple Podcasts show link."];
      else {
        p.provider = ref.provider;
        p.provider_url = ref.provider === "spotify" ? `https://open.spotify.com/${ref.kind}/${ref.id}` : `https://podcasts.apple.com/${ref.country}/podcast/${ref.slug}/id${ref.showId}`;
        p.provider_ref = providerRefString(ref);
      }
    } else {
      p.provider = null;
      p.provider_url = null;
      p.provider_ref = null;
    }
    p.allow_stream = formData.get("allow_stream") === "on";
  } else {
    p.public_feed = formData.get("public_feed") === "on";
    p.feed_language = String(formData.get("feed_language") ?? "en-us").trim().toLowerCase();
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(String(p.feed_language))) errors.feed_language = ["Use a language code such as en-us."];
    p.feed_category = String(formData.get("feed_category") ?? "").trim().slice(0, 80) || "Religion & Spirituality";
    p.feed_explicit = formData.get("feed_explicit") === "on";
    const email = String(formData.get("feed_owner_email") ?? "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.feed_owner_email = ["Enter a valid email address."];
    p.feed_owner_email = email || null;
  }
  if (Object.keys(errors).length) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: errors, values };

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("media_admin_show_save", { p_id: showId, p });
  if (error || !data) return errorState(dbErrorMessage(error), { values });
  const savedId = data as string;
  let note = showId ? "saved" : "created";
  if (!showId && kind === "external" && p.feed_url) {
    const r = await refresh(supabase, savedId);
    note = r.ok ? "imported" : "import_failed";
  }
  revalidatePath("/admin/podcasts");
  redirect(`/admin/podcasts/${savedId}?saved=${note}`);
}

export async function showStatusAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts");
  const id = formData.get("id");
  const action = String(formData.get("action") ?? "");
  if (!isUuid(id) || !["publish", "unpublish", "archive", "restore", "delete"].includes(action)) redirect("/admin/podcasts");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/podcasts/${id}?error=unavailable`);
  const { error } = await supabase.rpc("media_admin_show_status", { p_id: id, p_action: action });
  if (error) redirect(`/admin/podcasts/${id}?error=${encodeURIComponent(dbErrorMessage(error))}`);
  revalidatePath("/", "layout");
  redirect(action === "delete" ? "/admin/podcasts?saved=deleted" : `/admin/podcasts/${id}?saved=${action}`);
}

export async function refreshShowAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts");
  const id = formData.get("id");
  if (!isUuid(id)) redirect("/admin/podcasts");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/podcasts/${id}?error=unavailable`);
  const r = await refresh(supabase, id);
  revalidatePath(`/admin/podcasts/${id}`);
  redirect(`/admin/podcasts/${id}?${r.ok ? "notice" : "error"}=${encodeURIComponent(r.message)}`);
}
