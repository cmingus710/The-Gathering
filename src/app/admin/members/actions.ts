"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { sendEmail } from "@/lib/email/send";
import { membershipApprovedEmail } from "@/lib/email/templates";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { PHOTO_BUCKET } from "@/lib/profile/photos";
import { adminProfileSchema } from "@/lib/profile/schemas";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const statusInput = z.object({
  userId: z.uuid(),
  status: z.enum(["approved", "suspended"]),
});

export async function setMemberStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.membersManage, "/admin/members");
  const parsed = statusInput.safeParse({ userId: formData.get("userId"), status: formData.get("status") });
  if (!parsed.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.");

  const { data: before } = await supabase
    .from("profiles")
    .select("membership_status, email, full_name, preferred_name")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  // The database re-checks permission, self-changes, and the last-super-admin rule.
  const { error } = await supabase.rpc("admin_set_membership_status", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
  });
  if (error) return errorState(dbErrorMessage(error));

  revalidatePath("/admin", "layout");

  if (parsed.data.status === "approved" && before?.membership_status === "pending" && before.email) {
    const { settings } = await getChurchSettings();
    const email = membershipApprovedEmail({ name: before.preferred_name || before.full_name, churchName: settings.churchName });
    const result = await sendEmail({ to: before.email, ...email });
    return {
      status: "success",
      message: result.sent
        ? "Approved. A welcome email has been sent."
        : result.reason === "not_configured"
          ? "Approved. No email was sent because email delivery isn't configured — please let them know personally."
          : "Approved. The welcome email couldn't be sent — please let them know personally.",
    };
  }
  return {
    status: "success",
    message:
      parsed.data.status === "suspended"
        ? "Suspended. They can no longer open member areas."
        : before?.membership_status === "suspended"
          ? "Reinstated. Their member access is restored."
          : "Approved.",
  };
}

const roleInput = z.object({ userId: z.uuid(), role: z.string().regex(/^[a-z_]+$/), op: z.enum(["grant", "revoke"]) });

export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.rolesManage, "/admin/members");
  const parsed = roleInput.safeParse({ userId: formData.get("userId"), role: formData.get("role"), op: formData.get("op") });
  if (!parsed.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.");

  const fn = parsed.data.op === "grant" ? "admin_grant_role" : "admin_revoke_role";
  const { error } = await supabase.rpc(fn, { p_user_id: parsed.data.userId, p_role: parsed.data.role });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin", "layout");
  return { status: "success", message: parsed.data.op === "grant" ? "Role assigned." : "Role removed." };
}

const PROFILE_FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  preferred_name: "preferred name",
  phone: "phone",
  contact_email: "directory email",
  street_address: "street address",
  city: "city",
  state_region: "state",
  postal_code: "postal code",
  bio: "bio",
  birthday: "birthday",
  photo: "photo",
};

/**
 * Corrects a member's profile (members.manage). The database function
 * re-checks the capability, protects super administrators' profiles, and
 * audits the changed field names (never the values).
 */
export async function updateMemberProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.membersManage, "/admin/members");
  const values = formValues(formData);
  const parsed = adminProfileSchema.safeParse({ ...Object.fromEntries(formData), removePhoto: formData.get("removePhoto") === "on" });
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const d = parsed.data;
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.", { values });

  const { data: before } = await supabase.from("member_profile_details").select("photo_path").eq("profile_id", d.userId).maybeSingle();
  const { data: changed, error } = await supabase.rpc("admin_update_member_profile", {
    p_user_id: d.userId,
    p_first_name: d.firstName,
    p_last_name: d.lastName,
    p_preferred_name: d.preferredName,
    p_phone: d.phone,
    p_contact_email: d.contactEmail,
    p_street_address: d.streetAddress,
    p_city: d.city,
    p_state_region: d.stateRegion,
    p_postal_code: d.postalCode,
    p_bio: d.bio,
    p_birthday_month: d.birthdayMonth,
    p_birthday_day: d.birthdayDay,
    p_remove_photo: d.removePhoto,
  });
  if (error) return errorState(dbErrorMessage(error, "The profile couldn't be saved. Check the details and try again."), { values });

  const fields = (changed as string[] | null) ?? [];
  if (fields.includes("photo") && before?.photo_path) {
    await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_path]);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/directory", "layout");
  const { removePhoto: _r, ...rest } = values;
  void _r;
  return fields.length
    ? { status: "success", message: `Saved: ${fields.map((f) => PROFILE_FIELD_LABELS[f] ?? f).join(", ")}.`, values: rest }
    : { status: "success", message: "Nothing changed.", values: rest };
}
