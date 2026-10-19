"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { interestLabelSchema } from "@/lib/profile/schemas";
import { createClient } from "@/lib/supabase/server";

const DUPLICATE = "An option with that name already exists.";

export async function addInterestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.membersManage, "/admin/ministry-interests");
  const values = formValues(formData);
  const parsed = interestLabelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.", { values });
  const { error } = await supabase.from("ministry_interests").insert({ label: parsed.data.label, sort_order: parsed.data.sortOrder });
  if (error) return errorState(error.code === "23505" ? DUPLICATE : "That option couldn't be added.", { values });
  revalidatePath("/admin/ministry-interests");
  return { status: "success", message: `Added “${parsed.data.label}”.` };
}

const updateInput = z.object({ id: z.uuid(), op: z.enum(["save", "archive", "restore"]) });

export async function updateInterestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.membersManage, "/admin/ministry-interests");
  const values = formValues(formData);
  const op = updateInput.safeParse(Object.fromEntries(formData));
  if (!op.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.", { values });

  let patch: Record<string, unknown>;
  if (op.data.op === "save") {
    const parsed = interestLabelSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return validationErrorState(parsed.error, values);
    patch = { label: parsed.data.label, sort_order: parsed.data.sortOrder };
  } else {
    patch = { active: op.data.op === "restore" };
  }
  const { data, error } = await supabase.from("ministry_interests").update(patch).eq("id", op.data.id).select("id").maybeSingle();
  if (error || !data) return errorState(error?.code === "23505" ? DUPLICATE : "That change couldn't be saved.", { values });
  revalidatePath("/admin/ministry-interests");
  return {
    status: "success",
    message: op.data.op === "archive" ? "Archived. Members no longer see this option." : op.data.op === "restore" ? "Restored." : "Saved.",
  };
}
