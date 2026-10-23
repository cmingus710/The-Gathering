"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { normalizeLinkInput } from "@/lib/links/policy";
import { withSafeLinks } from "@/lib/links/validate";
import { parseReferenceList } from "@/lib/media/scripture";
import { LIBRARY_LIMITS, LIBRARY_VIEWS, type LibraryPage } from "@/lib/prayer/library";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer Library actions. Each re-checks membership here, and the database
 * re-checks everything again (approved adult membership, authorship,
 * status, hidden and archived state, posting restrictions, categories,
 * rate limits) before changing anything. Text stays in the form when
 * something fails; nothing is written to browser storage, logged, or put
 * in a URL. Nothing here sends notifications.
 */
const UNAVAILABLE = "The Prayer Library is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

function refresh(id?: string) {
  revalidatePath("/prayer/library", "layout");
  if (id) revalidatePath(`/prayer/library/${id}`);
}

const prayerSchema = z.object({
  title: z.string().trim().min(3, "Give the prayer a short title (at least 3 characters).").max(LIBRARY_LIMITS.title, `Keep the title to ${LIBRARY_LIMITS.title} characters.`),
  body: withSafeLinks(
    z
      .string()
      .trim()
      .min(1, "Write the prayer itself.")
      .max(LIBRARY_LIMITS.body, `Keep the prayer to ${LIBRARY_LIMITS.body.toLocaleString()} characters.`)
      .refine((v) => !/\]\((mention|group):/i.test(v), "Mentions aren't used in the Prayer Library. Remove the @mention."),
  ),
  origin: z.enum(["original", "shared"], { message: "Say whether this is your own prayer or shared from another source." }),
  sourceName: z.string().trim().max(LIBRARY_LIMITS.source, `Keep the author or source to ${LIBRARY_LIMITS.source} characters.`),
});

/** Create or edit. `intent` is "publish" or "draft". */
export async function saveLibraryPrayerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("prayerId")).data ?? null;
  await requireApprovedMember(id ? `/prayer/library/${id}/edit` : "/prayer/library/new");
  const categories = formData.getAll("category").map(String).filter((c) => uuid.safeParse(c).success);
  const values = {
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    origin: String(formData.get("origin") ?? ""),
    sourceName: String(formData.get("sourceName") ?? ""),
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
    scripture: String(formData.get("scripture") ?? ""),
    categories: categories.join(","),
  };
  const fieldErrors: Record<string, string[]> = {};
  const parsed = prayerSchema.safeParse(values);
  if (!parsed.success) for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);

  let sourceUrl: string | null = null;
  if (values.sourceUrl.trim()) {
    const link = normalizeLinkInput(values.sourceUrl);
    if (!link.ok || link.kind !== "web" || link.href.length > LIBRARY_LIMITS.url) {
      fieldErrors.sourceUrl = ["Enter a web address, such as https://example.org/prayer."];
    } else sourceUrl = link.href;
  }
  const { refs, invalid } = parseReferenceList(values.scripture);
  if (invalid.length) fieldErrors.scripture = [`Not recognized: ${invalid.slice(0, 3).join("; ")}. Use references such as “Psalm 23” or “John 3:16–18”, one per line.`];
  if (!parsed.success || Object.keys(fieldErrors).length) return errorState("Please correct the highlighted fields.", { fieldErrors, values });

  const publish = formData.get("intent") === "publish";
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("prayer_library_save", {
    p_id: id,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
    p_origin: parsed.data.origin,
    p_source_name: parsed.data.sourceName || null,
    p_source_url: sourceUrl,
    p_scripture: refs,
    p_categories: categories,
    p_publish: publish,
    p_client_key: uuid.safeParse(formData.get("clientKey")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error, "The prayer couldn't be saved. Your text is still here; please try again."), { values });
  refresh(String(data));
  // Only picks the confirmation wording; the database decided the state.
  const wasPublished = formData.get("wasPublished") === "true";
  redirect(`/prayer/library/${data as string}?saved=${publish ? (wasPublished ? "updated" : "published") : "draft"}`);
}

/** The contributor's own lifecycle: publish a draft, move back to drafts, archive, restore. */
export async function libraryStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("prayerId")).data;
  await requireApprovedMember(id ? `/prayer/library/${id}` : "/prayer/library");
  const status = String(formData.get("status") ?? "");
  if (!id || !["published", "draft", "archived"].includes(status)) return errorState("That change isn't available.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_library_status", { p_id: id, p_status: status });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved. Please try again."));
  refresh(id);
  return {
    status: "success",
    message: status === "archived" ? "Archived. Only you can see it now." : status === "draft" ? "Moved to your drafts. Only you can see it now." : "Published to the Prayer Library.",
  };
}

/** Private bookmark toggle; returns the new state. */
export async function libraryBookmarkAction(prayerId: string, on: boolean): Promise<{ ok: true; saved: boolean } | { ok: false; message: string }> {
  await requireApprovedMember("/prayer/library");
  const id = uuid.safeParse(prayerId).data;
  if (!id) return { ok: false, message: "That prayer wasn't found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("prayer_library_bookmark", { p_id: id, p_on: on });
  if (error) return { ok: false, message: dbErrorMessage(error, "That didn't work. Please try again.") };
  revalidatePath("/prayer/library");
  revalidatePath(`/prayer/library/${id}`);
  return { ok: true, saved: Boolean(data) };
}

export async function libraryReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/prayer/library");
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id) return errorState("That prayer can't be reported.");
  const details = String(formData.get("details") ?? "").slice(0, LIBRARY_LIMITS.report);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_library_report", { p_id: id, p_reason: String(formData.get("reason") ?? ""), p_details: details || null });
  if (error) return errorState(dbErrorMessage(error, "Your report couldn't be sent. Please try again."));
  revalidatePath(`/prayer/library/${id}`);
  return { status: "success", message: "Thank you. A prayer moderator will review it." };
}

export type LibraryFilters = { topic: string | null; purpose: string | null; use: string | null };

/**
 * Search runs as a POST, like prayer request search, so search words never
 * appear in URLs, history, or request logs. It goes through the same
 * access-checked list function, combined with the current filters.
 */
export async function librarySearchAction(
  query: string,
  view: string,
  filters: LibraryFilters,
  cursor: { before: string; beforeId: string } | null,
): Promise<LibraryPage | { error: string }> {
  await requireApprovedMember("/prayer/library");
  const q = query.trim().slice(0, 100);
  const id = (v: string | null) => (v && uuid.safeParse(v).success ? v : null);
  const supabase = await createClient();
  if (!supabase) return { error: UNAVAILABLE };
  const { data, error } = await supabase.rpc("prayer_library_list", {
    p_view: (LIBRARY_VIEWS as readonly string[]).includes(view) ? view : "library",
    p_query: q || null,
    p_topic: id(filters.topic),
    p_purpose: id(filters.purpose),
    p_use: id(filters.use),
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: 20,
  });
  if (error) return { error: dbErrorMessage(error, "Search isn't available right now.") };
  return data as LibraryPage;
}
