import { ArrowLeft, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CommunityText } from "@/components/community/community-text";
import { AckGuidelinesForm } from "@/components/community/ack-guidelines-form";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";

export const metadata: Metadata = { title: "Community guidelines" };

type Guidelines = {
  text: string;
  version: number;
  acked: boolean;
  posting_restricted: boolean;
  messaging_restricted: boolean;
  restriction: { scope: string; reason: string; ends_at: string | null } | null;
};

export default async function GuidelinesPage({ searchParams }: PageProps<"/community/guidelines">) {
  await requireApprovedMember("/community/guidelines");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/community";
  const g = await tryCommunityRpc<Guidelines>("community_guidelines");
  return (
    <>
      <Link href="/community" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Community
      </Link>
      <PageHeader title="Community guidelines" description="How we care for one another in discussions, groups, and messages." />
      {!g ? (
        <Alert tone="error" title="The guidelines couldn't be loaded right now." />
      ) : (
        <div className="space-y-6">
          {g.restriction ? (
            <Alert tone="warning" title={g.restriction.scope === "messaging" ? "Your direct messaging is paused" : g.restriction.scope === "posting" ? "Your posting is paused" : "Your community participation is paused"}>
              Reason given by the moderator: {g.restriction.reason}
              {g.restriction.ends_at ? ` · Ends ${new Date(g.restriction.ends_at).toLocaleDateString("en-US", { dateStyle: "long" })}` : ""}. This doesn&apos;t change your church
              membership. To talk about it, contact the church office.
            </Alert>
          ) : null}
          <Card>
            <CommunityText source={g.text} />
          </Card>
          {g.acked ? (
            <p className="flex items-center gap-2 font-semibold text-success">
              <CircleCheck className="size-5" aria-hidden="true" /> You&apos;ve accepted these guidelines.
            </p>
          ) : (
            <Card>
              <AckGuidelinesForm version={g.version} next={next} />
            </Card>
          )}
          <section aria-labelledby="privacy-heading" className="space-y-2 text-[0.95rem] text-text-secondary">
            <h2 id="privacy-heading" className="text-[0.95rem] font-bold uppercase tracking-[0.08em] text-text">Privacy at a glance</h2>
            <p>Church-wide discussions are visible to approved members only. Group discussions are visible only to that group&apos;s current members.</p>
            <p>
              Direct messages are visible only to the two people in the conversation. They are protected by access controls, not end-to-end encryption.
              Administrators can&apos;t browse messages; moderators see only messages someone chooses to report.
            </p>
            <p>When you delete a post its text is erased. Edits replace the earlier text. <Link href="/messages/settings" className="font-semibold text-primary underline">Message settings and blocking</Link></p>
          </section>
        </div>
      )}
    </>
  );
}
