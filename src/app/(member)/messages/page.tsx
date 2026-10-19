import { BellOff, MessageCircle, PenSquare, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CountPill } from "@/components/community/notification-bell";
import { LiveRefresh } from "@/components/community/live-refresh";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { Conversation } from "@/lib/community/types";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  await requireApprovedMember("/messages");
  const sp = await searchParams;
  const data = await tryCommunityRpc<{ eligible: boolean; items: Conversation[] }>("community_dm_conversations");
  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Messages"
        description="One-to-one messages between members. Only you and the other person can read them."
        actions={
          <>
            <ButtonLink href="/messages/settings" variant="secondary" size="sm" icon={<Settings className="size-4" aria-hidden="true" />}>
              Settings
            </ButtonLink>
            {data?.eligible ? (
              <ButtonLink href="/messages/new" size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                New message
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {sp.cleared ? <Alert tone="success" title="Conversation deleted for you." className="mb-6" /> : null}
      {!data ? (
        <Alert tone="error" title="Messages couldn't be loaded right now." />
      ) : (
        <>
          {!data.eligible ? (
            <Alert tone="info" title="Direct messaging isn't turned on for your account yet" className="mb-6">
              For everyone&apos;s safety, messaging is available to adult members after a membership administrator confirms it. Contact the church office if
              you&apos;d like it turned on. You can still read any conversations you already have.
            </Alert>
          ) : null}
          {data.items.length ? (
            <ul className="space-y-2">
              {data.items.map((c) => (
                <li key={c.id}>
                  <Link href={`/messages/${c.id}`} className="flex min-h-16 items-center gap-4 rounded-card bg-surface px-5 py-3 hover:bg-surface-muted">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary" aria-hidden="true">
                      {c.other_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${c.unread ? "font-bold" : "font-semibold"}`}>{c.other_name}</span>
                      <span className="block truncate text-[0.95rem] text-text-secondary">
                        {c.last_from_me ? "You sent the last message" : "They sent the last message"} · {relativeTime(c.last_message_at)}
                        {c.blocked ? " · Blocked" : ""}
                      </span>
                    </span>
                    {c.muted ? <BellOff className="size-4 text-text-secondary" aria-label="Muted" /> : null}
                    {c.unread ? (
                      <>
                        <CountPill count={c.unread} />
                        <span className="sr-only">{c.unread} unread</span>
                      </>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<MessageCircle className="size-6" aria-hidden="true" />} title="No conversations yet">
              {data.eligible ? "Start one with New message, or from a group's member list." : null}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
