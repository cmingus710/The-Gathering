import type { Metadata } from "next";
import Link from "next/link";
import { CampaignMeter } from "@/components/giving/campaign-meter";
import { Badge, VisibilityBadge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { CAMPAIGN_STATUS_LABEL, campaignDates, type AdminCampaign } from "@/lib/giving/campaigns";
import type { FinanceFund } from "@/lib/giving/finance";
import { requireClient } from "@/lib/supabase/server";
import { FinanceNav, TestModeNotice } from "../finance-nav";
import { CampaignForm } from "./campaign-forms";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS_TONE = { draft: "info", published: "success", closed: "neutral", archived: "neutral" } as const;

export default async function CampaignsPage() {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/campaigns");
  const supabase = await requireClient();
  const canManage = viewer.capabilities.has(CAPABILITIES.financeManage);
  const [{ data }, { data: funds }] = await Promise.all([supabase.rpc("finance_campaigns"), canManage ? supabase.rpc("finance_funds") : Promise.resolve({ data: [] })]);
  const campaigns = (data as AdminCampaign[] | null) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Giving"
        title="Campaigns"
        description="A campaign is a goal that gifts can be made toward. Each one posts to a single fund, so campaign gifts are ordinary contributions in that fund."
      />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/campaigns" capabilities={viewer.capabilities} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="campaign-list">
          <SectionHeading id="campaign-list">All campaigns</SectionHeading>
          {campaigns.length ? (
            <ul className="space-y-3">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Card className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link href={`/admin/finance/campaigns/${c.id}`} className="text-lg font-semibold text-primary hover:underline">
                        {c.title}
                      </Link>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                        <VisibilityBadge visibility={c.visibility} />
                      </div>
                    </div>
                    <p className="text-meta text-text-secondary">
                      {c.fund_name}
                      {campaignDates(c.starts_on, c.ends_on) ? ` · ${campaignDates(c.starts_on, c.ends_on)}` : ""} · {c.gift_count} gift(s)
                    </p>
                    <CampaignMeter raisedCents={Number(c.raised_cents)} goalCents={Number(c.goal_cents)} percent={c.percent} goalReached={c.goal_reached} closed={!c.accepting_gifts} size="sm" />
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No campaigns yet">{canManage ? "Create a draft, then publish it when it's ready." : "Finance managers can create campaigns."}</EmptyState>
          )}
        </section>
        {canManage ? (
          <Card>
            <SectionHeading>New campaign</SectionHeading>
            <p className="mb-4 text-meta text-text-secondary">New campaigns start as drafts and aren&apos;t visible until published.</p>
            <CampaignForm funds={(funds as FinanceFund[] | null) ?? []} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
