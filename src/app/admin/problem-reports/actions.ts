"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export async function setProblemReportStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/problem-reports");
  const id = z.uuid().safeParse(formData.get("id")).data;
  const status = z.enum(["new", "resolved"]).safeParse(formData.get("status")).data;
  if (!id || !status) return errorState("That action isn't available.");
  const supabase = await createClient();
  if (!supabase) return errorState("Reports can't be changed right now.");
  const { error } = await supabase.rpc("admin_problem_report_set_status", { p_id: id, p_status: status });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/problem-reports");
  return { status: "success", message: status === "resolved" ? "Marked resolved." : "Reopened." };
}
