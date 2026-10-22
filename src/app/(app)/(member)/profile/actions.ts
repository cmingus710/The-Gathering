"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { newPhotoPath, PHOTO_BUCKET, processProfilePhoto, removeOldPhotos } from "@/lib/profile/photos";
import { getProfileDetails } from "@/lib/profile/queries";
import { memberProfileSchema, parsePrivacy } from "@/lib/profile/schemas";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "The member service is unavailable. Your changes were not saved.";
const NOT_SAVED = "Your changes couldn't be saved. Please try again.";

/**
 * Saves the member's own names, contact details, about section, and ministry
 * interests. RLS and column grants limit the writes to the member's own rows
 * and to these fields; status, roles, and the sign-in email can't be changed here.
 */
export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireApprovedMember("/profile/edit");
  // Multi-value checkboxes are echoed separately so the form can restore them after an error.
  const values = { ...formValues(formData, ["interests"]), __interests: formData.getAll("interests").map(String).join(",") };
  const parsed = memberProfileSchema.safeParse({ ...Object.fromEntries(formData), interests: formData.getAll("interests") });
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const d = parsed.data;

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ first_name: d.firstName, last_name: d.lastName, preferred_name: d.preferredName, phone: d.phone })
    .eq("id", viewer.id);
  if (profileError) return errorState(NOT_SAVED, { values });

  const { data: detailsRow, error: detailsError } = await supabase
    .from("member_profile_details")
    .update({
      contact_email: d.contactEmail,
      street_address: d.streetAddress,
      city: d.city,
      state_region: d.stateRegion,
      postal_code: d.postalCode,
      bio: d.bio,
      birthday_month: d.birthdayMonth,
      birthday_day: d.birthdayDay,
    })
    .eq("profile_id", viewer.id)
    .select("profile_id")
    .maybeSingle();
  if (detailsError || !detailsRow) return errorState(NOT_SAVED, { values });

  const { data: current, error: currentError } = await supabase
    .from("member_ministry_interests")
    .select("interest_id")
    .eq("profile_id", viewer.id);
  if (currentError) return errorState(NOT_SAVED, { values });
  const have = new Set((current ?? []).map((r) => r.interest_id as string));
  const want = new Set(d.interests);
  const remove = [...have].filter((id) => !want.has(id));
  const add = [...want].filter((id) => !have.has(id));
  if (remove.length) {
    const { error } = await supabase.from("member_ministry_interests").delete().eq("profile_id", viewer.id).in("interest_id", remove);
    if (error) return errorState(NOT_SAVED, { values });
  }
  if (add.length) {
    const { error } = await supabase.from("member_ministry_interests").insert(add.map((interest_id) => ({ profile_id: viewer.id, interest_id })));
    if (error) return errorState("Some ministry interests are no longer available. Refresh the page and try again.", { values });
  }

  revalidatePath("/", "layout");
  return { status: "success", message: "Your profile has been saved.", values: { ...values, savedAt: String(Date.now()) } };
}

export async function updatePrivacyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireApprovedMember("/profile/privacy");
  const values = formValues(formData);
  const privacy = parsePrivacy(formData);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { data, error } = await supabase
    .from("member_profile_details")
    .update(privacy)
    .eq("profile_id", viewer.id)
    .select("profile_id")
    .maybeSingle();
  if (error || !data) return errorState(NOT_SAVED, { values });
  revalidatePath("/", "layout");
  return {
    status: "success",
    message: privacy.directory_listed ? "Your privacy choices have been saved." : "Saved. You're now hidden from the directory.",
    values: { ...values, savedAt: String(Date.now()) },
  };
}

export async function uploadPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireApprovedMember("/profile/photo");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return errorState("Choose a photo to upload.", { fieldErrors: { photo: ["Choose a photo to upload."] } });

  const processed = await processProfilePhoto(file);
  if (!processed.ok) return errorState(processed.message, { fieldErrors: { photo: [processed.message] } });

  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Your photo was not saved.");

  const path = newPhotoPath(viewer.id);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, processed.bytes, { contentType: "image/webp", cacheControl: "300", upsert: false });
  if (uploadError) return errorState("Your photo couldn't be uploaded. Please try again.");

  const { error } = await supabase.from("member_profile_details").update({ photo_path: path }).eq("profile_id", viewer.id);
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return errorState("Your photo couldn't be saved. Please try again.");
  }
  // The previous photo is deleted, not just unlinked.
  await removeOldPhotos(supabase, viewer.id, path);

  revalidatePath("/", "layout");
  return { status: "success", message: "Your photo has been updated." };
}

export async function removePhotoAction(_prev: FormState): Promise<FormState> {
  void _prev;
  const viewer = await requireApprovedMember("/profile/photo");
  const supabase = await createClient();
  if (!supabase) return errorState("The member service is unavailable. Nothing was changed.");
  const details = await getProfileDetails(supabase, viewer.id).catch(() => null);
  if (!details?.photo_path) return { status: "success", message: "You don't have a photo." };

  const { error } = await supabase.from("member_profile_details").update({ photo_path: null }).eq("profile_id", viewer.id);
  if (error) return errorState("Your photo couldn't be removed. Please try again.");
  await removeOldPhotos(supabase, viewer.id, null);

  revalidatePath("/", "layout");
  return { status: "success", message: "Your photo has been removed. Your initials are shown instead." };
}
