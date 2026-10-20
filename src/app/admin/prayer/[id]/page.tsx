import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { CommentModeration, IdentityLookup, RequestModeration } from "@/components/prayer/controls";
import { PrayerResolveForm } from "@/components/prayer/resolve-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { AUDIENCE_LABEL, PRAYER_REPORT_REASONS } from "@/lib/prayer/format";
import type { PrayerReportDetail } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Prayer report" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function PrayerReportPage({ params }: PageProps<"/admin/prayer/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.prayerModerate, `/admin/prayer/${id}`);
  if (!UUID.test(id)) notFound();
  const [r, { settings }] = await Promise.all([tryCommunityRpc<PrayerReportDetail>("prayer_mod_report", { p_id: id }), getChurchSettings()]);
  if (!r) notFound();
  const tz = settings.timezone;
  const closed = r.status === "actioned" || r.status === "dismissed";
  return (
    <>
      <Link href="/admin/prayer" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer reports
      </Link>
      <PageHeader title={PRAYER_REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? "Report"} description={`Reported by ${r.reporter} · ${exactTime(r.created_at, tz)}. Opening this report was recorded.`} />
      <div className="max-w-3xl space-y-6">
        <p className="flex flex-wrap gap-2">
          <Badge tone="info">{AUDIENCE_LABEL[r.audience]}</Badge>
          <Badge tone={closed ? "success" : "warning"}>{r.status}</Badge>
          {r.reported_anonymous ? <Badge tone="neutral">Anonymous author</Badge> : null}
        </p>
        {r.details ? (
          <Card>
            <h2 className="mb-1 font-semibold">Reporter&apos;s note</h2>
            <p className="whitespace-pre-wrap">{r.details}</p>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-1 font-semibold">Reported {r.target_type} (as it was when reported)</h2>
          {r.evidence ? (
            <>
              <p className="mb-2 text-meta text-text-secondary">By {r.evidence.author}</p>
              {r.evidence.title ? <p className="font-semibold">{r.evidence.title}</p> : null}
              <CommunityText source={r.evidence.body} />
            </>
          ) : (
            <p className="text-text-secondary">The evidence was cleared{r.evidence_cleared_at ? ` on ${exactTime(r.evidence_cleared_at, tz)}` : ""}.</p>
          )}
        </Card>
        {r.request_exists ? (
          <Card className="space-y-3">
            <h2 className="font-semibold">Actions</h2>
            {r.current ? (
              <p className="text-meta text-text-secondary">
                Now: {r.target_type === "comment" ? `comment ${r.current.status}` : r.current.hidden ? "hidden" : "visible"}
                {r.current.mod_locked ? " · comments locked" : ""}
              </p>
            ) : null}
            {r.target_type === "comment" && r.current?.status ? (
              <CommentModeration commentId={r.target_id} requestId={r.request_id!} status={r.current.status as "visible" | "hidden" | "deleted"} reportId={r.id} />
            ) : null}
            {!closed ? <RequestModeration id={r.request_id!} hidden={Boolean(r.current?.hidden)} locked={Boolean(r.current?.mod_locked)} reportId={r.id} /> : null}
            {r.can_lookup && r.request_id ? <IdentityLookup requestId={r.request_id} /> : null}
            {r.can_open ? (
              <Link href={`/prayer/${r.request_id}`} className="block text-meta font-semibold text-primary underline">
                Open the request (you can read it as a member)
              </Link>
            ) : null}
          </Card>
        ) : (
          <Alert tone="info" title="The request has since been deleted by its author." />
        )}
        <Card>
          <h2 className="mb-3 font-semibold">{closed ? "Resolution" : "Close the report"}</h2>
          {closed && r.resolution ? <p className="mb-3 whitespace-pre-wrap">{r.resolution}</p> : null}
          <PrayerResolveForm reportId={r.id} closed={closed} />
        </Card>
        {r.log.length ? (
          <Card>
            <h2 className="mb-2 font-semibold">History</h2>
            <ul className="space-y-1 text-meta">
              {r.log.map((l, i) => (
                <li key={i}>
                  {exactTime(l.at, tz)} · {l.actor} · {l.action}
                  {l.reason ? ` · ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
