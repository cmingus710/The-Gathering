"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Household changes all go through database functions that re-check the
 * caller's membership, ownership of the invitation, expiry, and replay.
 */
async function client() {
  const supabase = await createClient();
  if (!supabase) throw new Error("unavailable");
  return supabase;
}

const UNAVAILABLE = "The member service is unavailable. Nothing was changed.";
const name = z.string().trim().max(80, "Use 80 characters or fewer.");

function done(message: string): FormState {
  revalidatePath("/profile", "layout");
  revalidatePath("/home");
  return { status: "success", message };
}

export async function createHouseholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/profile/household");
  const parsed = name.safeParse(formData.get("displayName") ?? "");
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { displayName: [parsed.error.issues[0].message] } });
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("household_create", { p_display_name: parsed.data || null });
  if (error) return errorState(dbErrorMessage(error));
  return done("Your household has been created. Invite the adults you live with.");
}

export async function renameHouseholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/profile/household");
  const parsed = name.safeParse(formData.get("displayName") ?? "");
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { fieldErrors: { displayName: [parsed.error.issues[0].message] } });
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("household_rename", { p_display_name: parsed.data || null });
  if (error) return errorState(dbErrorMessage(error));
  return done("Household name saved.");
}

const id = z.uuid();

export async function inviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/profile/household");
  const parsed = id.safeParse(formData.get("inviteeId"));
  if (!parsed.success) return errorState("That member can't be invited.");
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("household_invite", { p_invitee: parsed.data });
  if (error) return errorState(dbErrorMessage(error));
  return done("Invitation sent. They'll see it in the app; no email is sent.");
}

export async function revokeInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/profile/household");
  const parsed = id.safeParse(formData.get("invitationId"));
  if (!parsed.success) return errorState("That invitation is no longer open.");
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("household_revoke_invitation", { p_invitation: parsed.data });
  if (error) return errorState(dbErrorMessage(error));
  return done("Invitation withdrawn.");
}

export async function respondInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/profile/household");
  const parsed = z.object({ invitationId: id, answer: z.enum(["accept", "decline"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState("This invitation is no longer available.");
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { data, error } = await supabase.rpc("household_respond", {
    p_invitation: parsed.data.invitationId,
    p_accept: parsed.data.answer === "accept",
  });
  if (error) return errorState(dbErrorMessage(error));
  if (data === "expired") {
    revalidatePath("/profile", "layout");
    return errorState("This invitation has expired. Ask them to send a new one.");
  }
  return done(data === "accepted" ? "You've joined the household." : "Invitation declined.");
}

export async function leaveHouseholdAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  void _formData;
  await requireApprovedMember("/profile/household");
  const supabase = await client().catch(() => null);
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("household_leave");
  if (error) return errorState(dbErrorMessage(error));
  return done("You've left the household.");
}
