import { ChevronRight, HandHelping, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/community/live-refresh";
import { PrayerRow } from "@/components/prayer/prayer-row";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { CARE_KIND_LABEL, CARE_STATUS_LABEL, formatDay, pick } from "@/lib/prayer/format";
import type { CareQueue, PrayerPage } from "@/lib/prayer/types";

export const metadata: Metadata = { title: "Prayer & care workspace" };

const FILTERS = ["unassigned", "mine", "open", "closed"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { unassigned: "Unassigned", mine: "Assigned to me", open: "All open", closed: "Closed" };

/**
 * The protected team workspace. Care coordinators see the care queue;
 * prayer team members see confidential prayer requests. Each list is
 * fetched only for people who hold the matching capability.
 */
export default async function TeamWorkspacePage({ searchParams }: PageProps<"/prayer/team">) {
  const viewer = await requireApprovedMember("/prayer/team");
  const canCare = viewer.capabilities.has(CAPABILITIES.careCoordinate);
  const isTeam = viewer.capabilities.has(CAPABILITIES.prayerConfidential);
  if (!canCare && !isTeam) notFound();
  const sp = await searchParams;
  const filter = pick(sp.care, FILTERS, "unassigned");
  const [queue, confidential] = await Promise.all([
    canCare ? tryCommunityRpc<CareQueue>("care_team_queue", { p_filter: filter }) : Promise.resolve(null),
    isTeam
      ? tryCommunityRpc<PrayerPage>("prayer_requests", { p_view: "feed", p_status: "active", p_audience: "team", p_query: null, p_before: null, p_before_id: null, p_limit: 30 })
      : Promise.resolve(null),
  ]);
  return (
    <>
      <LiveRefresh />
      <BackLink route="/prayer/team" />
      <PageHeader title="Prayer & care workspace" description="Confidential. Please don't copy details out of this space, and share only what someone needs to help." />
      <div className="space-y-10">
        {canCare ? (
          <section aria-labelledby="care-queue" className="space-y-3">
            <SectionHeading id="care-queue" description="Practical help requests. Internal notes are visible only to the assigned coordinator and care leads.">
              Care requests
            </SectionHeading>
            <SegmentedTrack label="Care request filters" className="max-w-full overflow-x-auto">
              {FILTERS.map((f) => (
                <Link key={f} href={`/prayer/team?care=${f}`} className={segmentClass(f === filter)} aria-current={f === filter ? "page" : undefined}>
                  {FILTER_LABEL[f]}
                  {queue && f !== "open" && f !== "closed" ? <span className="text-text-secondary">{queue.counts[f]}</span> : null}
                </Link>
              ))}
            </SegmentedTrack>
            {queue?.counts.due ? <Alert tone="warning" title={`${queue.counts.due} of your requests ${queue.counts.due === 1 ? "is" : "are"} due for follow-up.`} /> : null}
            {!queue ? (
              <Alert tone="error" title="The care queue couldn't be loaded right now." />
            ) : queue.items.length ? (
              <ul className={rowListClass}>
                {queue.items.map((c) => (
                  <li key={c.id}>
                    <ListRow
                      plain
                      href={`/prayer/team/care/${c.id}`}
                      icon={<HandHelping className="size-5" aria-hidden="true" />}
                      label={c.summary}
                      description={`${CARE_KIND_LABEL[c.kind]} · ${CARE_STATUS_LABEL[c.status]} · ${c.assigned ? `Coordinator: ${c.assigned}` : "Unassigned"}${c.follow_up_on ? ` · Follow up ${formatDay(c.follow_up_on)}${c.follow_up_due ? " (due)" : ""}` : ""}`}
                      trailing={
                        <span className="flex items-center gap-1">
                          {relativeTime(c.updated_at)}
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="prayer" title="Nothing here">No care requests match this view.</EmptyState>
            )}
          </section>
        ) : null}
        {isTeam ? (
          <section aria-labelledby="confidential" className="space-y-3">
            <SectionHeading id="confidential" description="Requests shared with the prayer and care team only. Opening one is recorded (not what you read).">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" aria-hidden="true" /> Confidential prayer requests
              </span>
            </SectionHeading>
            {!confidential ? (
              <Alert tone="error" title="Confidential requests couldn't be loaded right now." />
            ) : confidential.items.length ? (
              <ul className={rowListClass}>
                {confidential.items.map((c) => (
                  <li key={c.id}>
                    <PrayerRow card={c} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState glyph="prayer" title="No confidential requests right now" />
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
