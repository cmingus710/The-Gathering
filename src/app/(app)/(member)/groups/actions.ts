"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { deliverCommunityNow } from "@/lib/community/server";
import { processEventCover } from "@/lib/events/images";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Group actions. The database decides who may do what: members join, leave,
 * and answer their own invitations; leaders manage only their own groups;
 * community administrators appoint leaders and change visibility.
 */
const UNAVAILABLE = "Groups are unavailable right now. Nothing was changed.";
const uuid = z.uuid();

function done(groupId: string | null, message: string): FormState {
  revalidatePath("/groups", "layout");
  revalidatePath("/community", "layout");
  if (groupId) revalidatePath(`/groups/${groupId}`, "layout");
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
  return { status: "success", message };
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

export async function requestJoinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = uuid.safeParse(formData.get("groupId")).data;
  await requireApprovedMember("/groups");
  if (!groupId) return errorState("That group wasn't found.");
  const message = String(formData.get("message") ?? "").trim().slice(0, 500);
  const { error } = await rpc("community_group_request", { p_group: groupId, p_message: message || null });
  if (error) return errorState(dbErrorMessage(error));
  return done(groupId, "Request sent. A group leader will review it, and you'll be notified.");
}

export async function withdrawRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = uuid.safeParse(formData.get("groupId")).data;
  await requireApprovedMember("/groups");
  if (!groupId) return errorState("That group wasn't found.");
  const { error } = await rpc("community_group_request_withdraw", { p_group: groupId });
  if (error) return errorState(dbErrorMessage(error));
  return done(groupId, "Request withdrawn.");
}

export async function respondInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/groups/invitations");
  const parsed = z.object({ invitationId: uuid, answer: z.enum(["accept", "decline"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("This invitation is no longer available.");
  const { data, error } = await rpc("community_group_respond", { p_invitation: parsed.data.invitationId, p_accept: parsed.data.answer === "accept" });
  if (error) return errorState(dbErrorMessage(error));
  if (parsed.data.answer === "accept") {
    done(String(data), "");
    redirect(`/groups/${String(data)}?joined=1`);
  }
  return done(null, "Invitation declined.");
}

export async function leaveGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = uuid.safeParse(formData.get("groupId")).data;
  await requireApprovedMember("/groups");
  if (!groupId) return errorState("That group wasn't found.");
  const { error } = await rpc("community_group_leave", { p_group: groupId });
  if (error) return errorState(dbErrorMessage(error));
  done(groupId, "");
  redirect("/groups?left=1");
}

export async function decideRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/groups");
  const parsed = z.object({ requestId: uuid, groupId: uuid, answer: z.enum(["approve", "decline"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That request wasn't found.");
  const { error } = await rpc("community_group_decide", { p_request: parsed.data.requestId, p_approve: parsed.data.answer === "approve" });
  if (error) return errorState(dbErrorMessage(error));
  return done(parsed.data.groupId, parsed.data.answer === "approve" ? "Approved. They're now a member." : "Request declined.");
}

export async function inviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/groups");
  const parsed = z.object({ groupId: uuid, inviteeId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That member can't be invited right now.");
  const { error } = await rpc("community_group_invite", { p_group: parsed.data.groupId, p_invitee: parsed.data.inviteeId });
  if (error) return errorState(dbErrorMessage(error));
  return done(parsed.data.groupId, "Invitation sent. It expires in 14 days unless accepted.");
}

export async function revokeInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/groups");
  const parsed = z.object({ groupId: uuid, invitationId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That invitation is no longer open.");
  const { error } = await rpc("community_group_revoke_invitation", { p_invitation: parsed.data.invitationId });
  if (error) return errorState(dbErrorMessage(error));
  return done(parsed.data.groupId, "Invitation withdrawn.");
}

export async function memberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/groups");
  const parsed = z
    .object({ groupId: uuid, profileId: uuid, op: z.enum(["remove", "add_leader", "remove_leader_role"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That change isn't available.");
  const { error } = await rpc("community_group_set_member", { p_group: parsed.data.groupId, p_profile: parsed.data.profileId, p_action: parsed.data.op });
  if (error) return errorState(dbErrorMessage(error));
  const msg = { remove: "Removed from the group. Their access ended immediately.", add_leader: "Appointed as a leader.", remove_leader_role: "No longer a leader; still a member." };
  return done(parsed.data.groupId, msg[parsed.data.op]);
}

const groupSchema = z.object({
  name: z.string().trim().min(2, "Enter a group name.").max(80, "Keep the name to 80 characters."),
  summary: z.string().trim().max(400, "Keep the summary to 400 characters."),
  about: z.string().trim().max(5000, "Keep the details to 5,000 characters."),
  imageAlt: z.string().trim().max(300, "Keep the description to 300 characters."),
});

/** Edit group details (leaders and community administrators), including the image. */
export async function saveGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = uuid.safeParse(formData.get("groupId")).data;
  await requireApprovedMember("/groups");
  const values = {
    name: String(formData.get("name") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    about: String(formData.get("about") ?? ""),
    imageAlt: String(formData.get("imageAlt") ?? ""),
  };
  if (!groupId) return errorState("That group wasn't found.");
  const parsed = groupSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const payload: Record<string, unknown> = {
    id: groupId,
    name: parsed.data.name,
    summary: parsed.data.summary,
    accepts_requests: formData.get("acceptsRequests") === "on",
  };
  // Administrators who aren't members never see (or overwrite) the members-only details.
  if (formData.has("about")) payload.about = parsed.data.about;
  const visibility = formData.get("visibility");
  if (visibility === "discoverable" || visibility === "hidden") payload.visibility = visibility;

  const file = formData.get("image");
  const oldPath = String(formData.get("currentImage") ?? "") || null;
  let uploaded: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!parsed.data.imageAlt) return errorState("Describe the image for people who can't see it.", { fieldErrors: { imageAlt: ["Describe the image."] }, values });
    const processed = await processEventCover(file, groupId);
    if (!processed.ok) return errorState(processed.message, { fieldErrors: { image: [processed.message] }, values });
    const { error: upErr } = await supabase.storage.from("group-images").upload(processed.path, processed.bytes, { contentType: "image/webp", upsert: false });
    if (upErr) return errorState("The image couldn't be uploaded. Nothing was changed.", { values });
    uploaded = processed.path;
    payload.image_path = processed.path;
    payload.image_alt = parsed.data.imageAlt;
  } else if (formData.get("removeImage") === "on") {
    payload.image_path = null;
  } else if (oldPath) {
    payload.image_alt = parsed.data.imageAlt;
  }

  const { error } = await supabase.rpc("community_group_save", { p: payload });
  if (error) {
    if (uploaded) await supabase.storage.from("group-images").remove([uploaded]);
    return errorState(dbErrorMessage(error), { values });
  }
  if (oldPath && (uploaded || payload.image_path === null)) await supabase.storage.from("group-images").remove([oldPath]);
  return done(groupId, "Group details saved.");
}

export async function inviteSearch(groupId: string, query: string): Promise<Array<{ id: string; name: string }>> {
  await requireApprovedMember("/groups");
  if (!uuid.safeParse(groupId).success) return [];
  const { data } = await rpc("community_group_invite_search", { p_group: groupId, p_query: query.slice(0, 80) });
  return (data as Array<{ id: string; name: string }>) ?? [];
}

export async function leaderSearch(query: string): Promise<Array<{ id: string; name: string }>> {
  await requireApprovedMember("/groups");
  const { data } = await rpc("community_admin_member_search", { p_query: query.slice(0, 80) });
  return (data as Array<{ id: string; name: string }>) ?? [];
}
