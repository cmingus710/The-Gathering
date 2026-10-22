import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { MySettings } from "@/lib/community/types";
import { BlockToggle, DmAllowForm } from "../message-forms";

export const metadata: Metadata = { title: "Message settings" };

export default async function MessageSettingsPage() {
  await requireApprovedMember("/messages/settings");
  const [settings, blocked] = await Promise.all([
    tryCommunityRpc<MySettings>("community_my_settings"),
    tryCommunityRpc<Array<{ id: string; name: string; since: string }>>("community_blocked"),
  ]);
  return (
    <>
      <BackLink route="/messages/settings" />
      <PageHeader title="Message settings and privacy" />
      {!settings ? (
        <Alert tone="error" title="Settings couldn't be loaded right now." />
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="eligibility-heading">
            <SectionHeading id="eligibility-heading">Your account</SectionHeading>
            <Card>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                {settings.dm_eligible
                  ? "Direct messaging is on for your account."
                  : settings.messaging_restricted
                    ? "A moderator has paused your direct messaging."
                    : "Direct messaging isn't on for your account yet. A membership administrator turns it on for adult members."}
              </p>
            </Card>
          </section>
          <section aria-labelledby="allow-heading">
            <SectionHeading id="allow-heading">Who can message you</SectionHeading>
            <Card>
              <DmAllowForm current={settings.dm_allow} />
            </Card>
          </section>
          <section aria-labelledby="blocked-heading">
            <SectionHeading id="blocked-heading">Blocked members</SectionHeading>
            {blocked?.length ? (
              <ul className="space-y-2">
                {blocked.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3">
                    <span className="font-semibold">{b.name}</span>
                    <BlockToggle profileId={b.id} name={b.name} blocked path="/messages/settings" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="You haven't blocked anyone" />
            )}
          </section>
          <section aria-labelledby="privacy-heading" className="space-y-2 text-meta text-text-secondary">
            <SectionHeading id="privacy-heading">How messages are protected</SectionHeading>
            <p>Only you and the other person can read a conversation. Messages are protected by access controls on our servers; they are not end-to-end encrypted.</p>
            <p>Church administrators can&apos;t browse messages. If you report messages, moderators see only the messages you select.</p>
            <p>Email and phone notifications never include message text; they only say you have a new message.</p>
            <p>
              Blocking stops direct messages both ways and their message notifications. It doesn&apos;t hide the person&apos;s posts in discussions or groups you share.
            </p>
            <p>Deleting a conversation removes it from your view; once both people delete it, the messages are erased. All messages are erased after two years.</p>
            <p>Your hidden directory details (email, phone, address) are never shown in messages or search.</p>
          </section>
        </div>
      )}
    </>
  );
}
