"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { LIMITS } from "@/lib/community/format";
import { deliverCommunityNow } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Direct-message actions. The database checks eligibility, membership,
 * the recipient's settings, blocks, restrictions, and rate limits on every
 * send. Message text is never logged here.
 */
const UNAVAILABLE = "Messages are unavailable right now. Nothing was sent.";
const uuid = z.uuid();

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

export async function startConversationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/messages");
  const recipient = uuid.safeParse(formData.get("recipientId")).data;
  if (!recipient) return errorState("This member isn't available for direct messages.");
  const { data, error } = await rpc("community_dm_start", { p_recipient: recipient });
  if (error) return errorState(dbErrorMessage(error, "This member isn't available for direct messages."));
  redirect(`/messages/${String(data)}`);
}

export type SendResult = { ok: true; id: string; created_at: string } | { ok: false; message: string };

export async function sendMessageAction(input: { conversationId: string; body: string; clientKey: string }): Promise<SendResult> {
  await requireApprovedMember("/messages");
  const parsed = z
    .object({
      conversationId: z.uuid(),
      clientKey: z.uuid(),
      body: z.string().trim().min(1, "Write a message first.").max(LIMITS.message, `Keep messages to ${LIMITS.message.toLocaleString()} characters.`),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { data, error } = await rpc("community_dm_send", {
    p_conversation: parsed.data.conversationId,
    p_body: parsed.data.body,
    p_client_key: parsed.data.clientKey,
  });
  if (error) return { ok: false, message: dbErrorMessage(error, "Your message wasn't sent. It's still in the box; try again.") };
  after(async () => {
    const { settings } = await getChurchSettings();
    await deliverCommunityNow(settings.churchName);
  });
  const row = data as { id: string; created_at: string };
  return { ok: true, id: row.id, created_at: row.created_at };
}

export async function markReadAction(conversationId: string): Promise<void> {
  await requireApprovedMember("/messages");
  if (!uuid.safeParse(conversationId).success) return;
  await rpc("community_dm_mark_read", { p_conversation: conversationId });
}

export async function clearConversationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/messages");
  const id = uuid.safeParse(formData.get("conversationId")).data;
  if (!id) return errorState("That conversation wasn't found.");
  const { error } = await rpc("community_dm_clear", { p_conversation: id });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/messages", "layout");
  redirect("/messages?cleared=1");
}

export async function blockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/messages");
  const parsed = z.object({ profileId: uuid, on: z.enum(["true", "false"]), path: z.string().max(200).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That member wasn't found.");
  const { error } = await rpc("community_block", { p_profile: parsed.data.profileId, p_block: parsed.data.on === "true" });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/messages", "layout");
  if (parsed.data.path?.startsWith("/")) revalidatePath(parsed.data.path);
  return {
    status: "success",
    message:
      parsed.data.on === "true"
        ? "Blocked. Neither of you can send the other new direct messages, and you won't get message notifications from them. They aren't told."
        : "Unblocked.",
  };
}

export async function setDmAllowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/messages/settings");
  const allow = z.enum(["members", "shared_groups", "none"]).safeParse(formData.get("allow")).data;
  if (!allow) return errorState("Choose who can message you.");
  const { error } = await rpc("community_set_dm_allow", { p_allow: allow });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/messages", "layout");
  return { status: "success", message: "Saved." };
}

export async function recipientSearch(query: string): Promise<Array<{ id: string; name: string }>> {
  await requireApprovedMember("/messages/new");
  const { data } = await rpc("community_dm_recipients", { p_query: query.slice(0, 80) });
  return (data as Array<{ id: string; name: string }>) ?? [];
}
