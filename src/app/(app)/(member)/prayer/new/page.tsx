import type { Metadata } from "next";
import { CommunityText } from "@/components/community/community-text";
import { RequestComposer } from "@/components/prayer/request-composer";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { GroupOption, PrayerGuidance } from "@/lib/prayer/types";
import { saveRequestAction } from "../actions";

export const metadata: Metadata = { title: "Share a prayer request" };

export default async function NewPrayerPage() {
  await requireApprovedMember("/prayer/new");
  const [groups, guidance] = await Promise.all([tryCommunityRpc<GroupOption[]>("prayer_my_groups"), tryCommunityRpc<PrayerGuidance>("prayer_guidance")]);
  return (
    <>
      <BackLink route="/prayer/new" />
      <PageHeader title="Share a prayer request" description="Choose who can see it. You can save a private draft first, and change or remove it later." />
      {!groups || !guidance ? (
        <Alert tone="error" title="Prayer requests are unavailable right now." />
      ) : (
        <div className="space-y-6">
          {guidance.posting_restricted ? (
            <Alert tone="warning" title="Your posting is paused">
              A moderator has paused your community posting, so you can save a private draft only.
            </Alert>
          ) : null}
          <details className="rounded-card border border-border bg-surface px-5 py-4">
            <summary className="cursor-pointer font-semibold">Before you share</summary>
            <div className="mt-3 text-meta">
              <CommunityText source={guidance.guidance} />
            </div>
          </details>
          <RequestComposer action={saveRequestAction} groups={groups} />
        </div>
      )}
    </>
  );
}
