"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability, requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { linkProblem } from "@/lib/links/validate";
import { normalizeAudibleUrl, normalizeKindleUrl, parseSpotify } from "@/lib/media/embeds";
import { isUuid, isYmd } from "@/lib/media/format";
import { parseFraming } from "@/lib/media/framing";
import { parseReferenceList } from "@/lib/media/scripture";
import type { ItemKind } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/time";

const UNAVAILABLE = "The content service is unavailable. Nothing was saved.";
const KINDS: ItemKind[] = ["devotional", "lesson", "video", "episode", "book", "assignment", "playlist"];

/** Which role a name in the people fields gets, per kind. */
const PEOPLE_ROLE: Partial<Record<ItemKind, "author" | "speaker" | "host">> = { devotional: "author", lesson: "speaker", episode: "host" };

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const names = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((n) => n.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 20);

type Errors = Record<string, string[]>;

export async function saveContentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const values = formValues(formData);
  const errors: Errors = {};
  const err = (k: string, m: string) => (errors[k] ??= []).push(m);

  const rawId = formData.get("id");
  const id = rawId ? (isUuid(rawId) ? String(rawId) : null) : null;
  if (rawId && !id) return errorState("That content couldn't be found.");
  const kind = String(formData.get("kind") ?? "") as ItemKind;
  if (!KINDS.includes(kind)) return errorState("Choose what kind of content this is.");
  const clientKey = isUuid(formData.get("client_key")) ? String(formData.get("client_key")) : null;

  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 1 || title.length > 200) err("title", "Give it a title (up to 200 characters).");
  const summary = String(formData.get("summary") ?? "").trim();
  if (summary.length > 600) err("summary", "Keep the summary under 600 characters.");
  const body = String(formData.get("body") ?? "");
  if (body.length > 40_000) err("body", "The text is too long (40,000 characters at most).");
  const bodyLinks = linkProblem(body);
  if (bodyLinks) err("body", bodyLinks);
  const notes = String(formData.get("notes") ?? "");
  if (notes.length > 40_000) err("notes", "The notes are too long.");
  const notesLinks = linkProblem(notes);
  if (notesLinks) err("notes", notesLinks);
  const questions = lines(formData.get("questions"));
  if (questions.length > 20 || questions.some((q) => q.length > 500)) err("questions", "Up to 20 questions, each under 500 characters.");

  const audience = String(formData.get("audience") ?? "members");
  if (!["public", "members", "group"].includes(audience)) err("audience", "Choose who can see it.");
  const groupId = audience === "group" ? String(formData.get("group_id") ?? "") : "";
  if (audience === "group" && !isUuid(groupId)) err("group_id", "Choose a group.");

  const { refs, invalid } = parseReferenceList(String(formData.get("scripture") ?? ""));
  if (invalid.length) err("scripture", `Not recognized: ${invalid.slice(0, 3).join("; ")}. Use references such as “John 3:16–18”, one per line.`);
  const tags = names(formData.get("tags")).map((t) => t.toLowerCase().slice(0, 40));

  const p: Record<string, unknown> = {
    title,
    summary,
    body,
    questions,
    audience,
    group_id: groupId || null,
    confirm_public: formData.get("confirm_public") === "on" ? "public" : null,
    tags,
    scripture_refs: refs,
    attribution: String(formData.get("attribution") ?? "").trim().slice(0, 300),
    cover_asset_id: isUuid(formData.get("cover_asset_id")) ? formData.get("cover_asset_id") : null,
    cover_alt: String(formData.get("cover_alt") ?? "").trim().slice(0, 500),
    series_id: isUuid(formData.get("series_id")) ? formData.get("series_id") : null,
    discussion_thread_id: isUuid(formData.get("discussion_thread_id")) ? formData.get("discussion_thread_id") : null,
    notify: formData.get("notify") === "on",
    sort_order: Math.max(0, Math.min(100_000, Number(formData.get("sort_order")) || 100)),
  };
  if (!id) p.kind = kind;
  if (viewer.capabilities.has(CAPABILITIES.contentPublish)) {
    p.featured = formData.get("featured") === "on";
    if (kind === "book") p.book_current = formData.get("book_current") === "on";
  }
  if (kind === "lesson") p.notes = notes;

  const date = (field: string, required: boolean, label: string) => {
    const v = String(formData.get(field) ?? "");
    if (!v) {
      if (required) err(field, `Choose the ${label}.`);
      return null;
    }
    if (!isYmd(v)) err(field, `Enter a valid ${label}.`);
    return v;
  };
  if (kind === "devotional") p.devotional_on = date("devotional_on", true, "devotional date");
  if (kind === "lesson") p.delivered_on = date("delivered_on", true, "Sunday it was delivered");
  if (kind === "episode") {
    const show = String(formData.get("show_id") ?? "");
    if (!isUuid(show)) err("show_id", "Choose the church podcast show.");
    p.show_id = show;
    for (const f of ["episode_number", "season_number"] as const) {
      const v = String(formData.get(f) ?? "").trim();
      if (v && (!/^\d{1,5}$/.test(v))) err(f, "Use a whole number.");
      p[f] = v ? Number(v) : null;
    }
  }
  // The Kindle link lives in media.book_details, saved after the book itself;
  // undefined when the form didn't carry the field (it's then left as is).
  let kindle: string | null | undefined;
  if (kind === "book") {
    p.book_author = String(formData.get("book_author") ?? "").trim().slice(0, 160);
    const audible = String(formData.get("audible_url") ?? "").trim();
    if (audible) {
      const normalized = normalizeAudibleUrl(audible);
      if (!normalized) err("audible_url", "Use an https link to the book on audible.com (or another Audible country site).");
      p.audible_url = normalized;
    } else p.audible_url = null;
    if (formData.has("kindle_url")) {
      const raw = String(formData.get("kindle_url") ?? "").trim();
      kindle = raw ? normalizeKindleUrl(raw) : null;
      if (raw && !kindle) err("kindle_url", KINDLE_ERROR);
    }
  }
  if (kind === "assignment") {
    const book = String(formData.get("book_id") ?? "");
    if (!isUuid(book)) err("book_id", "Choose the book.");
    p.book_id = book;
    p.starts_on = date("starts_on", true, "start date");
    p.ends_on = date("ends_on", false, "end date");
    if (p.starts_on && p.ends_on && String(p.ends_on) < String(p.starts_on)) err("ends_on", "The end date must be on or after the start date.");
    p.instructions = String(formData.get("instructions") ?? "").trim().slice(0, 1000);
  }
  if (kind === "playlist") {
    const ref = parseSpotify(String(formData.get("spotify_url") ?? ""), ["playlist"]);
    if (!ref) err("spotify_url", "Paste a Spotify playlist link, such as https://open.spotify.com/playlist/…");
    else p.spotify_id = ref.id;
  }

  // Files, related content, and people/topics (resolved below).
  try {
    const att = JSON.parse(String(formData.get("attachments") ?? "[]")) as Array<{ asset_id: string; role: string; label?: string; members_only?: boolean }>;
    if (!Array.isArray(att) || att.some((a) => !isUuid(a.asset_id) || !["audio", "video", "handout", "slides", "resource"].includes(a.role))) throw new Error();
    p.attachments = att.slice(0, 30).map((a, i) => ({ asset_id: a.asset_id, role: a.role, label: String(a.label ?? "").slice(0, 120), members_only: !!a.members_only, sort_order: i }));
    const links = JSON.parse(String(formData.get("links") ?? "[]")) as string[];
    if (!Array.isArray(links) || links.some((l) => !isUuid(l))) throw new Error();
    p.links = links.slice(0, 20);
  } catch {
    return errorState("The attached files or related content couldn't be read. Reload the page and try again.", { values });
  }

  if (Object.keys(errors).length) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: errors, values };

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const role = PEOPLE_ROLE[kind];
  const people: Array<{ person_id: string; role: string }> = [];
  for (const [field, r] of [["people", role], ["contributors", "contributor"]] as const) {
    if (!r) continue;
    for (const name of names(formData.get(field))) {
      if (name.length > 120) continue;
      const { data } = await supabase.rpc("media_admin_person_save", { p_id: null, p_name: name, p_archived: false });
      if (data) people.push({ person_id: data as string, role: r });
    }
  }
  if (role) p.people = people;
  const topicIds: string[] = [];
  for (const name of names(formData.get("topics"))) {
    if (name.length > 60) continue;
    const { data } = await supabase.rpc("media_admin_topic_save", { p_name: name });
    if (data) topicIds.push(data as string);
  }
  p.topics = topicIds;

  const { data, error } = await supabase.rpc("media_admin_item_save", { p_id: id, p: p, p_client_key: id ? null : clientKey });
  if (error || !data) return errorState(dbErrorMessage(error), { values });
  const savedId = (data as { id: string }).id;
  const framed = await saveCoverFraming(supabase, formData, { p_item: savedId, p_series: null });
  if (!framed) return errorState("Your changes were saved, but not the cover's position. Select Reposition and save again.", { values });
  if (kindle !== undefined) {
    const problem = await saveBookDetails(supabase, savedId, { kindle_url: kindle });
    if (problem) {
      return errorState(`Your other changes were saved, but not the Kindle link: ${problem}`, { values, fieldErrors: { kindle_url: [problem] } });
    }
  }
  revalidatePath("/admin/content");
  if (kind === "book") {
    revalidatePath(`/reading/books/${savedId}`);
    revalidatePath("/reading");
  }
  redirect(`/admin/content/${savedId}?saved=${id ? "saved" : "created"}`);
}

const KINDLE_ERROR = "Use an https:// link to the book on Amazon (…/dp/…), an a.co short link, or Kindle Cloud Reader (read.amazon.com).";

type BookDetailsPatch = Partial<{ kindle_url: string | null; reading_starts_on: string | null; reading_ends_on: string | null; related_lesson_id: string | null }>;

/**
 * Changes only the given fields of a book's reading details (Kindle link,
 * dates, related lesson), so the book form and the "Reading details" form
 * never overwrite each other. Returns a message on failure, else null.
 */
async function saveBookDetails(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  item: string,
  patch: BookDetailsPatch,
): Promise<string | null> {
  const { error } = await supabase.rpc("media_admin_book_details_patch", { p_item: item, p: patch });
  if (!error) return null;
  if (error.code !== "PGRST202" && error.code !== "42883") return dbErrorMessage(error);
  // Before migration 20261113000100: merge with the stored details and use the Phase 13 save.
  const current = await supabase.rpc("media_admin_book_details", { p_item: item });
  if (current.error || !current.data) return dbErrorMessage(current.error);
  const d = { ...(current.data as Required<BookDetailsPatch>), ...patch };
  const saved = await supabase.rpc("media_admin_book_details_save", {
    p_item: item,
    p_kindle_url: d.kindle_url,
    p_starts: d.reading_starts_on,
    p_ends: d.reading_ends_on,
    p_related_lesson: d.related_lesson_id,
  });
  return saved.error ? dbErrorMessage(saved.error) : null;
}

/**
 * Saves how this item or series positions its cover (the shared library
 * image is never changed). Only when the form carried the field; a
 * different cover saved meanwhile is left centred. False on failure.
 */
async function saveCoverFraming(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  formData: FormData,
  target: { p_item: string | null; p_series: string | null },
): Promise<boolean> {
  if (!formData.has("cover_framing")) return true;
  const cover = formData.get("cover_asset_id");
  if (!isUuid(cover)) return true;
  const framing = parseFraming(formData.get("cover_framing"));
  const { error } = await supabase.rpc("media_admin_cover_framing_save", { ...target, p_cover: cover, p_framing: framing });
  // Before migration 20261110000100 the function doesn't exist: covers stay centred, which is fine unless a position was chosen.
  if (error && !framing && (error.code === "PGRST202" || error.code === "42883")) return true;
  return !error;
}

const statusSchema = z.object({
  id: z.uuid(),
  action: z.enum(["publish", "unpublish", "archive", "restore", "expiry"]),
});

export async function setContentStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentPublish, "/admin/content");
  const values = formValues(formData);
  const parsed = statusSchema.safeParse({ id: formData.get("id"), action: formData.get("action") });
  if (!parsed.success) return errorState("That request wasn't valid.");
  const { settings } = await getChurchSettings();
  const when = String(formData.get("when") ?? "now");
  const publishLocal = String(formData.get("publish_at") ?? "");
  const expiresLocal = String(formData.get("expires_at") ?? "");
  let publishAt: Date | null = null;
  if (parsed.data.action === "publish" && when === "later") {
    publishAt = zonedLocalToUtc(publishLocal, settings.timezone);
    if (!publishAt) return errorState("Choose the date and time to publish.", { values, fieldErrors: { publish_at: ["Choose a date and time."] } });
  }
  let expiresAt: Date | null = null;
  if (expiresLocal) {
    expiresAt = zonedLocalToUtc(expiresLocal, settings.timezone);
    if (!expiresAt) return errorState("Enter a valid expiry time.", { values, fieldErrors: { expires_at: ["Enter a valid date and time."] } });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("media_admin_item_status", {
    p_id: parsed.data.id,
    p_action: parsed.data.action,
    p_publish_at: publishAt?.toISOString() ?? null,
    p_expires_at: expiresAt?.toISOString() ?? null,
    p_confirm: formData.get("confirm_public") === "on" ? "public" : null,
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/", "layout");
  redirect(`/admin/content/${parsed.data.id}?saved=${parsed.data.action}`);
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const id = formData.get("id");
  if (!isUuid(id)) redirect("/admin/content");
  const supabase = await createClient();
  if (!supabase) redirect(`/admin/content/${id}?error=unavailable`);
  const { error } = await supabase.rpc("media_admin_item_delete", { p_id: id });
  if (error) redirect(`/admin/content/${id}?error=${encodeURIComponent(dbErrorMessage(error, "The draft couldn't be deleted."))}`);
  revalidatePath("/admin/content");
  redirect("/admin/content?saved=deleted");
}

// ---------------------------------------------------------------------------
// Series, people, topics
// ---------------------------------------------------------------------------
export async function saveSeriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentEdit, "/admin/content/library");
  const values = formValues(formData);
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 160) return errorState("Give the series a title.", { values, fieldErrors: { title: ["Required, up to 160 characters."] } });
  const scope = String(formData.get("scope") ?? "any");
  if (!["any", "lesson", "devotional", "episode"].includes(scope)) return errorState("Choose where the series is used.", { values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data: seriesId, error } = await supabase.rpc("media_admin_series_save", {
    p_id: isUuid(formData.get("id")) ? formData.get("id") : null,
    p_scope: scope,
    p_title: title,
    p_description: String(formData.get("description") ?? "").slice(0, 2000),
    p_cover: isUuid(formData.get("cover_asset_id")) ? formData.get("cover_asset_id") : null,
    p_archived: formData.get("archived") === "on",
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  const framed = await saveCoverFraming(supabase, formData, { p_item: null, p_series: seriesId as string });
  revalidatePath("/admin/content/library");
  if (!framed) return errorState("The series was saved, but not the cover's position. Select Reposition and save again.", { values });
  return { status: "success", message: "Series saved." };
}

export async function savePersonAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.contentEdit, "/admin/content/library");
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  if (!supabase || !name || name.length > 120) redirect("/admin/content/library");
  await supabase.rpc("media_admin_person_save", {
    p_id: isUuid(formData.get("id")) ? formData.get("id") : null,
    p_name: name,
    p_archived: formData.get("archived") === "on",
  });
  revalidatePath("/admin/content/library");
  redirect("/admin/content/library?saved=person");
}

export async function deleteTopicAction(formData: FormData): Promise<void> {
  await requireCapability(CAPABILITIES.contentPublish, "/admin/content/library");
  const supabase = await createClient();
  if (supabase && isUuid(formData.get("id"))) await supabase.rpc("media_admin_topic_delete", { p_id: formData.get("id") });
  revalidatePath("/admin/content/library");
  redirect("/admin/content/library?saved=topic");
}

/**
 * Phase 13: a book's reading dates and related lesson. The Kindle link is
 * usually saved with the book; this form carries it only when the book form
 * is read-only for the editor (a live book), and only then changes it.
 */
export async function saveBookDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.contentEdit, "/admin/content");
  const values = formValues(formData);
  const id = formData.get("id");
  if (!isUuid(id)) return errorState("That book wasn't found.", { values });
  const patch: BookDetailsPatch = {};
  if (formData.has("kindle_url")) {
    const raw = String(formData.get("kindle_url") ?? "").trim();
    patch.kindle_url = raw ? normalizeKindleUrl(raw) : null;
    if (raw && !patch.kindle_url) return errorState("Check the Kindle link.", { values, fieldErrors: { kindle_url: [KINDLE_ERROR] } });
  }
  const starts = String(formData.get("reading_starts_on") ?? "");
  const ends = String(formData.get("reading_ends_on") ?? "");
  if ((starts && !isYmd(starts)) || (ends && !isYmd(ends))) return errorState("Check the reading dates.", { values });
  if (starts && ends && ends < starts) {
    return errorState("Check the reading dates.", { values, fieldErrors: { reading_ends_on: ["The end date is before the start date."] } });
  }
  const lesson = formData.get("related_lesson_id");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const problem = await saveBookDetails(supabase, id, {
    ...patch,
    reading_starts_on: starts || null,
    reading_ends_on: ends || null,
    related_lesson_id: isUuid(lesson) ? lesson : null,
  });
  if (problem) return errorState(problem, { values });
  revalidatePath(`/admin/content/${id}`);
  revalidatePath(`/reading/books/${id}`);
  revalidatePath("/reading");
  return { status: "success", message: "Reading details saved." };
}
