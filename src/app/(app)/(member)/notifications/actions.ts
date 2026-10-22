"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isPushServiceEndpoint, testPushPayload } from "@/lib/community/push";
import { getPushSender } from "@/lib/community/server";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Notifications are unavailable right now. Nothing was changed.";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  if (!supabase) return { data: null, error: { message: UNAVAILABLE, code: "P0001" } };
  return supabase.rpc(fn, args);
}

export async function markReadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/notifications");
  const id = z.uuid().safeParse(formData.get("id")).data ?? null;
  const { error } = await rpc("community_notification_read", { p_id: id });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/notifications");
  return { status: "success", message: id ? "Marked as read." : "All notifications marked as read." };
}

/**
 * "Clear read": hides the member's own read notifications from their lists.
 * Only their copies are marked dismissed; nothing they point to changes, and
 * retention removes them on the usual schedule. Returns the batch time so the
 * panel can offer Undo.
 */
export async function clearReadAction(): Promise<{ ok: boolean; message: string; cleared?: number; at?: string }> {
  await requireApprovedMember("/notifications");
  const { data, error } = await rpc("community_notifications_clear_read", {});
  if (error) return { ok: false, message: dbErrorMessage(error) };
  const { cleared, at } = data as { cleared: number; at: string };
  revalidatePath("/notifications");
  return {
    ok: true,
    cleared,
    at,
    message: cleared ? `Cleared ${cleared} read notification${cleared === 1 ? "" : "s"}.` : "There were no read notifications to clear.",
  };
}

export async function undoClearReadAction(at: string): Promise<{ ok: boolean; message: string }> {
  await requireApprovedMember("/notifications");
  const parsed = z.iso.datetime({ offset: true }).safeParse(at);
  if (!parsed.success) return { ok: false, message: "That can't be undone now." };
  const { error } = await rpc("community_notifications_restore", { p_at: parsed.data });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/notifications");
  return { ok: true, message: "Restored." };
}

const CATEGORIES = ["forum", "groups", "messages", "moderation", "events", "prayer", "care", "teaching", "gallery", "reading", "memory", "youth"] as const;

export async function savePrefsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/notifications/settings");
  const shown = new Set(String(formData.get("categories") ?? "").split(","));
  for (const c of CATEGORIES.filter((x) => shown.has(x))) {
    const email = String(formData.get(`${c}.email`) ?? "off");
    const { error } = await rpc("community_set_pref", {
      p_category: c,
      p_in_app: c === "moderation" || formData.get(`${c}.in_app`) === "on",
      p_email: c === "events" ? "off" : email,
      p_push: formData.get(`${c}.push`) === "on",
    });
    if (error) return errorState(dbErrorMessage(error));
  }
  revalidatePath("/notifications", "layout");
  return { status: "success", message: "Notification preferences saved." };
}

export async function saveQuietHoursAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/notifications/settings");
  const parsed = z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time."),
      end: z.string().regex(/^\d{2}:\d{2}$/, "Enter an end time."),
      timezone: z.string().max(64),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message);
  const { error } = await rpc("community_set_quiet_hours", {
    p_enabled: formData.get("enabled") === "on",
    p_start: parsed.data.start,
    p_end: parsed.data.end,
    p_timezone: parsed.data.timezone || null,
  });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/notifications/settings");
  return { status: "success", message: "Quiet hours saved." };
}

const subscriptionSchema = z.object({
  endpoint: z.string().startsWith("https://").max(1000),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
  label: z.string().max(80),
});

export async function pushSubscribeAction(input: { endpoint: string; p256dh: string; auth: string; label: string }): Promise<{ ok: boolean; message: string }> {
  await requireApprovedMember("/notifications/settings");
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This browser's subscription couldn't be saved." };
  const { error } = await rpc("community_push_subscribe", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_label: parsed.data.label,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/notifications/settings");
  return { ok: true, message: "Notifications are on for this device." };
}

export async function pushUnsubscribeAction(input: { id?: string; endpoint?: string }): Promise<{ ok: boolean; message: string }> {
  await requireApprovedMember("/notifications/settings");
  const id = z.uuid().safeParse(input.id).data ?? null;
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.slice(0, 1000) : null;
  const { error } = await rpc("community_push_unsubscribe", { p_id: id, p_endpoint: endpoint });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/notifications/settings");
  return { ok: true, message: "Removed." };
}

/**
 * Sends one test push to the browser that asks, and only to it. The browser
 * re-registers its own subscription first (the same rate-limited RPC as
 * turning push on), which proves the endpoint belongs to the signed-in
 * member; the server never reads another member's subscription here.
 */
export async function pushTestAction(input: { endpoint: string; p256dh: string; auth: string; label: string }): Promise<{ ok: boolean; message: string }> {
  await requireApprovedMember("/notifications/settings");
  const send = getPushSender();
  if (!send) return { ok: false, message: "Push notifications aren't set up for this app yet." };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success || !isPushServiceEndpoint(parsed.data.endpoint)) return { ok: false, message: "This browser's subscription couldn't be used for a test." };
  const { error } = await rpc("community_push_subscribe", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_label: parsed.data.label,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  const { settings } = await getChurchSettings();
  const result = await send(parsed.data, testPushPayload(settings.churchName)).catch(() => "failed" as const);
  if (result === "gone") {
    await rpc("community_push_unsubscribe", { p_id: null, p_endpoint: parsed.data.endpoint });
    revalidatePath("/notifications/settings");
    return { ok: false, message: "This device's subscription has expired. Turn notifications on again." };
  }
  if (result === "failed") return { ok: false, message: "The test couldn't be delivered to this device's push service. Try again in a minute." };
  return { ok: true, message: "Test sent. It should appear within a few seconds, even with the app closed." };
}
