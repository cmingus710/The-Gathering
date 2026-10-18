"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { sendEmail } from "@/lib/email/send";
import { membershipApprovedEmail } from "@/lib/email/templates";
import { errorState, type FormState } from "@/lib/forms";
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
