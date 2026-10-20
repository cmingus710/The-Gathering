import { ChevronRight, PenSquare, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ThreadRow } from "@/components/community/thread-row";
import { Icon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, SectionLink, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { Category, GroupCard, ThreadCard } from "@/lib/community/types";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage({ searchParams }: PageProps<"/community">) {
  await requireApprovedMember("/community");
  const params = await searchParams;
  const [categories, recent, groups, guidelines] = await Promise.all([
    tryCommunityRpc<Category[]>("community_categories"),
    tryCommunityRpc<ThreadCard[]>("community_recent", { p_limit: 8 }),
    tryCommunityRpc<{ mine: GroupCard[] }>("community_groups"),
    tryCommunityRpc<{ acked: boolean; posting_restricted: boolean }>("community_guidelines"),
  ]);

  return (
    <>
      <PageHeader
        title="Community"
        description="Conversations for our church family. Only approved members can read them, and group discussions stay inside their group."
        actions={
          guidelines?.posting_restricted ? null : (
            <ButtonLink href="/community/new" icon={<PenSquare className="size-4" aria-hidden="true" />}>
              Start a discussion
            </ButtonLink>
          )
        }
      />
      {params.deleted ? (
        <Alert tone="success" title="Your discussion was deleted." className="mb-6" />
      ) : null}
      {guidelines && !guidelines.acked ? (
        <Alert tone="info" title="Before you post" className="mb-6">
          Please read the <Link href="/community/guidelines" className="font-semibold text-primary underline">community guidelines</Link>. You can read
          discussions now and post once you&apos;ve accepted them.
        </Alert>
      ) : null}
      {guidelines?.posting_restricted ? (
        <Alert tone="warning" title="Your posting is paused" className="mb-6">
          A moderator has paused your community posting. You can still read discussions. <Link href="/community/guidelines" className="font-semibold text-primary underline">Details</Link>
        </Alert>
      ) : null}
      {!categories ? (
        <Alert tone="error" title="The community couldn't be loaded right now.">
          Please try again in a moment.
        </Alert>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="categories-heading">
            <SectionHeading id="categories-heading">Church-wide discussions</SectionHeading>
            {categories.length ? (
              <ul className={rowListClass}>
                {categories.map((c) => (
                  <li key={c.id}>
                    <ListRow
                      plain
                      href={`/community/c/${c.id}`}
                      icon={<Icon name="community" className="size-5" />}
                      label={c.name}
                      description={c.description || undefined}
                      trailing={
                        <span className="flex items-center gap-1">
                          {c.threads === 1 ? "1 discussion" : `${c.threads} discussions`}
                          {c.last_activity_at ? <span className="sr-only">, last active {relativeTime(c.last_activity_at)}</span> : null}
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="community" title="No categories yet">An administrator can add discussion categories.</EmptyState>
            )}
          </section>

          <section aria-labelledby="groups-heading">
            <SectionHeading id="groups-heading" action={<SectionLink href="/groups">All groups</SectionLink>}>
              Your groups
            </SectionHeading>
            {groups?.mine.length ? (
              <ul className={rowListClass}>
                {groups.mine.map((g) => (
                  <li key={g.id}>
                    <ListRow plain href={`/groups/${g.id}`} icon={<Icon name="groups" className="size-5" />} label={g.name} description="Private group discussions and events" trailing={g.my_role === "leader" ? "Leader" : undefined} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="groups" title="You're not in a group yet" action={<ButtonLink href="/groups" variant="secondary" size="sm">Find a group</ButtonLink>} />
            )}
          </section>

          <section aria-labelledby="recent-heading">
            <SectionHeading id="recent-heading">Recent activity</SectionHeading>
            {recent?.length ? (
              <ul className={rowListClass}>
                {recent.map((t) => (
                  <li key={t.id}>
                    <ThreadRow thread={t} showPlace />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="community" title="No discussions yet">
                Start the first conversation.
              </EmptyState>
            )}
          </section>

          <p className="flex items-center gap-2 text-meta text-text-secondary">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span>
              <Link href="/community/guidelines" className="font-semibold text-primary underline">Community guidelines</Link> · Use Report on anything that seems wrong.
            </span>
          </p>
        </div>
      )}
    </>
  );
}
