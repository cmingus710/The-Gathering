"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deliverCommunityNow } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { withSafeLinks } from "@/lib/links/validate";
import { PRAYER_LIMITS } from "@/lib/prayer/format";
import type { PrayerPage } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Prayer request actions. Each re-checks membership here, and the database
 * re-checks everything again (audience, group membership, team capability,
 * authorship, status, locks, rate limits) before changing anything. Text
 * stays in the form when something fails; nothing is written to browser
 * storage, logged, or put in a URL.
 */
const UNAVAILABLE = "Prayer requests are unavailable right now. Nothing was changed.";
const uuid = z.uuid();
const AUDIENCES = ["private", "group", "team", "church"] as const;

function deliverLater() {
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
}

function refresh(id?: string) {
  revalidatePath("/prayer", "layout");
  if (id) revalidatePath(`/prayer/${id}`);
}

const requestSchema = z.object({
  title: z.string().trim().min(3, "Give your request a short title (at least 3 characters).").max(PRAYER_LIMITS.title, `Keep the title to ${PRAYER_LIMITS.title} characters.`),
  body: withSafeLinks(z.string().trim().min(1, "Share what you'd like prayer for.").max(PRAYER_LIMITS.body, `Keep it to ${PRAYER_LIMITS.body.toLocaleString()} characters.`)),
  audience: z.enum(AUDIENCES, { message: "Choose who can see your request." }),
});

/** Create or edit. `confirm` must name the audience when sharing or widening. */
export async function saveRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data ?? null;
  await requireApprovedMember(id ? `/prayer/${id}` : "/prayer/new");
  const values = {
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    groupId: String(formData.get("groupId") ?? ""),
  };
  const parsed = requestSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const groupId = parsed.data.audience === "group" ? (uuid.safeParse(values.groupId).data ?? null) : null;
  if (parsed.data.audience === "group" && !groupId) {
    return errorState("Choose which group can see it.", { fieldErrors: { groupId: ["Choose one of your groups."] }, values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("prayer_request_save", {
    p_id: id,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
    p_audience: parsed.data.audience,
    p_group: groupId,
    p_anonymous: formData.get("anonymous") === "on",
    p_comments_enabled: formData.get("commentsEnabled") === "on",
    p_confirm: String(formData.get("confirm") ?? "") || null,
    p_client_key: uuid.safeParse(formData.get("clientKey")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error, "Your request couldn't be saved. Your text is still here; please try again."), { values });
  refresh(String(data));
  redirect(`/prayer/${data as string}?saved=${id ? "edited" : parsed.data.audience === "private" ? "draft" : "shared"}`);
}

export async function statusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  const status = String(formData.get("status") ?? "");
  if (!id || !["open", "answered", "closed", "archived"].includes(status)) return errorState("That change isn't available.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_request_status", { p_id: id, p_status: status, p_confirm: String(formData.get("confirm") ?? "") || null });
  if (error) return errorState(dbErrorMessage(error, "The status couldn't be changed. Please try again."));
  refresh(id);
  if (status === "answered") deliverLater();
  return { status: "success", message: status === "archived" ? "Archived. Only you can see it now." : "Status updated." };
}

export async function deleteRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!id) return errorState("That prayer request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_request_delete", { p_id: id });
  if (error) return errorState(dbErrorMessage(error, "That request couldn't be deleted. Please try again."));
  refresh();
  redirect("/prayer?view=mine&deleted=1");
}

export async function setCommentsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!id) return errorState("That prayer request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const on = formData.get("on") === "true";
  const { error } = await supabase.rpc("prayer_set_comments", { p_id: id, p_enabled: on });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  refresh(id);
  return { status: "success", message: on ? "Comments are on." : "Comments are off." };
}

const textSchema = (max: number, label: string) => withSafeLinks(z.string().trim().min(1, `Write ${label} first.`).max(max, `Keep it to ${max.toLocaleString()} characters.`));

export async function addUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember(id ? `/prayer/${id}` : "/prayer");
  const body = String(formData.get("body") ?? "");
  if (!id) return errorState("That prayer request wasn't found.", { values: { body } });
  const parsed = textSchema(PRAYER_LIMITS.update, "your update").safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { body: [parsed.error.issues[0].message] }, values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const answered = formData.get("answered") === "on";
  const { error } = await supabase.rpc("prayer_update_add", { p_id: id, p_body: parsed.data, p_answered: answered });
  if (error) return errorState(dbErrorMessage(error, "Your update couldn't be posted. Your text is still here."), { values: { body } });
  refresh(id);
  deliverLater();
  return { status: "success", message: answered ? "Update posted and marked answered." : "Update posted." };
}

export async function editUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const updateId = uuid.safeParse(formData.get("updateId")).data;
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  const body = String(formData.get("body") ?? "");
  if (!updateId || !id) return errorState("That update wasn't found.", { values: { body } });
  const parsed = textSchema(PRAYER_LIMITS.update, "your update").safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { error } = await supabase.rpc("prayer_update_edit", { p_update: updateId, p_body: parsed.data });
  if (error) return errorState(dbErrorMessage(error, "Your changes couldn't be saved."), { values: { body } });
  refresh(id);
  return { status: "success", message: "Update saved." };
}

export async function deleteUpdateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const updateId = uuid.safeParse(formData.get("updateId")).data;
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!updateId || !id) return errorState("That update wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_update_delete", { p_update: updateId });
  if (error) return errorState(dbErrorMessage(error, "That update couldn't be deleted."));
  refresh(id);
  return { status: "success", message: "Update deleted." };
}

export async function commentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember(id ? `/prayer/${id}` : "/prayer");
  const body = String(formData.get("body") ?? "");
  if (!id) return errorState("That prayer request wasn't found.", { values: { body } });
  const parsed = textSchema(PRAYER_LIMITS.comment, "a comment").safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { body: [parsed.error.issues[0].message] }, values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { data, error } = await supabase.rpc("prayer_comment_add", {
    p_request: id,
    p_body: parsed.data,
    p_named: formData.get("named") === "on",
    p_client_key: uuid.safeParse(formData.get("clientKey")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error, "Your comment couldn't be posted. Your text is still here; please try again."), { values: { body } });
  refresh(id);
  deliverLater();
  return { status: "success", message: "Comment posted.", values: { commentId: String(data) } };
}

export async function editCommentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const commentId = uuid.safeParse(formData.get("commentId")).data;
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  const body = String(formData.get("body") ?? "");
  if (!commentId || !id) return errorState("That comment wasn't found.", { values: { body } });
  const parsed = textSchema(PRAYER_LIMITS.comment, "a comment").safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values: { body } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { error } = await supabase.rpc("prayer_comment_edit", { p_comment: commentId, p_body: parsed.data });
  if (error) return errorState(dbErrorMessage(error, "Your changes couldn't be saved."), { values: { body } });
  refresh(id);
  return { status: "success", message: "Comment updated." };
}

export async function deleteCommentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const commentId = uuid.safeParse(formData.get("commentId")).data;
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!commentId || !id) return errorState("That comment wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_comment_delete", { p_comment: commentId });
  if (error) return errorState(dbErrorMessage(error, "That comment couldn't be deleted."));
  refresh(id);
  return { status: "success", message: "Comment deleted." };
}

/** "I'm praying" toggle; returns the new aggregate count. */
export async function prayAction(requestId: string, on: boolean): Promise<{ ok: true; count: number; praying: boolean } | { ok: false; message: string }> {
  await requireApprovedMember("/prayer");
  const id = uuid.safeParse(requestId).data;
  if (!id) return { ok: false, message: "That prayer request wasn't found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("prayer_pray", { p_request: id, p_on: on });
  if (error) return { ok: false, message: dbErrorMessage(error, "That didn't work. Please try again.") };
  const result = data as { count: number; praying: boolean };
  return { ok: true, count: Number(result.count), praying: result.praying };
}

export async function followAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!id) return errorState("That prayer request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const on = formData.get("on") === "true";
  const { error } = await supabase.rpc("prayer_follow", { p_request: id, p_on: on });
  if (error) return errorState(dbErrorMessage(error, "That change couldn't be saved."));
  refresh(id);
  return { status: "success", message: on ? "Following." : "Unfollowed." };
}

export async function reportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/prayer");
  const type = String(formData.get("type") ?? "");
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id || !["request", "comment", "update"].includes(type)) return errorState("That can't be reported.");
  const details = String(formData.get("details") ?? "").slice(0, PRAYER_LIMITS.report);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("prayer_report", { p_type: type, p_id: id, p_reason: String(formData.get("reason") ?? ""), p_details: details || null });
  if (error) return errorState(dbErrorMessage(error, "Your report couldn't be sent. Please try again."));
  return { status: "success", message: "Thank you. A prayer moderator will review it." };
}

/**
 * Search runs as a POST so search words never appear in URLs, history, or
 * request logs. Results come from the same access-checked feed function.
 */
export async function searchAction(query: string, view: string, cursor: { before: string; beforeId: string } | null): Promise<PrayerPage | { error: string }> {
  await requireApprovedMember("/prayer");
  const q = query.trim().slice(0, 100);
  const supabase = await createClient();
  if (!supabase) return { error: UNAVAILABLE };
  const { data, error } = await supabase.rpc("prayer_requests", {
    p_view: ["feed", "mine", "following", "answered"].includes(view) ? view : "feed",
    p_status: view === "mine" ? "all" : "active",
    p_audience: "any",
    p_query: q || null,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: 20,
  });
  if (error) return { error: dbErrorMessage(error, "Search isn't available right now.") };
  return data as PrayerPage;
}

export async function identityLookupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("requestId")).data;
  await requireApprovedMember("/prayer");
  if (!id) return errorState("That prayer request wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("prayer_identity_lookup", { p_request: id, p_reason: String(formData.get("reason") ?? "") });
  if (error) return errorState(dbErrorMessage(error, "The lookup couldn't be completed."));
  return { status: "success", message: `Written by ${(data as { name: string }).name}. This lookup was recorded.` };
}
