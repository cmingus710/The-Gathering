"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { EVENT_IMAGE_BUCKET, processEventCover } from "@/lib/events/images";
import { eventFormFromData, eventFormSchema, toSeriesPayload, validMeetingUrl } from "@/lib/events/schema";
import { deliverNow } from "@/lib/events/server";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/time";

/**
 * Event administration. Every action requires events.manage here, and the
 * database checks it again. Nothing here logs event content or attendees.
 */
const UNAVAILABLE = "The events service is unavailable. Nothing was changed.";
const uuid = z.uuid();
const NEXT = "/admin/events";

async function client() {
  return createClient();
}

async function notify(occurrence?: string) {
  const { settings } = await getChurchSettings();
  await deliverNow(settings.churchName, occurrence);
}

export async function saveEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const values = { ...formValues(formData, ["cover"]), weekdays: formData.getAll("weekdays").join(","), reminders: formData.getAll("reminders").join(",") };
  const rawId = String(formData.get("id") ?? "");
  const id = rawId ? uuid.safeParse(rawId).data : undefined;
  if (rawId && !id) return errorState("That event couldn't be found.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  let current: { cover_path: string | null } | null = null;
  if (id) {
    const { data } = await supabase.rpc("events_admin_get", { p_series: id });
    if (!data) return errorState("That event couldn't be found.");
    current = data as { cover_path: string | null };
  }

  const file = formData.get("cover");
  const newCover = file instanceof File && file.size > 0 ? file : null;
  const removeCover = formData.get("removeCover") === "on";
  const input = eventFormFromData(formData);
  (input as { hasCover: boolean }).hasCover = Boolean(newCover) || (Boolean(current?.cover_path) && !removeCover);
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
  }
  const payload: Record<string, unknown> = { ...toSeriesPayload(parsed.data), ...(id ? { id } : {}) };

  let uploaded: string | null = null;
  if (newCover) {
    const processed = await processEventCover(newCover, id ?? "new");
    if (!processed.ok) return { status: "error", message: processed.message, fieldErrors: { cover: [processed.message] }, values };
    const { error } = await supabase.storage.from(EVENT_IMAGE_BUCKET).upload(processed.path, processed.bytes, { contentType: "image/webp", upsert: false });
    if (error) return errorState("The image couldn't be uploaded. Nothing was saved.", { values });
    uploaded = processed.path;
    payload.cover_path = uploaded;
  } else if (removeCover || !current?.cover_path) {
    payload.cover_path = null;
    payload.cover_alt = null;
  } else {
    payload.cover_path = current.cover_path;
  }

  const { data, error } = await supabase.rpc("events_admin_save", { p: payload });
  if (error || !data) {
    if (uploaded) await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([uploaded]);
    return errorState(dbErrorMessage(error, "The event couldn't be saved. Please check the details and try again."), { values });
  }
  if ((uploaded || removeCover) && current?.cover_path) await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([current.cover_path]);
  const result = data as { id: string; kept_with_registrations?: number; notified?: number };
  if (result.notified) await notify();
  revalidatePath("/events", "layout");
  revalidatePath(NEXT, "layout");
  const qs = new URLSearchParams({ saved: "1", kept: String(result.kept_with_registrations ?? 0), notified: String(result.notified ?? 0) });
  redirect(`/admin/events/${result.id}?${qs.toString()}`);
}

const statusInput = z.object({
  id: z.uuid(),
  action: z.enum(["publish", "unpublish", "cancel", "archive", "restore"]),
  publishAt: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function eventStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const parsed = statusInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("That request wasn't valid.");
  const { id, action, publishAt, timezone, reason } = parsed.data;
  let when: string | null = null;
  if (action === "publish" && publishAt) {
    const d = zonedLocalToUtc(publishAt, timezone ?? "UTC");
    if (!d) return errorState("Enter a valid publication date and time.", { fieldErrors: { publishAt: ["Enter a valid date and time."] } });
    when = d.toISOString();
  }
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("events_admin_status", { p_series: id, p_action: action, p_publish_at: when, p_reason: reason || null });
  if (error) return errorState(dbErrorMessage(error));
  if ((data as { notified?: number })?.notified) await notify();
  revalidatePath("/events", "layout");
  revalidatePath(NEXT, "layout");
  const message = {
    publish: when && new Date(when) > new Date() ? "Scheduled. The event appears to its audience at the publication time." : "Published. The event is now visible to its audience.",
    unpublish: "Unpublished. The event is a draft again and hidden from members.",
    cancel: "Canceled. Registrants are being emailed, and calendar feeds now show the cancellation.",
    archive: "Archived. The event is hidden from members and calendar feeds.",
    restore: "Restored as a draft.",
  }[action];
  return { status: "success", message };
}

const occurrenceInput = z.object({
  occurrenceId: z.uuid(),
  overrideDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  overrideStartTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/),
  overrideDuration: z.string().regex(/^(\d{1,5})?$/),
  locationName: z.string().trim().max(200),
  locationAddress: z.string().trim().max(300),
  onlineUrl: z.string().trim().max(500),
  note: z.string().trim().max(500),
});

export async function saveOccurrenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const values = formValues(formData);
  const parsed = occurrenceInput.safeParse({
    occurrenceId: formData.get("occurrenceId"),
    overrideDate: formData.get("overrideDate") ?? "",
    overrideStartTime: formData.get("overrideStartTime") ?? "",
    overrideDuration: formData.get("overrideDuration") ?? "",
    locationName: formData.get("locationName") ?? "",
    locationAddress: formData.get("locationAddress") ?? "",
    onlineUrl: formData.get("onlineUrl") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return errorState("Please check the date, time, and length.", { values });
  const v = parsed.data;
  if (v.onlineUrl && !validMeetingUrl(v.onlineUrl)) {
    return errorState("Enter a full https:// meeting link.", { values, fieldErrors: { onlineUrl: ["Enter a full https:// meeting link."] } });
  }
  if (v.overrideDuration && (Number(v.overrideDuration) < 5 || Number(v.overrideDuration) > 10080)) {
    return errorState("Length must be between 5 minutes and 7 days.", { values, fieldErrors: { overrideDuration: ["Use 5 to 10080 minutes."] } });
  }
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase.rpc("events_admin_occurrence_save", {
    p_occurrence: v.occurrenceId,
    p: {
      override_date: v.overrideDate,
      override_start_time: v.overrideStartTime,
      override_duration: v.overrideDuration,
      override_location_name: v.locationName,
      override_location_address: v.locationAddress,
      override_online_url: v.onlineUrl ? validMeetingUrl(v.onlineUrl) : "",
      note: v.note,
    },
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  const notified = (data as { notified?: number })?.notified ?? 0;
  if (notified) await notify(v.occurrenceId);
  revalidatePath("/events", "layout");
  revalidatePath(NEXT, "layout");
  return { status: "success", message: notified ? `Saved. ${notified} registered ${notified === 1 ? "person is" : "people are"} being told about the change.` : "Saved." };
}

export async function occurrenceStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const occurrence = uuid.safeParse(formData.get("occurrenceId")).data;
  const op = formData.get("op");
  if (!occurrence || (op !== "cancel" && op !== "restore")) return errorState("That request wasn't valid.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } =
    op === "cancel"
      ? await supabase.rpc("events_admin_occurrence_cancel", { p_occurrence: occurrence, p_reason: String(formData.get("reason") ?? "").slice(0, 500) || null })
      : await supabase.rpc("events_admin_occurrence_restore", { p_occurrence: occurrence });
  if (error) return errorState(dbErrorMessage(error));
  if ((data as { notified?: number })?.notified) await notify(occurrence);
  revalidatePath("/events", "layout");
  revalidatePath(NEXT, "layout");
  return { status: "success", message: op === "cancel" ? "This date is canceled. Registrants are being emailed." : "This date is back on. Registrants are being emailed." };
}

export async function adminRegisterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const occurrence = uuid.safeParse(formData.get("occurrenceId")).data;
  const profile = uuid.safeParse(formData.get("profileId")).data;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 250);
  if (!occurrence || !profile) return errorState("Choose a member to register.");
  if (!reason) return errorState("Enter a reason for the audit log.", { fieldErrors: { reason: ["Enter a reason."] } });
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("events_admin_register", {
    p_occurrence: occurrence,
    p_profile: profile,
    p_reason: reason,
    p_override_capacity: formData.get("override") === "on",
  });
  if (error) return errorState(dbErrorMessage(error));
  await notify(occurrence);
  revalidatePath(NEXT, "layout");
  return { status: "success", message: (data as { status: string }).status === "waitlisted" ? "Added to the waitlist." : "Registered. They'll get a confirmation email." };
}

export async function adminCancelRegistrationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const registration = uuid.safeParse(formData.get("registrationId")).data;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 250);
  if (!registration) return errorState("That registration wasn't found.");
  if (!reason) return errorState("Enter a reason for the audit log.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_admin_cancel_registration", { p_registration: registration, p_reason: reason });
  if (error) return errorState(dbErrorMessage(error));
  await notify();
  revalidatePath(NEXT, "layout");
  return { status: "success", message: "Registration canceled. They'll be emailed, and the next person on the waitlist (if any) is registered." };
}

export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const id = uuid.safeParse(formData.get("id")).data ?? null;
  const name = String(formData.get("name") ?? "").trim();
  const sort = Number(formData.get("sortOrder") ?? 0);
  if (!name || name.length > 60) return errorState("Enter a category name of up to 60 characters.", { fieldErrors: { name: ["Enter a name."] } });
  if (!Number.isInteger(sort) || sort < 0 || sort > 10000) return errorState("Order must be a whole number from 0 to 10000.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_admin_category_save", { p_id: id, p_name: name, p_active: formData.get("active") === "on" || !id, p_sort: sort });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/events", "layout");
  revalidatePath(NEXT, "layout");
  return { status: "success", message: id ? "Category saved." : "Category added." };
}

export async function saveEventSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const reminders = formData.getAll("reminders").map(Number).filter((n) => [10080, 2880, 1440, 180, 60].includes(n));
  if (reminders.length > 3) return errorState("Choose up to three default reminders.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_admin_settings_save", { p_public_feed: formData.get("publicFeed") === "on", p_default_reminders: reminders });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath(NEXT, "layout");
  return { status: "success", message: "Event settings saved." };
}

export async function retryEventEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.eventsManage, NEXT);
  const id = uuid.safeParse(formData.get("id")).data;
  if (!id) return errorState("That message wasn't found.");
  const supabase = await client();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_admin_email_retry", { p_id: id });
  if (error) return errorState(dbErrorMessage(error));
  await notify();
  revalidatePath(NEXT, "layout");
  return { status: "success", message: "Queued to send again." };
}
