import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignMeter } from "@/components/giving/campaign-meter";
import { Alert } from "@/components/ui/alert";
import { Badge, VisibilityBadge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { signCampaignImages } from "@/lib/giving/campaign-images";
import { CAMPAIGN_STATUS_LABEL, campaignDates, type AdminCampaignDetail } from "@/lib/giving/campaigns";
import { SOURCE_LABEL, type FinanceFund } from "@/lib/giving/finance";
import { formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { FinanceNav, TestModeNotice } from "../../finance-nav";
import { CampaignForm, CampaignStatusButtons } from "../campaign-forms";

export const metadata: Metadata = { title: "Campaign" };

const ACTION_LABEL: Record<string, string> = {
  "finance.campaign_created": "Created",
  "finance.campaign_updated": "Edited",
  "finance.campaign_status": "Status changed",
  "finance.campaign_gift_recorded": "Cash/check gift recorded",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

export default async function CampaignDetailPage({ params, searchParams }: PageProps<"/admin/finance/campaigns/[id]">) {
  const { id } = await params;
  const viewer = await requireCapability(CAPABILITIES.financeView, `/admin/finance/campaigns/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ settings }, sp, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const canManage = viewer.capabilities.has(CAPABILITIES.financeManage);
  const [{ data }, { data: funds }] = await Promise.all([
    supabase.rpc("finance_campaign", { p_id: id }),
    canManage ? supabase.rpc("finance_funds") : Promise.resolve({ data: [] }),
  ]);
  const c = data as AdminCampaignDetail | null;
  if (!c) notFound();
  const imageUrl = c.image_path ? (await signCampaignImages(supabase, [c.image_path])).get(c.image_path) : null;
  const dates = campaignDates(c.starts_on, c.ends_on);
  const n = (x: number | string) => Number(x);
  const tz = settings.timezone;

  return (
    <>
      <Link href="/admin/finance/campaigns" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Campaigns
      </Link>
      <PageHeader eyebrow="Campaign" title={c.title} description={`${c.fund_name}${dates ? ` · ${dates}` : ""}`} />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/campaigns" capabilities={viewer.capabilities} />
      {sp.created === "1" ? (
        <Alert tone="success" title="Draft created." className="mb-6">
          It isn&apos;t visible to anyone outside finance until you publish it.
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={c.status === "published" ? "success" : c.status === "draft" ? "info" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
              <VisibilityBadge visibility={c.visibility} />
              {c.status === "published" && !c.accepting_gifts ? <Badge tone="warning">Not accepting gifts (dates or fund)</Badge> : null}
            </div>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; keep it out of the image cache
              <img src={imageUrl} alt={c.image_alt ?? ""} className="aspect-[16/7] w-full rounded-card object-cover" />
            ) : null}
            <CampaignMeter raisedCents={n(c.raised_cents)} goalCents={n(c.goal_cents)} percent={c.percent} goalReached={c.goal_reached} closed={!c.accepting_gifts} />
            {canManage ? <CampaignStatusButtons id={c.id} status={c.status} /> : null}
            {c.status === "published" || c.status === "closed" ? (
              <p className="text-meta">
                <Link href={`/give/campaigns/${c.id}`} className="font-semibold text-primary underline underline-offset-2">
                  View the member page
                </Link>
              </p>
            ) : null}
          </Card>

          <Card>
            <SectionHeading description={`Test mode only. Computed from gift records each time this page loads.`}>Totals</SectionHeading>
            <dl className="divide-y divide-border">
              <Row label="Received (gross)">{formatCents(n(c.gross_cents))}</Row>
              <Row label="Refunded">−{formatCents(n(c.refunded_cents))}</Row>
              <Row label="Disputes lost">−{formatCents(n(c.disputed_lost_cents))}</Row>
              <Row label="Disputes open (held back until won)">−{formatCents(n(c.disputed_open_cents))}</Row>
              <Row label="Raised (shown on the meter)">{formatCents(n(c.raised_cents))}</Row>
              <Row label="Received gifts">{c.gift_count}</Row>
              <Row label="Pending online payments (not counted)">{c.pending_count}</Row>
              <Row label="Active recurring gifts">{c.active_commitments}</Row>
            </dl>
            <h3 className="mt-5 font-semibold">By source</h3>
            {c.by_source.length ? (
              <table className="mt-2 w-full text-left">
                <thead className="text-sm text-text-secondary">
                  <tr>
                    <th scope="col" className="py-1 font-semibold">Source</th>
                    <th scope="col" className="py-1 text-right font-semibold">Gifts</th>
                    <th scope="col" className="py-1 text-right font-semibold">Gross</th>
                    <th scope="col" className="py-1 text-right font-semibold">Counted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {c.by_source.map((s) => (
                    <tr key={s.source}>
                      <th scope="row" className="py-2 font-normal">{SOURCE_LABEL[s.source] ?? s.source}</th>
                      <td className="py-2 text-right">{s.count}</td>
                      <td className="py-2 text-right">{formatCents(n(s.gross_cents))}</td>
                      <td className="py-2 text-right">{formatCents(n(s.raised_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-1 text-meta text-text-secondary">No received gifts yet.</p>
            )}
            <p className="mt-4 text-meta text-text-secondary">
              To add a cash or check gift, use{" "}
              <Link href="/admin/finance/manual" className="font-semibold text-primary underline underline-offset-2">
                Record cash/check
              </Link>{" "}
              and choose this campaign.
            </p>
          </Card>

          <Card>
            <SectionHeading>History</SectionHeading>
            <ul className="divide-y divide-border">
              {c.history.map((h, i) => (
                <li key={i} className="py-2 text-meta">
                  <span className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</span>
                  {h.action === "finance.campaign_status" ? ` (${String(h.details.from)} → ${String(h.details.to)})` : ""}
                  <span className="text-text-secondary"> · {formatDateTime(h.at, tz)}{h.actor ? ` · ${h.actor}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {canManage ? (
          <Card>
            <SectionHeading>Edit</SectionHeading>
            {c.status === "archived" ? <p className="mb-4 text-meta text-text-secondary">Restore the campaign to edit it.</p> : null}
            <CampaignForm
              key={c.updated_at}
              funds={(funds as FinanceFund[] | null) ?? []}
              initial={{
                id: c.id,
                title: c.title,
                description: c.description ?? "",
                goal: (n(c.goal_cents) / 100).toFixed(2),
                startsOn: c.starts_on ?? "",
                endsOn: c.ends_on ?? "",
                fundId: c.fund_id,
                visibility: c.visibility,
                imageAlt: c.image_alt ?? "",
                hasImage: !!c.image_path,
                fundLocked: c.status !== "draft" || !!c.published_at,
                status: c.status,
              }}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
