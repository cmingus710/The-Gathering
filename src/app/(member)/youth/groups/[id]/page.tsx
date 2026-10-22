import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { AudienceNote } from "@/components/youth/audience";
import { AnnouncementList, LearningList } from "@/components/youth/sections";
import { requireYouthArea } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { Announcement, Audience, Learning } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Youth group" };

type Group = {
  id: string;
  name: string;
  description: string;
  leaders: string[];
  learning: Learning[];
  role: "leader" | "youth" | "guardian";
  can_publish: boolean;
  announcements: Announcement[];
  discussions: Array<{ id: string; title: string; kind: string; status: string; hidden: boolean; last_post_at: string | null; posts: number }>;
  discussions_enabled: boolean;
  supervised: boolean;
  audience: Audience;
  events: Array<{ occurrence_id: string; series_id: string; title: string; starts_at: string; status: string }>;
};

export default async function GroupPage({ params }: PageProps<"/youth/groups/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireYouthArea(`/youth/groups/${id}`);
  const { data: g } = await youthRead<Group>("youth_group", { p_id: id });
  if (!g) return <Alert tone="error" title="This group couldn't be loaded right now." />;
  return (
    <>
      <BackLink route="/youth/groups/[id]" />
      <PageHeader
        eyebrow="Youth group"
        title={g.name}
        description={g.description || (g.leaders.length ? `Leaders: ${g.leaders.join(", ")}` : undefined)}
        actions={g.role === "leader" ? <Link href={`/youth/lead/groups/${g.id}`} className="font-semibold text-primary hover:underline">Lead this group</Link> : undefined}
      />
      <div className="space-y-10">
        <section aria-labelledby="ann">
          <SectionHeading id="ann">Announcements</SectionHeading>
          <AnnouncementList items={g.announcements} empty="No announcements for this group." />
        </section>
        <section aria-labelledby="learn">
          <SectionHeading id="learn">Learning</SectionHeading>
          <LearningList items={g.learning} empty="Nothing assigned right now." />
        </section>
        <section aria-labelledby="events">
          <SectionHeading id="events">Events</SectionHeading>
          {g.events.length === 0 ? (
            <p className="text-meta text-text-secondary">No upcoming events for this group.</p>
          ) : (
            <ul className="space-y-2">
              {g.events.map((e) => (
                <li key={e.occurrence_id} className="rounded-tile border border-border bg-surface px-4 py-3">
                  <p className="font-semibold">{e.title}</p>
                  <p className="text-meta text-text-secondary">{formatWhen(e.starts_at)}{e.status === "canceled" ? " · Canceled" : ""}</p>
                </li>
              ))}
            </ul>
          )}
          {g.role === "guardian" ? <p className="mt-2 text-meta text-text-secondary">Register from your child&apos;s page in the family dashboard.</p> : null}
        </section>
        <section aria-labelledby="disc">
          <SectionHeading id="disc">Group discussions</SectionHeading>
          {!g.discussions_enabled && g.role !== "leader" ? (
            <p className="text-meta text-text-secondary">Group discussions aren&apos;t turned on by the church right now.</p>
          ) : (
            <>
              <Card className="mb-3">
                <AudienceNote audience={g.audience} />
              </Card>
              {g.discussions.length === 0 ? (
                <EmptyState glyph="community" title="No discussions yet">Leaders start discussions for the group.</EmptyState>
              ) : (
                <div className={rowListClass}>
                  {g.discussions.map((d) => (
                    <ListRow
                      key={d.id}
                      plain
                      href={`/youth/discussions/${d.id}`}
                      label={`${d.kind === "prayer" ? "Prayer: " : ""}${d.title}`}
                      description={`${d.posts} ${d.posts === 1 ? "message" : "messages"}${d.status !== "open" ? ` · ${d.status === "locked" ? "Closed" : "Archived"}` : ""}${d.hidden ? " · Hidden" : ""}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
