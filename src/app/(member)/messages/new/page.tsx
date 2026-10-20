import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { MySettings } from "@/lib/community/types";
import { RecipientSearch } from "../message-forms";

export const metadata: Metadata = { title: "New message" };

export default async function NewMessagePage() {
  await requireApprovedMember("/messages/new");
  const settings = await tryCommunityRpc<MySettings>("community_my_settings");
  return (
    <>
      <Link href="/messages" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Messages
      </Link>
      <PageHeader title="New message" description="Messages are text only and visible only to you and the person you write to." />
      {!settings?.dm_eligible ? (
        <Alert tone="info" title="Direct messaging isn't turned on for your account.">
          {settings?.messaging_restricted ? "A moderator has paused your messaging." : "A membership administrator can turn it on for adult members."}
        </Alert>
      ) : (
        <Card>
          <RecipientSearch />
          <p className="mt-6 text-meta text-text-secondary">
            Members who aren&apos;t listed in the directory can still be messaged from a group you share, if their settings allow it.
          </p>
        </Card>
      )}
    </>
  );
}
