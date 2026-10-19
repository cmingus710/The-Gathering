import { Mail, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { GroupCardView } from "@/components/community/group-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { signGroupImages, tryCommunityRpc } from "@/lib/community/queries";
import type { GroupCard, GroupInvitation } from "@/lib/community/types";
import { RequestJoinForm, WithdrawRequestButton } from "./group-forms";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  await requireApprovedMember("/groups");
  const sp = await searchParams;
  const data = await tryCommunityRpc<{ mine: GroupCard[]; discover: GroupCard[]; invitations: GroupInvitation[] }>("community_groups");
  const images = data ? await signGroupImages([...data.mine, ...data.discover].map((g) => g.image_path)) : new Map<string, string>();
  return (
    <>
      <PageHeader
        title="Groups"
        description="Small groups and ministries. A group's details, roster, discussions, and events are for its members only."
      />
      {sp.left ? <Alert tone="success" title="You've left the group." className="mb-6" /> : null}
      {!data ? (
        <Alert tone="error" title="Groups couldn't be loaded right now." />
      ) : (
        <div className="space-y-10">
          {data.invitations.length ? (
            <Alert tone="info" title={data.invitations.length === 1 ? "You have a group invitation" : `You have ${data.invitations.length} group invitations`}>
              <ButtonLink href="/groups/invitations" size="sm" variant="secondary" icon={<Mail className="size-4" aria-hidden="true" />} className="mt-2">
                See invitations
              </ButtonLink>
            </Alert>
          ) : null}
          <section aria-labelledby="mine-heading">
            <SectionHeading id="mine-heading">Your groups</SectionHeading>
            {data.mine.length ? (
              <ul className="space-y-3">
                {data.mine.map((g) => (
                  <li key={g.id}>
                    <GroupCardView group={g} imageUrl={g.image_path ? images.get(g.image_path) : null} href={`/groups/${g.id}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<UsersRound className="size-6" aria-hidden="true" />} title="You're not in a group yet">
                Ask to join one below, or accept an invitation from a group leader.
              </EmptyState>
            )}
          </section>
          <section aria-labelledby="discover-heading">
            <SectionHeading id="discover-heading">Find a group</SectionHeading>
            {data.discover.length ? (
              <ul className="space-y-3">
                {data.discover.map((g) => (
                  <li key={g.id}>
                    <GroupCardView group={g} imageUrl={g.image_path ? images.get(g.image_path) : null} href={`/groups/${g.id}`}>
                      {g.my_invitation ? (
                        <ButtonLink href="/groups/invitations" size="sm" variant="secondary">
                          You&apos;re invited: respond
                        </ButtonLink>
                      ) : g.my_request ? (
                        <div className="space-y-2">
                          <p className="text-[0.95rem] font-semibold">Request sent. Waiting for a leader.</p>
                          <WithdrawRequestButton groupId={g.id} />
                        </div>
                      ) : g.accepts_requests ? (
                        <RequestJoinForm groupId={g.id} name={g.name} />
                      ) : (
                        <p className="text-[0.95rem] text-text-secondary">Joins by invitation from a leader.</p>
                      )}
                    </GroupCardView>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No other groups to show">Groups you can ask to join will appear here.</EmptyState>
            )}
          </section>
        </div>
      )}
    </>
  );
}
