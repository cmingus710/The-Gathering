"use server";

import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export async function activateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSignedIn("/youth-activate");
  const code = String(formData.get("code") ?? "").slice(0, 40);
  if (!code.trim()) return errorState("Enter the code.");
  const supabase = await createClient();
  if (!supabase) return errorState("Activation is unavailable right now.");
  const { error } = await supabase.rpc("youth_activate", { p_code: code });
  if (error) return errorState(dbErrorMessage(error, "That didn't work. Please try again."));
  redirect("/youth?welcome=1");
}
