"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
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
  link: { kind: string; label?: string | null; plan_title?: string | null; title?: string | null; available?: boolean } | null;
};

export async function searchJournalAction(input: { query: string; status: "active" | "archived"; offset: number }): Promise<
  { ok: true; total: number; items: JournalListItem[] } | { ok: false; message: string }
> {
  await requireApprovedMember("/journal");
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
  await requireApprovedMember("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  const action = formData.get("action") === "restore" ? "restore" : "archive";
  if (id) await rpc("journal_entry_status", { p_id: id, p_action: action });
  revalidatePath("/journal", "layout");
}

export async function unlinkEntryAction(formData: FormData) {
  await requireApprovedMember("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  if (id) await rpc("journal_entry_unlink", { p_id: id });
  revalidatePath("/journal", "layout");
}

export async function deleteEntryAction(formData: FormData) {
  await requireApprovedMember("/journal");
  const id = uuid.safeParse(formData.get("id")).data;
  if (id) await rpc("journal_entry_delete", { p_id: id });
  revalidatePath("/journal", "layout");
  redirect("/journal?notice=deleted");
}

export async function deleteAllAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/journal");
  const confirm = String(formData.get("confirm") ?? "");
  const { data, error } = await rpc("journal_delete_all", { p_confirm: confirm });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/journal", "layout");
  return { status: "success", message: `Deleted ${data as number} ${(data as number) === 1 ? "entry" : "entries"}.` };
}
