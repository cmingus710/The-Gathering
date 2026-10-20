import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectoryProfileView } from "@/components/profile/directory-profile";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getDirectoryMember, type DirectoryProfile } from "@/lib/directory/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Directory" };

export default async function DirectoryMemberPage({ params }: PageProps<"/directory/[id]">) {
  const { id } = await params;
  const viewer = await requireApprovedMember(`/directory/${id}`);
  const supabase = await requireClient();

  let profile: DirectoryProfile | null;
  try {
    profile = await getDirectoryMember(supabase, id);
  } catch {
    return (
      <Alert tone="error" title="This profile couldn't be loaded right now.">
        Please try again in a moment.
      </Alert>
    );
  }
  // Hidden, pending, suspended, and unknown members all look the same.
  if (!profile) notFound();

  return (
    <>
      <Link href="/directory" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Directory
      </Link>
      {profile.id === viewer.id ? (
        <Alert tone="info" title="This is how other members see you." className="mb-5" live={false}>
          <ButtonLink href="/profile/edit" variant="ghost" size="sm" className="-ml-3">
            Edit my profile
          </ButtonLink>
        </Alert>
      ) : null}
      <DirectoryProfileView profile={profile} />
    </>
  );
}
