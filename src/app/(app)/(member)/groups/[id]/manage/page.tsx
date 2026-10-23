import { Flag } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { signGroupImages, tryCommunityRpc } from "@/lib/community/queries";
import type { GroupDetail, ReportSummary, Roster } from "@/lib/community/types";
import { DecideRequest, GroupDetailsForm, InvitePicker, LeaderPicker, MemberControls, MentionNotifyForm, RevokeInvitation } from "../../group-forms";

export const metadata: Metadata = { title: "Manage group" };

/**
 * Leader tools for ONE group: details, join requests, invitations, roster,
 * and this group's reports. Leaders get nothing outside their own groups:
 * no membership approval, finance, roles, or other groups.
 */
export default async function ManageGroupPage({ params }: PageProps<"/groups/[id]/manage">) {
  const { id } = await params;
  await requireApprovedMember(`/groups/${id}/manage`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const group = await tryCommunityRpc<GroupDetail & { about: string | null }>("community_group", { p_id: id });
  if (!group?.can_manage) notFound();
  const [roster, images, reports] = await Promise.all([
    tryCommunityRpc<Roster>("community_group_roster", { p_id: id }),
    signGroupImages([group.image_path]),
    group.my_role === "leader" || group.is_admin ? tryCommunityRpc<ReportSummary[]>("community_mod_reports", { p_status: "open", p_group: id }) : null,
  ]);
  return (
    <>
      <BackLink route="/groups/[id]/manage" params={{ id }} label={group.name} />
      <PageHeader title="Manage group" description={`Tools for ${group.name}. Changes take effect immediately.`} />
      {group.status === "archived" ? <Alert tone="info" title="This group is archived. Restore it from Administration → Community → Groups to make changes." className="mb-6" /> : null}
      <div className="space-y-10">
        <section aria-labelledby="requests-heading">
          <SectionHeading id="requests-heading">Requests to join</SectionHeading>
          {roster?.requests?.length ? (
            <ul className="space-y-2">
              {roster.requests.map((r) => (
                <li key={r.id} className="space-y-2 rounded-card border border-border bg-surface px-5 py-4">
                  <p>
                    <span className="font-semibold">{r.name}</span> <span className="text-sm text-text-secondary">· {relativeTime(r.created_at)}</span>
                  </p>
                  {r.message ? <p className="text-meta text-text-secondary">&ldquo;{r.message}&rdquo;</p> : null}
                  <DecideRequest requestId={r.id} groupId={id} name={r.name} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No pending requests" />
          )}
        </section>

        {group.status === "active" ? (
          <section aria-labelledby="invite-heading">
            <SectionHeading id="invite-heading">Invite</SectionHeading>
            <Card>
              <InvitePicker groupId={id} />
            </Card>
            {roster?.invitations?.length ? (
              <ul className="mt-3 space-y-2">
                {roster.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3">
                    <span>
                      <span className="font-semibold">{i.name}</span>
                      <span className="block text-sm text-text-secondary">Invited · expires {new Date(i.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>
                    </span>
                    <RevokeInvitation invitationId={i.id} groupId={id} name={i.name} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="roster-heading">
          <SectionHeading id="roster-heading">Members</SectionHeading>
          {roster ? (
            <ul className="divide-y divide-border rounded-card border border-border bg-surface">
              {roster.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span>
                    <span className="font-semibold">{m.name}</span>
                    {m.me ? <span className="text-text-secondary"> (you)</span> : null}
                    {m.role === "leader" ? <span className="ml-2 text-meta font-semibold text-primary">Leader</span> : null}
                    <span className="block text-sm text-text-secondary">Joined {relativeTime(m.joined_at)}</span>
                  </span>
                  {!m.me ? <MemberControls groupId={id} profileId={m.id} name={m.name} role={m.role} isAdmin={roster.is_admin} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Alert tone="error" title="The member list couldn't be loaded." />
          )}
          <p className="mt-2 text-meta text-text-secondary">
            Leaders can remove members. Appointing or removing leaders is done by a community administrator; a group always keeps at least one leader unless it&apos;s
            archived.
          </p>
          {roster?.is_admin ? (
            <Card className="mt-4">
              <LeaderPicker groupId={id} />
            </Card>
          ) : null}
        </section>

        {reports ? (
          <section aria-labelledby="reports-heading">
            <SectionHeading id="reports-heading" action={<ButtonLink href={`/groups/${id}/manage/reports`} size="sm" variant="secondary" icon={<Flag className="size-4" aria-hidden="true" />}>All reports</ButtonLink>}>
              Reports in this group
            </SectionHeading>
            <p className="rounded-card border border-border bg-surface px-5 py-4">
              {reports.length ? `${reports.length} open ${reports.length === 1 ? "report" : "reports"} to review.` : "No open reports."}{" "}
              <span className="text-text-secondary">Reports about a group leader go to the church&apos;s community moderators instead.</span>
            </p>
          </section>
        ) : null}

        {group.status === "active" && group.mention_notify ? (
          <section aria-labelledby="mentions-heading">
            <SectionHeading id="mentions-heading">@Mentions</SectionHeading>
            <Card>
              <MentionNotifyForm groupId={id} value={group.mention_notify} />
            </Card>
          </section>
        ) : null}

        {group.status === "active" ? (
          <section aria-labelledby="details-heading">
            <SectionHeading id="details-heading">Group details</SectionHeading>
            <Card>
              <GroupDetailsForm
                group={{ id, name: group.name, summary: group.summary, about: group.is_member ? (group.about ?? "") : null, image_path: group.image_path, image_alt: group.image_alt, visibility: group.visibility, accepts_requests: group.accepts_requests }}
                imageUrl={group.image_path ? (images.get(group.image_path) ?? null) : null}
                isAdmin={group.is_admin}
              />
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
