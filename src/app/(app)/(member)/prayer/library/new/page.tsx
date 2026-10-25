import type { Metadata } from "next";
import { LibraryComposer } from "@/components/prayer/library-composer";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { LibraryMeta } from "@/lib/prayer/library";

export const metadata: Metadata = { title: "Add a prayer" };

export default async function NewLibraryPrayerPage({ searchParams }: PageProps<"/prayer/library/new">) {
  const viewer = await requireApprovedMember("/prayer/library/new");
  // Added from a collection page: that collection starts chosen (if it is still active).
  const from = (await searchParams).collection;
  const meta = await tryCommunityRpc<LibraryMeta>("prayer_library_meta");
  return (
    <>
      <BackLink route="/prayer/library/new" />
      <PageHeader title="Add a prayer" description="Share a prayer others can pray too. Save a draft first if you like; publishing shares it with church members right away." />
      {!meta ? (
        <Alert tone="error" title="The Prayer Library is unavailable right now." />
      ) : (
        <LibraryComposer
          categories={meta.categories}
          collections={meta.collections}
          defaultCollection={typeof from === "string" ? from : null}
          contributor={displayName(viewer)}
          postingRestricted={meta.posting_restricted}
        />
      )}
    </>
  );
}
