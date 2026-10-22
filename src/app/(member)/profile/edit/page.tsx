import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getOwnProfile, type OwnProfile } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";
import { ProfileDetailsForm } from "./profile-details-form";

export const metadata: Metadata = { title: "Edit profile" };

export default async function EditProfilePage() {
  const viewer = await requireApprovedMember("/profile/edit");
  const supabase = await requireClient();
  let profile: OwnProfile | null = null;
  try {
    profile = await getOwnProfile(supabase, viewer.id);
  } catch {
    profile = null;
  }

  return (
    <>
      <BackLink route="/profile/edit" />
      <PageHeader
        title="Edit profile details"
        description="Everything except your first name is optional. Contact details, street address, and birthday stay hidden until you choose to share them."
      />
      {!profile ? (
        <Alert tone="error" title="Your profile couldn't be loaded right now.">
          Please try again in a moment.
        </Alert>
      ) : (
        <ProfileDetailsForm
          initial={{
            firstName: profile.firstName,
            lastName: profile.lastName,
            preferredName: profile.preferredName,
            phone: profile.phone,
            contactEmail: profile.details.contact_email ?? "",
            streetAddress: profile.details.street_address ?? "",
            city: profile.details.city ?? "",
            stateRegion: profile.details.state_region ?? "",
            postalCode: profile.details.postal_code ?? "",
            bio: profile.details.bio ?? "",
            birthdayMonth: profile.details.birthday_month ? String(profile.details.birthday_month) : "",
            birthdayDay: profile.details.birthday_day ? String(profile.details.birthday_day) : "",
          }}
          interests={profile.interests.map((i) => ({ id: i.id, label: i.label }))}
          chosen={profile.chosenInterestIds}
          visibility={{
            phone: profile.details.show_phone,
            contactEmail: profile.details.show_contact_email,
            street: profile.details.show_street_address,
            city: profile.details.show_city_state || profile.details.show_street_address,
            birthday: profile.details.show_birthday,
            interests: profile.details.show_ministry_interests,
          }}
        />
      )}
    </>
  );
}
