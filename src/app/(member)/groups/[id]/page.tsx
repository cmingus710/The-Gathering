import { ArrowLeft, BellOff, CalendarDays, MessageCircle, PenSquare, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { GroupCardView } from "@/components/community/group-card";
import { LiveRefresh } from "@/components/community/live-refresh";
import { ThreadRow } from "@/components/community/thread-row";
import { ToggleForm } from "@/components/community/toggle-form";
import { EventListItem } from "@/components/events/event-list-item";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { signGroupImages, tryCommunityRpc } from "@/lib/community/queries";
import type { GroupDetail, Roster, ThreadPage } from "@/lib/community/types";
import type { EventOccurrence } from "@/lib/events/types";
import { muteAction } from "../../community/actions";
import { StartConversationButton } from "../../messages/message-forms";
import { LeaveGroupButton, RequestJoinForm, WithdrawRequestButton } from "../group-forms";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({ params, searchParams }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/groups/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const group = await tryCommunityRpc<GroupDetail>("community_group", { p_id: id });
  // Hidden groups and groups the member may not know about: "not found".
  if (!group) notFound();
  const [images, threads, events, roster] = await Promise.all([
    signGroupImages([group.image_path]),
    group.is_member ? tryCommunityRpc<ThreadPage>("community_threads", { p_group: id, p_limit: 20 }) : null,
    group.is_member ? tryCommunityRpc<EventOccurrence[]>("community_group_events", { p_group: id }) : null,
    group.is_member ? tryCommunityRpc<Roster>("community_group_roster", { p_id: id }) : null,
  ]);
  const allThreads = threads ? [...threads.pinned, ...threads.items] : [];
  const now = new Date();

  return (
    <>
      <LiveRefresh />
      <Link href="/groups" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Groups
      </Link>
      {sp.joined ? <Alert tone="success" title={`Welcome to ${group.name}!`} className="mb-4" /> : null}
      <h1 className="sr-only">{group.name}</h1>
      <GroupCardView group={group} imageUrl={group.image_path ? images.get(group.image_path) : null}>
        {group.is_member && group.leaders?.length ? (
          <p className="text-[0.95rem]">
            <span className="text-text-secondary">Led by </span>
            {group.leaders.join(", ")}
            {group.member_count != null ? <span className="text-text-secondary"> · {group.member_count === 1 ? "1 member" : `${group.member_count} members`}</span> : null}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {group.can_manage ? (
            <ButtonLink href={`/groups/${id}/manage`} size="sm" variant="secondary" icon={<Settings className="size-4" aria-hidden="true" />}>
              Manage group
            </ButtonLink>
          ) : null}
          {group.is_member ? (
            <ToggleForm
              action={muteAction}
              hidden={{ type: "group", id, on: String(!group.muted), path: `/groups/${id}` }}
              label={group.muted ? "Muted" : "Mute"}
              pressed={group.muted}
              icon={<BellOff className="size-4" aria-hidden="true" />}
              description={group.muted ? "Unmute this group's notifications" : "Mute notifications from this group"}
            />
          ) : null}
        </div>
      </GroupCardView>

      {group.status === "archived" ? <Alert tone="info" title="This group is archived. Its discussions are read-only." className="mt-4" /> : null}

      {!group.is_member ? (
        <Card className="mt-6">
          {group.my_invitation ? (
            <p>
              You&apos;re invited to this group. <Link href="/groups/invitations" className="font-semibold text-primary underline">Respond to the invitation</Link>
            </p>
          ) : group.my_request ? (
            <div className="space-y-3">
              <p className="font-semibold">Your request to join is waiting for a leader.</p>
              <WithdrawRequestButton groupId={id} />
            </div>
          ) : group.accepts_requests && group.status === "active" ? (
            <RequestJoinForm groupId={id} name={group.name} />
          ) : (
            <p className="text-text-secondary">This group joins by invitation from a leader.</p>
          )}
          <p className="mt-4 text-[0.95rem] text-text-secondary">Discussions, the member list, and group events are visible only to members.</p>
        </Card>
      ) : (
        <div className="mt-8 space-y-10">
          {group.about ? (
            <section aria-labelledby="about-heading">
              <SectionHeading id="about-heading">About</SectionHeading>
              <Card>
                <CommunityText source={group.about} />
              </Card>
            </section>
          ) : null}

          <section aria-labelledby="discussions-heading">
            <SectionHeading
              id="discussions-heading"
              action={
                group.status === "active" ? (
                  <ButtonLink href={`/community/new?group=${id}`} size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                    New discussion
                  </ButtonLink>
                ) : null
              }
            >
              Group discussions (private)
            </SectionHeading>
            {!threads ? (
              <Alert tone="error" title="Discussions couldn't be loaded right now." />
            ) : allThreads.length ? (
              <ul className="space-y-2">
                {allThreads.map((t) => (
                  <li key={t.id}>
                    <ThreadRow thread={t} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No discussions yet">Start the first conversation for this group.</EmptyState>
            )}
          </section>

          <section aria-labelledby="events-heading">
            <SectionHeading id="events-heading">Upcoming group events</SectionHeading>
            {events?.length ? (
              <ul className="space-y-2">
                {events.map((o) => (
                  <li key={o.id}>
                    <EventListItem o={o} now={now} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<CalendarDays className="size-6" aria-hidden="true" />} title="No upcoming group events" />
            )}
          </section>

          <section aria-labelledby="members-heading">
            <SectionHeading id="members-heading">Members</SectionHeading>
            {roster ? (
              <ul className="divide-y divide-border rounded-card bg-surface">
                {roster.members.map((m) => (
                  <li key={m.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <span className="font-semibold">{m.name}</span>
                      {m.me ? <span className="text-text-secondary"> (you)</span> : null}
                      {m.role === "leader" ? <span className="ml-2 text-sm font-bold uppercase tracking-wider text-primary">Leader</span> : null}
                    </span>
                    {!m.me && m.can_message ? <StartConversationButton recipientId={m.id} name={m.name} icon={<MessageCircle className="size-4" aria-hidden="true" />} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Alert tone="error" title="The member list couldn't be loaded." />
            )}
            <p className="mt-2 text-[0.95rem] text-text-secondary">Only names are shown here. Contact details stay private unless someone shares them in the directory.</p>
          </section>

          {group.status === "active" ? <LeaveGroupButton groupId={id} isLeader={group.my_role === "leader"} /> : null}
        </div>
      )}
    </>
  );
}
