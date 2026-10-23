import { Flag, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { AUDIENCE_LABEL, PRAYER_REPORT_REASONS } from "@/lib/prayer/format";
import type { LogRow, PrayerReportRow } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Prayer reports" };

const TARGET: Record<PrayerReportRow["target_type"], string> = { request: "Request", comment: "Comment", update: "Update" };

export default async function PrayerModerationPage({ searchParams }: PageProps<"/admin/prayer">) {
  const viewer = await requireCapability(CAPABILITIES.prayerModerate, "/admin/prayer");
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const [reports, log, { settings }] = await Promise.all([
    tryCommunityRpc<PrayerReportRow[]>("prayer_mod_reports", { p_status: status }),
    tryCommunityRpc<LogRow[]>("prayer_mod_log", { p_limit: 50 }),
    getChurchSettings(),
  ]);
  return (
    <>
      <PageHeader
        title="Prayer reports"
        description="Reported prayer content within your scope. You see only the reported item, never other requests. Confidential (team) reports need prayer team access too."
        actions={
          <>
            <ButtonLink href="/admin/prayer/library" variant="secondary" size="sm">
              Prayer Library reports
            </ButtonLink>
            {viewer.capabilities.has(CAPABILITIES.prayerIdentity) ? (
              <ButtonLink href="/admin/prayer/access" variant="secondary" size="sm">
                Sensitive-access log
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="space-y-10">
        <section aria-labelledby="reports-heading">
          <SectionHeading id="reports-heading">Reports</SectionHeading>
          <nav aria-label="Report status" className="mb-3 flex gap-2">
            <Link href="/admin/prayer" aria-current={status === "open" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Open
            </Link>
            <Link href="/admin/prayer?status=closed" aria-current={status === "closed" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Closed
            </Link>
          </nav>
          {!reports ? (
            <Alert tone="error" title="Reports couldn't be loaded." />
          ) : reports.length ? (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/prayer/${r.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{PRAYER_REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</span>
                      <Badge tone="info">{AUDIENCE_LABEL[r.audience]}</Badge>
                      {r.status === "reviewing" ? <Badge tone="warning">In review</Badge> : null}
                    </span>
                    <span className="block text-meta text-text-secondary">
                      {TARGET[r.target_type]} by {r.reported} · {relativeTime(r.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Flag className="size-6" aria-hidden="true" />} title={status === "open" ? "No open reports" : "No closed reports"} />
          )}
        </section>
        <section aria-labelledby="log-heading">
          <SectionHeading id="log-heading">Moderation log</SectionHeading>
          <p className="mb-3 text-meta text-text-secondary">Who did what and why. Never the content itself.</p>
          {log?.length ? (
            <ul className="space-y-1 text-meta">
              {log.map((l, i) => (
                <li key={i}>
                  <time dateTime={l.at} title={exactTime(l.at, settings.timezone)}>{relativeTime(l.at)}</time> · {l.actor} · {l.action}
                  {l.reason ? ` · ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">Nothing logged yet.</p>
          )}
        </section>
        {viewer.capabilities.has(CAPABILITIES.settingsManage) ? (
          <ButtonLink href="/admin/prayer/settings" variant="ghost" size="sm" icon={<Settings className="size-4" aria-hidden="true" />}>
            Prayer settings
          </ButtonLink>
        ) : null}
      </div>
    </>
  );
}
