"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deleteAttachmentFiles, type AttachmentFiles } from "@/lib/community/attachment-files";
import { ATTACHMENT_LIMITS } from "@/lib/community/attachments";
import { LIMITS } from "@/lib/community/format";
import { withSafeLinks } from "@/lib/links/validate";
import { deliverCommunityNow } from "@/lib/community/server";
import type { Reactions } from "@/lib/community/types";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Community discussion actions. Each one re-checks membership here and the
 * database re-checks everything again (membership, group, guidelines,
 * restrictions, locks, authorship, rate limits) before changing anything.
 * Drafts are kept on the page when something fails: forms are controlled
 * and only clear after a successful save.
 */
const UNAVAILABLE = "The community is unavailable right now. Nothing was changed.";
const uuid = z.uuid();
const optionalUuid = z.union([z.uuid(), z.literal(""), z.null()]).transform((v) => v || null);

async function client() {
  return createClient();
}

/** Sends any immediate notification email after the response (best effort). */
function deliverLater() {
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
}

/**
 * Photos and videos chosen in the composer: ready uploads, in order, with
 * the description typed for each photo. The database attaches them in the
 * same transaction as the post, and only the poster's own ready uploads.
 */
function attachmentsFrom(formData: FormData): { ids: string[]; alts: string[] } {
  const ids = formData.getAll("attachmentId").map(String);
  const alts = formData.getAll("attachmentAlt").map((v) => String(v).trim().slice(0, ATTACHMENT_LIMITS.altMax));
  const out = { ids: [] as string[], alts: [] as string[] };
  ids.forEach((id, i) => {
    if (uuid.safeParse(id).success && !out.ids.includes(id)) {
      out.ids.push(id);
      out.alts.push(alts[i] ?? "");
    }
  });
  return out;
}

const threadSchema = z.object({
  title: z.string().trim().min(3, "Give your discussion a title of at least 3 characters.").max(LIMITS.title, `Keep the title to ${LIMITS.title} characters.`),
  body: withSafeLinks(z.string().trim().min(1, "Write something to share.").max(LIMITS.thread, `Keep it to ${LIMITS.thread.toLocaleString()} characters.`)),
});

export async function createThreadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/community");
  const values = { title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? "") };
  const parsed = threadSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const categoryId = optionalUuid.safeParse(formData.get("categoryId") ?? "").data ?? null;
  const groupId = optionalUuid.safeParse(formData.get("groupId") ?? "").data ?? null;
  const clientKey = uuid.safeParse(formData.get("clientKey")).data ?? null;
  const media = attachmentsFrom(formData);
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const args = { p_category: categoryId, p_group: groupId, p_title: parsed.data.title, p_body: parsed.data.body, p_client_key: clientKey };
  const { data, error } = media.ids.length
    ? await supabase.rpc("community_thread_create_with_media", { ...args, p_attachments: media.ids, p_alts: media.alts })
    : await supabase.rpc("community_thread_create", args);
  if (error) return errorState(dbErrorMessage(error, "Your discussion couldn't be posted. Your text is still here; please try again."), { values });
  revalidatePath("/community", "layout");
  // From the feed composer: back to that feed, where the new post is first.
  const returnTo = String(formData.get("returnTo") ?? "");
  if (/^\/community(\?(category|group)=[0-9a-f-]{36})?$/.test(returnTo)) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}posted=${data as string}`);
  }
  redirect(`/community/t/${data as string}?posted=1`);
}

export async function editThreadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember(id ? `/community/t/${id}` : "/community");
  const values = { title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? "") };
  if (!id) return errorState("That discussion wasn't found.");
  const parsed = threadSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("community_thread_edit", { p_id: id, p_title: parsed.data.title, p_body: parsed.data.body });
  if (error) return errorState(dbErrorMessage(error, "Your changes couldn't be saved. Please try again."), { values });
  revalidatePath(`/community/t/${id}`);
  redirect(`/community/t/${id}?edited=1`);
}

/**
 * Deletes through the attachment-aware function, which also returns the files
 * to remove. Until migration 20261031000200 is applied that function doesn't
 * exist (PostgREST PGRST202), so fall back to the plain delete: there are no
 * attachments to clean up then.
 */
async function deleteWithMedia(supabase: NonNullable<Awaited<ReturnType<typeof client>>>, fn: "community_thread_delete" | "community_reply_delete", id: string) {
  const res = await supabase.rpc(`${fn}_with_media`, { p_id: id });
  if (res.error?.code === "PGRST202") {
    const plain = await supabase.rpc(fn, { p_id: id });
    return { data: null, error: plain.error };
  }
  return res;
}

export async function deleteThreadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  if (!id) return errorState("That discussion wasn't found.");
  const back = String(formData.get("back") ?? "/community");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await deleteWithMedia(supabase, "community_thread_delete", id);
  if (error) return errorState(dbErrorMessage(error, "That discussion couldn't be deleted. Please try again."));
  // Its photos and videos are already unavailable; delete the stored files.
  await deleteAttachmentFiles(supabase, (data as { files?: AttachmentFiles[] } | null)?.files);
  revalidatePath("/community", "layout");
  redirect(/^\/(community|groups)(\/[A-Za-z0-9/_-]*)?$/.test(back) ? `${back}?deleted=1` : "/community?deleted=1");
}

const replySchema = withSafeLinks(z.string().trim().min(1, "Write a reply first.").max(LIMITS.reply, `Keep replies to ${LIMITS.reply.toLocaleString()} characters.`));

export async function replyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember(id ? `/community/t/${id}` : "/community");
  const body = String(formData.get("body") ?? "");
  if (!id) return errorState("That discussion wasn't found.", { values: { body } });
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { body: [parsed.error.issues[0].message] }, values: { body } });
  const media = attachmentsFrom(formData);
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const args = { p_thread: id, p_body: parsed.data, p_client_key: uuid.safeParse(formData.get("clientKey")).data ?? null };
  const { data, error } = media.ids.length
    ? await supabase.rpc("community_reply_with_media", { ...args, p_attachments: media.ids, p_alts: media.alts })
    : await supabase.rpc("community_reply", args);
  if (error) return errorState(dbErrorMessage(error, "Your reply couldn't be posted. Your text is still here; please try again."), { values: { body } });
  revalidatePath(`/community/t/${id}`);
  deliverLater();
  return { status: "success", message: "Reply posted.", values: { postId: String(data) } };
}

export async function editReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("postId")).data;
  const threadId = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  const body = String(formData.get("body") ?? "");
  if (!id || !threadId) return errorState("That reply wasn't found.", { values: { body } });
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { body: [parsed.error.issues[0].message] }, values: { body } });
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values: { body } });
  const { error } = await supabase.rpc("community_reply_edit", { p_id: id, p_body: parsed.data });
  if (error) return errorState(dbErrorMessage(error, "Your changes couldn't be saved."), { values: { body } });
  revalidatePath(`/community/t/${threadId}`);
  return { status: "success", message: "Reply updated." };
}

export async function deleteReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("postId")).data;
  const threadId = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  if (!id || !threadId) return errorState("That reply wasn't found.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await deleteWithMedia(supabase, "community_reply_delete", id);
  if (error) return errorState(dbErrorMessage(error, "That reply couldn't be deleted."));
  await deleteAttachmentFiles(supabase, (data as { files?: AttachmentFiles[] } | null)?.files);
  revalidatePath(`/community/t/${threadId}`);
  return { status: "success", message: "Reply deleted." };
}

export async function reactAction(input: { type: "thread" | "post"; id: string; kind: string; on: boolean }): Promise<
  { ok: true; reactions: Reactions } | { ok: false; message: string }
> {
  await requireApprovedMember("/community");
  const parsed = z
    .object({ type: z.enum(["thread", "post"]), id: z.uuid(), kind: z.enum(["heart", "pray", "amen"]), on: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "That reaction couldn't be saved." };
  const supabase = await client();
  if (!supabase) return { ok: false, message: UNAVAILABLE };
  const { data, error } = await supabase.rpc("community_react", {
    p_type: parsed.data.type,
    p_id: parsed.data.id,
    p_kind: parsed.data.kind,
    p_on: parsed.data.on,
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "That reaction couldn't be saved.") };
  return { ok: true, reactions: data as Reactions };
}

export async function followAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  if (!id) return errorState("That discussion wasn't found.");
  const on = formData.get("on") === "true";
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_follow", { p_thread: id, p_on: on });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(`/community/t/${id}`);
  return { status: "success", message: on ? "You'll be notified about new replies." : "You won't be notified about new replies." };
}

export async function muteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/notifications/settings");
  const parsed = z
    .object({ type: z.enum(["thread", "group", "conversation"]), id: z.uuid(), on: z.enum(["true", "false"]), path: z.string().max(200).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That couldn't be changed.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_set_mute", { p_type: parsed.data.type, p_id: parsed.data.id, p_muted: parsed.data.on === "true" });
  if (error) return errorState(dbErrorMessage(error));
  if (parsed.data.path?.startsWith("/")) revalidatePath(parsed.data.path);
  revalidatePath("/notifications/settings");
  return { status: "success", message: parsed.data.on === "true" ? "Muted. You won't get notifications about this." : "Unmuted." };
}

export async function reportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/community");
  const parsed = z
    .object({
      type: z.enum(["thread", "post", "message"]),
      ids: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.uuid()).min(1, "Choose what to report.").max(20)),
      reason: z.enum(["harassment", "spam", "inappropriate", "safety", "privacy", "other"], { message: "Choose a reason." }),
      details: z.string().trim().max(1000, "Keep details to 1,000 characters.").default(""),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values: { details: String(formData.get("details") ?? "") } });
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_report", {
    p_type: parsed.data.type,
    p_ids: parsed.data.ids,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details || null,
  });
  if (error) return errorState(dbErrorMessage(error, "Your report couldn't be sent. Please try again."), { values: { details: parsed.data.details } });
  return { status: "success", message: "Thank you. A moderator will review it. The person you reported isn't told who reported them." };
}

export async function modThreadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  const action = z.enum(["pin", "unpin", "lock", "unlock", "hide", "restore"]).safeParse(formData.get("op")).data;
  if (!id || !action) return errorState("That action isn't available.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_mod_thread", {
    p_thread: id,
    p_action: action,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
    p_report: uuid.safeParse(formData.get("reportId")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/community", "layout");
  revalidatePath("/groups", "layout");
  revalidatePath("/admin/moderation", "layout");
  deliverLater();
  const done: Record<typeof action, string> = {
    pin: "Pinned to the top of the list.",
    unpin: "Unpinned.",
    lock: "Locked. No new replies or edits.",
    unlock: "Unlocked.",
    hide: "Hidden from members. The author was told.",
    restore: "Restored and visible again.",
  };
  return { status: "success", message: done[action] };
}

export async function modPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuid.safeParse(formData.get("postId")).data;
  const threadId = uuid.safeParse(formData.get("threadId")).data;
  await requireApprovedMember("/community");
  const action = z.enum(["hide", "restore"]).safeParse(formData.get("op")).data;
  if (!id || !action) return errorState("That action isn't available.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_mod_post", {
    p_post: id,
    p_action: action,
    p_reason: String(formData.get("reason") ?? "").trim(),
    p_report: uuid.safeParse(formData.get("reportId")).data ?? null,
  });
  if (error) return errorState(dbErrorMessage(error));
  if (threadId) revalidatePath(`/community/t/${threadId}`);
  revalidatePath("/admin/moderation", "layout");
  deliverLater();
  return { status: "success", message: action === "hide" ? "Reply hidden. The author was told." : "Reply restored." };
}

export async function ackGuidelinesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/community/guidelines");
  const version = Number(formData.get("version"));
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("community_ack_guidelines", { p_version: version });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/community", "layout");
  const next = String(formData.get("next") ?? "");
  redirect(/^\/(community|groups|messages)(\/[A-Za-z0-9/_?=&-]*)?$/.test(next) ? next : "/community");
}
