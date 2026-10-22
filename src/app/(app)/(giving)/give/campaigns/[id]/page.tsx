import { randomUUID } from "node:crypto";
import { ArrowLeft, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignMeter } from "@/components/giving/campaign-meter";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { displayName, getViewer } from "@/lib/auth/viewer";
import { signCampaignImages } from "@/lib/giving/campaign-images";
import { campaignDates, type PublicCampaign } from "@/lib/giving/campaigns";
import { getGivingServer } from "@/lib/giving/server";
import { createClient } from "@/lib/supabase/server";
import { GiveForm } from "../../give-form";

export const metadata: Metadata = { title: "Campaign" };

type Limits = { min_amount_cents: number; max_amount_cents: number };

/**
 * One campaign: its story, the aggregate progress meter, and (while it's
 * open) the usual gift form with the campaign's fund locked. Visibility is
 * decided by public.giving_campaign: drafts, archived campaigns, and
 * members-only campaigns for guests simply aren't found.
 */
export default async function CampaignPage({ params, searchParams }: PageProps<"/give/campaigns/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [sp, viewerResult, supabase] = await Promise.all([searchParams, getViewer(), createClient()]);
  if (!supabase) notFound();
  const [{ data }, { data: config }] = await Promise.all([supabase.rpc("giving_campaign", { p_id: id }), supabase.rpc("giving_public_config")]);
  const c = data as PublicCampaign | null;
  if (!c) notFound();
  const limits = config as Limits | null;
  const viewer = viewerResult.state === "signed-in" ? viewerResult.viewer : null;
  const available = getGivingServer() !== null && limits !== null;
  const imageUrl = c.image_path ? (await signCampaignImages(supabase, [c.image_path])).get(c.image_path) : null;
  const dates = campaignDates(c.starts_on, c.ends_on);
  const closed = c.status === "closed";

  return (
    <>
      <Link href="/give" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Give
      </Link>
      <PageHeader eyebrow="Campaign" title={c.title} description={dates ? `${dates} · Gifts go to the ${c.fund_name} fund` : `Gifts go to the ${c.fund_name} fund`} />

      {sp.canceled === "1" ? (
        <Alert tone="info" title="Checkout was canceled." className="mb-6">
          No payment was made. You can try again whenever you&apos;re ready.
        </Alert>
      ) : null}

      <Card className="mb-6 space-y-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; keep it out of the image cache
          <img src={imageUrl} alt={c.image_alt ?? ""} className="aspect-[16/7] w-full rounded-card object-cover" />
        ) : null}
        <CampaignMeter raisedCents={c.raised_cents} goalCents={c.goal_cents} percent={c.percent} goalReached={c.goal_reached} closed={!c.accepting_gifts} />
        {c.description ? <p className="whitespace-pre-line text-text">{c.description}</p> : null}
        <p className="text-meta text-text-secondary">
          The total includes online, cash, and check gifts received for this campaign, less refunds. Individual gifts and donors are never shown.
        </p>
      </Card>

      {closed ? (
        <Alert tone="info" title="This campaign is closed.">
          Thank you to everyone who gave. You can still give to the {c.fund_name} fund from the{" "}
          <Link href="/give" className="font-semibold underline underline-offset-2">
            giving page
          </Link>
          .
        </Alert>
      ) : !c.accepting_gifts ? (
        <Alert tone="info" title="This campaign isn't open for gifts yet.">
          {dates ? `Campaign dates: ${dates}. Please check back then.` : "Please check back soon."}
        </Alert>
      ) : !available ? (
        <Alert tone="warning" title="Online giving isn't available yet.">
          The church is still setting up online giving. No payment can be made here right now.
        </Alert>
      ) : (
        <>
          {/* Live Stripe keys are refused (src/lib/giving/config.ts), so checkout here is always Stripe test mode. */}
          <Alert tone="warning" title="Testing only: no real money is taken" className="mb-6">
            Online giving is in test mode while we try out the app. Real cards won&apos;t be charged and won&apos;t work here. Please keep
            giving the usual way for now.
          </Alert>
          <p className="mb-6 text-meta text-text-secondary">
            {viewer ? (
              <>
                Giving as <span className="font-semibold text-text">{displayName(viewer)}</span>.
              </>
            ) : (
              <>
                You can give as a guest.{" "}
                <Link href={`/sign-in?next=/give/campaigns/${c.id}`} className="font-semibold text-primary underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to keep a giving history.
              </>
            )}
          </p>
          <GiveForm
            funds={[{ id: c.fund_id, name: c.fund_name, description: null }]}
            minCents={limits!.min_amount_cents}
            maxCents={limits!.max_amount_cents}
            formToken={randomUUID()}
            campaign={{ id: c.id, title: c.title, fundId: c.fund_id, fundName: c.fund_name }}
          />
          <p className="mt-6 flex items-start gap-2 text-meta text-text-secondary">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Payment is handled securely by Stripe. The church never sees or stores your card details. Gift amounts are private and never
            appear in community areas of the app.
          </p>
        </>
      )}
    </>
  );
}
