import { EyeOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DirectoryProfileView } from "@/components/profile/directory-profile";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getDirectoryMember, type DirectoryProfile } from "@/lib/directory/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preview my directory profile" };

/**
 * Uses the same database projection other members get, so the preview can't
 * drift from what is actually shared.
 */
export default async function PreviewPage() {
  const viewer = await requireApprovedMember("/profile/preview");
  const supabase = await requireClient();
  let profile: DirectoryProfile | null = null;
  let failed = false;
  try {
    profile = await getDirectoryMember(supabase, viewer.id);
  } catch {
    failed = true;
  }

  return (
    <>
      <BackLink route="/profile/preview" />
      <Alert tone="info" title="Preview: this is exactly what other approved members see." className="mb-5" live={false}>
        <div className="flex flex-wrap gap-x-4">
          <Link href="/profile/edit" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">
            Edit details
          </Link>
          <Link href="/profile/privacy" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2">
            Change what&apos;s shared
          </Link>
        </div>
      </Alert>
      {failed ? (
        <Alert tone="error" title="Your preview couldn't be loaded right now." />
      ) : profile ? (
        <DirectoryProfileView profile={profile} linkHousehold={false} />
      ) : (
        <EmptyState
          icon={<EyeOff className="size-6" aria-hidden="true" />}
          title="You're hidden from the directory"
          action={
            <ButtonLink href="/profile/privacy" variant="secondary" size="sm">
              Directory privacy
            </ButtonLink>
          }
        >
          Other members can&apos;t find or view your profile. Church administrators who manage membership can still see it.
        </EmptyState>
      )}
    </>
  );
}
