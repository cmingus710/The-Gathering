"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "@/lib/auth/viewer";
import { loadHighlightPassages, loadPassageTexts, type HighlightPage, type PassageText } from "@/lib/bible/highlight-passages";
import { isHighlightColor, refFilter, type PassageRef } from "@/lib/bible/highlights";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * My Journal actions. Search is a POST (never in the URL, so search words
 * don't reach request logs). Nothing here logs entry text.
 */
const UNAVAILABLE = "My Journal is unavailable right now. Nothing was changed.";
const uuid = z.uuid();

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

export type JournalListItem = {
  id: string;
  title: string;
  excerpt: string;
  status: "active" | "archived";
  updated_at: string;
  link: { kind: string; label?: string | null; plan_title?: string | null; title?: string | null; question?: string | null; available?: boolean } | null;
};

export async function searchJournalAction(input: { query: string; status: "active" | "archived"; offset: number }): Promise<
  { ok: true; total: number; items: JournalListItem[] } | { ok: false; message: string }
> {
  await requireLearner("/journal");
  const { data, error } = await rpc("journal_entries", {
    p_query: input.query.slice(0, 200) || null,
    p_status: input.status === "archived" ? "archived" : "active",
    p_limit: 30,
    p_offset: Math.max(0, Math.min(10_000, input.offset | 0)),
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "Your journal couldn't be searched right now.") };
  const r = data as { total: number; items: JournalListItem[] };
  return { ok: true, total: r.total, items: r.items };
}

export async function entryStatusAction(formData: FormData) {
  await requireLearner("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  const action = formData.get("action") === "restore" ? "restore" : "archive";
  if (id) await rpc("journal_entry_status", { p_id: id, p_action: action });
  revalidatePath("/journal", "layout");
}

export async function unlinkEntryAction(formData: FormData) {
  await requireLearner("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  if (id) await rpc("journal_entry_unlink", { p_id: id });
  revalidatePath("/journal", "layout");
}

export async function deleteEntryAction(formData: FormData) {
  await requireLearner("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  if (id) await rpc("journal_entry_delete", { p_id: id });
  revalidatePath("/journal", "layout");
  redirect("/journal?notice=deleted");
}

export async function deleteAllAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner("/journal");
  const confirm = String(formData.get("confirm") ?? "");
  const { data, error } = await rpc("journal_delete_all", { p_confirm: confirm });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/journal", "layout");
  return { status: "success", message: `Deleted ${data as number} ${(data as number) === 1 ? "entry" : "entries"}.` };
}

/**
 * Scripture Highlights: the member's highlights as passages, filtered and
 * sorted. The reference search is sent as a POST like journal search.
 * Returns references and colors only; text comes from
 * highlightTextsAction.
 */
export async function highlightPassagesAction(input: {
  query: string;
  color: string;
  translationId: string;
  sort: "recent" | "bible";
  offset: number;
  limit?: number;
}): Promise<{ ok: true; page: HighlightPage } | { ok: false; message: string }> {
  await requireLearner("/journal");
  const ref = refFilter(String(input.query ?? "").slice(0, 80));
  if (!ref.ok) return { ok: false, message: ref.error };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "My Journal is unavailable right now." };
  return loadHighlightPassages(supabase, {
    color: isHighlightColor(input.color) ? input.color : null,
    translation_id: uuid.safeParse(input.translationId).data ?? null,
    ref: ref.ref,
    sort: input.sort === "bible" ? "bible" : "recent",
    limit: Math.max(1, Math.min(50, (input.limit ?? 20) | 0)),
    offset: Math.max(0, Math.min(100_000, input.offset | 0)),
  });
}

/**
 * The current text of some highlighted passages, from the same sources as
 * the reader (stored text, or the licensed provider and its permitted
 * cache). Held only in the page's memory; never stored or logged.
 */
export async function highlightTextsAction(refs: PassageRef[]): Promise<Record<string, PassageText>> {
  await requireLearner("/journal");
  const valid = (Array.isArray(refs) ? refs : [])
    .filter(
      (r) =>
        uuid.safeParse(r?.translation_id).success &&
        /^[1-3A-Z][A-Z0-9]{2}$/.test(String(r.book)) &&
        [r.chapter, r.start_verse, r.end_verse].every((n) => Number.isInteger(n) && n > 0 && n <= 200) &&
        r.end_verse >= r.start_verse,
    )
    .slice(0, 20);
  const supabase = await createClient();
  if (!supabase || !valid.length) return {};
  return loadPassageTexts(supabase, valid);
}
