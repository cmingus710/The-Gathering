"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireYouthArea } from "@/lib/auth/viewer";
import { errorState, type FormState } from "@/lib/forms";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { Fields, OPS } from "@/lib/youth/ops";

/**
 * The one Server Action behind every Youth & Families form (members, youth,
 * leaders, and administrators). The database rechecks the caller's
 * relationship, capability, and the church policy on every call; field values
 * are never logged.
 */
export async function youthFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireYouthArea("/youth");
  const op = OPS[String(formData.get("op") ?? "")];
  if (!op) return errorState("That action isn't available.");
  const fields = new Fields(formData);
  const args = op.args(fields);
  if (typeof args === "string") return errorState(args);
  const supabase = await createClient();
  if (!supabase) return errorState("Youth & Families is unavailable right now. Nothing was changed.");
  const { data, error } = await supabase.rpc(op.fn, args);
  if (error) return errorState(dbErrorMessage(error, "That couldn't be saved right now. Nothing was changed."));
  revalidatePath("/youth", "layout");
  revalidatePath("/admin/youth", "layout");
  const next = op.next?.(data, fields);
  if (next) redirect(next);
  return {
    status: "success",
    message: typeof op.success === "function" ? op.success(data) : op.success,
    values: op.values?.(data),
  };
}

/**
 * Guardian-led practice for a child profile: start, hint, reveal, submit.
 * The database records the result on the child (never on the guardian) and
 * returns only what may be shown at each step.
 */
export async function childPracticeAction(
  step: "start" | "reveal" | "submit" | "hint",
  input: { child?: string; card?: string; activity?: string; difficulty?: string; session?: string; payload?: Record<string, unknown> },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  await requireYouthArea("/youth/family");
  const supabase = await createClient();
  if (!supabase) return { ok: false, message: "Practice is unavailable right now." };
  const call =
    step === "start"
      ? supabase.rpc("youth_child_session_start", { p_child: input.child, p_card: input.card, p_activity: input.activity, p_difficulty: input.difficulty ?? "guided", p_segment: 0 })
      : step === "reveal"
        ? supabase.rpc("youth_child_session_reveal", { p_session: input.session })
        : step === "hint"
          ? supabase.rpc("youth_child_session_hint", { p_session: input.session, p: input.payload ?? {} })
          : supabase.rpc("youth_child_session_submit", { p_session: input.session, p: input.payload ?? {} });
  const { data, error } = await call;
  if (error) return { ok: false, message: dbErrorMessage(error, "That didn't save. Please try again.") };
  if (step === "submit") revalidatePath("/youth/family", "layout");
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}
