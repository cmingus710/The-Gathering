"use server";

import { revalidatePath } from "next/cache";
import { profileSchema } from "@/lib/auth/schemas";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireApprovedMember("/profile");
  const values = formValues(formData);
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Your changes were not saved.", { values });
  // Only these three columns are writable by members (enforced by column grants + RLS).
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, preferred_name: parsed.data.preferredName, phone: parsed.data.phone })
    .eq("id", viewer.id);
  if (error) return errorState("Your changes couldn't be saved. Please try again.", { values });

  revalidatePath("/", "layout");
  return { status: "success", message: "Your profile has been saved.", values };
}
