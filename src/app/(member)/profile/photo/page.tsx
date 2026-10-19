import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { PHOTO_URL_TTL_SECONDS, signPhotoUrls } from "@/lib/profile/photos";
import { getProfileDetails } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";
import { PhotoForm } from "./photo-form";

export const metadata: Metadata = { title: "Profile photo" };

export default async function PhotoPage() {
  const viewer = await requireApprovedMember("/profile/photo");
  const supabase = await requireClient();
  const details = await getProfileDetails(supabase, viewer.id).catch(() => null);
  const photoUrl = details?.photo_path ? ((await signPhotoUrls(supabase, [details.photo_path])).get(details.photo_path) ?? null) : null;

  return (
    <>
      <Link href="/profile" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Profile
      </Link>
      <PageHeader title="Profile photo" description="Optional. Without a photo, members see your initials." />
      {!details ? (
        <Alert tone="error" title="Your photo settings couldn't be loaded right now." />
      ) : (
        <Card>
          <PhotoForm name={displayName(viewer)} photoUrl={photoUrl} hasPhoto={!!details.photo_path} shared={details.show_photo && details.directory_listed} />
          <p className="mt-6 border-t border-border pt-4 text-[0.95rem] text-text-secondary">
            Photos are stored privately and shown only to signed-in approved members (and only if you share your photo). Each
            photo is resized and its hidden data, such as location, is removed. A replaced or removed photo is deleted; links
            already opened on someone&apos;s screen stop working within {Math.round(PHOTO_URL_TTL_SECONDS / 60)} minutes.
          </p>
        </Card>
      )}
    </>
  );
}
