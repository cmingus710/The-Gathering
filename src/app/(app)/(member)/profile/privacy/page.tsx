import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getProfileDetails, type ProfileDetails } from "@/lib/profile/queries";
import { PRIVACY_KEYS } from "@/lib/profile/schemas";
import { requireClient } from "@/lib/supabase/server";
import { PrivacyForm } from "./privacy-form";

export const metadata: Metadata = { title: "Directory privacy" };

export default async function PrivacyPage() {
  const viewer = await requireApprovedMember("/profile/privacy");
  const supabase = await requireClient();
  let details: ProfileDetails | null = null;
  try {
    details = await getProfileDetails(supabase, viewer.id);
  } catch {
    details = null;
  }

  return (
    <>
      <BackLink route="/profile/privacy" />
      <PageHeader title="Directory privacy" description="You decide what other members can see. You can change this at any time." />
      <Alert tone="info" title="Who can see your directory profile?" className="mb-6" live={false}>
        <p>
          Only approved members of the church who are signed in. The directory is never public, can&apos;t be searched by
          search engines, and can&apos;t be exported.
        </p>
        <p className="mt-1">
          Church administrators who manage membership can still see your details to care for the church family, even if
          you hide them here.
        </p>
      </Alert>
      {!details ? (
        <Alert tone="error" title="Your privacy settings couldn't be loaded right now." />
      ) : (
        <PrivacyForm initial={Object.fromEntries(PRIVACY_KEYS.map((k) => [k, details[k]]))} />
      )}
    </>
  );
}
