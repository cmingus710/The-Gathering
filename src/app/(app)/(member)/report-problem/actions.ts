"use server";

import { requireApprovedMember } from "@/lib/auth/viewer";
import { problemReportSchema } from "@/lib/feedback/report";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Sends a problem report to the super administrators. The database
 * re-checks membership, validates every field, strips the path again, and
 * rate-limits (5 an hour). On failure the description stays in the form.
 */
export async function reportProblemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireApprovedMember("/report-problem");
  const values = {
    category: String(formData.get("category") ?? ""),
    description: String(formData.get("description") ?? ""),
    pagePath: String(formData.get("pagePath") ?? ""),
    contactOk: formData.get("contactOk") === "on" ? "on" : "",
  };
  const parsed = problemReportSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { fieldErrors, values });
  }
  const supabase = await createClient();
  if (!supabase) return errorState("Reports can't be sent right now. Please try again later.", { values });
  const { error } = await supabase.rpc("problem_report_submit", {
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_page_path: parsed.data.pagePath,
    p_contact_ok: parsed.data.contactOk,
  });
  if (error) return errorState(dbErrorMessage(error, "Your report couldn't be sent. Please try again."), { values });
  return {
    status: "success",
    message: parsed.data.contactOk
      ? "Thank you. An administrator will look into it and may contact you by email."
      : "Thank you. An administrator will look into it.",
  };
}
