"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedMember, requireSignedIn } from "@/lib/auth/viewer";
import { deliverNow } from "@/lib/events/server";
import { errorState, type FormState } from "@/lib/forms";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Events are unavailable right now. Nothing was changed.";
const id = z.uuid();

async function afterChange(occurrence: string) {
  const { settings } = await getChurchSettings();
  await deliverNow(settings.churchName, occurrence);
  revalidatePath("/events", "layout");
}

export async function rsvpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const occurrence = id.safeParse(formData.get("occurrenceId")).data;
  await requireApprovedMember(occurrence ? `/events/${occurrence}` : "/events");
  if (!occurrence) return errorState("That event wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("events_rsvp", { p_occurrence: occurrence });
  if (error) return errorState(dbErrorMessage(error, "Your registration couldn't be saved. Please try again."));
  await afterChange(occurrence);
  const status = (data as { status: string }).status;
  return {
    status: "success",
    message:
      status === "waitlisted"
        ? "You're on the waitlist. If a place opens, you'll be registered automatically and emailed."
        : "You're registered. A confirmation email is on its way.",
  };
}

export async function cancelRsvpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const occurrence = id.safeParse(formData.get("occurrenceId")).data;
  await requireSignedIn(occurrence ? `/events/${occurrence}` : "/events");
  if (!occurrence) return errorState("That event wasn't found.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_cancel_rsvp", { p_occurrence: occurrence });
  if (error) return errorState(dbErrorMessage(error, "Your registration couldn't be canceled. Please try again."));
  await afterChange(occurrence);
  return { status: "success", message: "Your registration has been canceled." };
}

/** Creates (or replaces) the private feed and returns its URL once. */
/** One action for both feed buttons, so the panel always reflects the latest click. */
export async function feedAction(prev: FormState, formData: FormData): Promise<FormState> {
  return formData.get("op") === "revoke" ? revokeFeedAction(prev) : rotateFeedAction(prev);
}

async function rotateFeedAction(_prev: FormState): Promise<FormState> {
  void _prev;
  await requireApprovedMember("/events/calendar");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("events_feed_token_rotate");
  if (error || typeof data !== "string") return errorState(dbErrorMessage(error, "Your calendar link couldn't be created. Please try again."));
  revalidatePath("/events/calendar");
  // Returned to this browser only; never logged or stored in plain text.
  return { status: "success", message: "Your private calendar link is ready. Copy it now: it won't be shown again.", values: { token: data } };
}

async function revokeFeedAction(_prev: FormState): Promise<FormState> {
  void _prev;
  await requireSignedIn("/events/calendar");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("events_feed_token_revoke");
  if (error) return errorState("Your calendar link couldn't be turned off. Please try again.");
  revalidatePath("/events/calendar");
  return { status: "success", message: "Your private calendar link has been turned off. Calendars using it will stop updating." };
}

export async function setRemindersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/events/calendar");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const enabled = formData.get("reminders") === "on";
  const { error } = await supabase.rpc("events_set_reminders", { p_enabled: enabled });
  if (error) return errorState("Your reminder preference couldn't be saved. Please try again.");
  revalidatePath("/events/calendar");
  return { status: "success", message: enabled ? "Event reminders are on." : "Optional event reminders are off. You'll still get confirmations and change notices." };
}
