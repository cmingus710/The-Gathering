import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Leading youth" };

type LeadHome = {
  groups: Array<{ id: string; name: string; role: string; can_publish: boolean; can_manage_enrollment: boolean; enrolled: number; supervised: boolean }>;
  open_reports: number;
  events: Array<{ series_id: string; title: string; group: string; next: string | null; personnel: boolean }>;
};

export default async function LeadPage() {
  await requireApprovedMember("/youth/lead");
  const { data, failed } = await youthRead<LeadHome>("youth_lead_home");
  return (
    <>
      <PageHeader
        eyebrow="Youth & Families"
        title="Leading"
        description="Only the groups you're assigned to. You never see contact details, dates of birth, or anyone's private learning."
        actions={data && data.open_reports > 0 ? <ButtonLink href="/youth/lead/reports">Reports ({data.open_reports})</ButtonLink> : <ButtonLink href="/youth/lead/reports" variant="secondary">Reports</ButtonLink>}
      />
      {failed || !data ? (
        <Alert tone="error" title="This page couldn't be loaded right now." />
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="groups">
            <SectionHeading id="groups">Your groups</SectionHeading>
            {data.groups.length === 0 ? (
              <EmptyState glyph="groups" title="You're not leading a youth group">A youth ministry administrator assigns leaders to groups.</EmptyState>
            ) : (
              <div className={rowListClass}>
                {data.groups.map((g) => (
                  <ListRow
                    key={g.id}
                    plain
                    href={`/youth/lead/groups/${g.id}`}
                    label={g.name}
                    description={`${g.role === "helper" ? "Helper" : "Leader"} · ${g.enrolled} enrolled`}
                    trailing={g.supervised ? <Badge tone="success">Discussions can open</Badge> : <Badge tone="neutral">Needs more leaders or members for discussions</Badge>}
                  />
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="events">
            <SectionHeading id="events">Youth events</SectionHeading>
            {data.events.length === 0 ? (
              <p className="text-meta text-text-secondary">No upcoming youth events for your groups.</p>
            ) : (
              <div className={rowListClass}>
                {data.events.map((e) => (
                  <ListRow
                    key={e.series_id}
                    plain
                    href={`/youth/lead/events/${e.series_id}`}
                    label={e.title}
                    description={`${e.group}${e.next ? ` · next ${formatWhen(e.next)}` : ""}`}
                    trailing={e.personnel ? <Badge tone="info">Event personnel</Badge> : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
