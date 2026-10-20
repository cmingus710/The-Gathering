import { Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiftRestriction } from "@/components/community/report-review";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { REPORT_REASONS, type ReportSummary } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Moderation" };

type Restriction = { id: string; profile_id: string; name: string; scope: string; reason: string; starts_at: string; ends_at: string | null; by: string };
type LogRow = { action: string; actor: string; report_id: string | null; target_type: string | null; reason: string | null; at: string };

export default async function ModerationPage({ searchParams }: PageProps<"/admin/moderation">) {
  await requireCapability(CAPABILITIES.communityModerate, "/admin/moderation");
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const [reports, restrictions, log, { settings }] = await Promise.all([
    tryCommunityRpc<ReportSummary[]>("community_mod_reports", { p_status: status, p_group: null }),
    tryCommunityRpc<Restriction[]>("community_mod_restrictions"),
    tryCommunityRpc<LogRow[]>("community_mod_log", { p_limit: 50 }),
    getChurchSettings(),
  ]);
  const tz = settings.timezone;
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from members, community restrictions, and the moderation log. You see only reported content, never whole conversations."
      />
      <div className="space-y-10">
        <section aria-labelledby="reports-heading">
          <SectionHeading id="reports-heading">Reports</SectionHeading>
          <nav aria-label="Report status" className="mb-3 flex gap-2">
            <Link href="/admin/moderation" aria-current={status === "open" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Open
            </Link>
            <Link href="/admin/moderation?status=closed" aria-current={status === "closed" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Closed
            </Link>
          </nav>
          {!reports ? (
            <Alert tone="error" title="Reports couldn't be loaded." />
          ) : reports.length ? (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/moderation/${r.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</span>
                      <Badge tone="info">{r.place}</Badge>
                      {r.involves_group_leader ? <Badge tone="danger">About a group leader</Badge> : null}
                      {r.status === "reviewing" ? <Badge tone="warning">In review</Badge> : null}
                    </span>
                    <span className="block text-meta text-text-secondary">
                      {r.target_type === "message" ? `${r.items} ${r.items === 1 ? "message" : "messages"}` : r.target_type === "thread" ? "Discussion" : "Reply"} by {r.reported} ·{" "}
                      {relativeTime(r.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Flag className="size-6" aria-hidden="true" />} title={status === "open" ? "No open reports" : "No closed reports"} />
          )}
        </section>

        <section aria-labelledby="restrictions-heading">
          <SectionHeading id="restrictions-heading">Active community restrictions</SectionHeading>
          {restrictions?.length ? (
            <ul className="space-y-2">
              {restrictions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3">
                  <span>
                    <span className="block font-semibold">
                      {r.name} · {r.scope === "all" ? "posting and messaging" : r.scope}
                    </span>
                    <span className="block text-meta text-text-secondary">
                      {r.reason} · by {r.by} · {r.ends_at ? `until ${exactTime(r.ends_at, tz)}` : "until lifted"}
                    </span>
                  </span>
                  <LiftRestriction restrictionId={r.id} name={r.name} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-card border border-border bg-surface px-5 py-4 text-text-secondary">No active restrictions. Restrictions are applied from a report.</p>
          )}
        </section>

        <section aria-labelledby="log-heading">
          <SectionHeading id="log-heading">Recent moderation activity</SectionHeading>
          {log?.length ? (
            <ul className="space-y-1 text-meta">
              {log.map((l, i) => (
                <li key={i}>
                  <time dateTime={l.at}>{exactTime(l.at, tz)}</time> · {l.actor} · {l.action}
                  {l.reason ? ` · ${l.reason}` : ""}
                  {l.report_id ? (
                    <>
                      {" "}
                      · <Link href={`/admin/moderation/${l.report_id}`} className="text-primary underline">report</Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">No activity yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
