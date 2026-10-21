import { randomUUID } from "node:crypto";
import { HandCoins, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { CampaignCard } from "@/components/giving/campaign-card";
import { PageHeader, SectionHeading } from "@/components/ui/card";
import { displayName, getViewer } from "@/lib/auth/viewer";
import { signCampaignImages } from "@/lib/giving/campaign-images";
import type { PublicCampaign } from "@/lib/giving/campaigns";
import { getGivingServer } from "@/lib/giving/server";
import { createClient } from "@/lib/supabase/server";
import { GiveForm } from "./give-form";

export const metadata: Metadata = { title: "Give" };

type PublicConfig = { min_amount_cents: number; max_amount_cents: number; funds: Array<{ id: string; name: string; description: string | null }> };

export default async function GivePage({ searchParams }: PageProps<"/give">) {
  const [params, viewerResult, supabase] = await Promise.all([searchParams, getViewer(), createClient()]);
  const viewer = viewerResult.state === "signed-in" ? viewerResult.viewer : null;
  const available = getGivingServer() !== null;
  let config: PublicConfig | null = null;
  let campaigns: PublicCampaign[] = [];
  let images = new Map<string, string>();
  if (supabase) {
    const [configResult, campaignResult] = await Promise.all([supabase.rpc("giving_public_config"), supabase.rpc("giving_campaigns")]);
    config = (configResult.data as PublicConfig | null) ?? null;
    campaigns = (campaignResult.data as PublicCampaign[] | null) ?? [];
    images = await signCampaignImages(supabase, campaigns.map((c) => c.image_path));
  }

  // Campaign progress is shown even while online checkout isn't set up (gifts recorded by the office count too).
  const campaignList = campaigns.length ? (
    <section aria-labelledby="campaigns-heading" className="mb-8">
              <SectionHeading id="campaigns-heading" description="Give toward a specific goal. Campaign gifts go to the fund shown and count toward the total.">
                Campaigns
              </SectionHeading>
              <ul className="grid gap-4 sm:grid-cols-2">
                {campaigns.map((c) => (
                  <CampaignCard key={c.id} campaign={c} imageUrl={c.image_path ? images.get(c.image_path) : null} />
                ))}
              </ul>
            </section>
  ) : null;

  return (
    <>
      <PageHeader
        eyebrow="Give"
        title="Thank you for giving"
        description="Your generosity helps our church family worship, serve, and care for our neighbors. Choose an amount, how often, and where you'd like it to go."
      />

      {params.canceled === "1" ? (
        <Alert tone="info" title="Checkout was canceled." className="mb-6">
          No payment was made. You can try again whenever you&apos;re ready.
        </Alert>
      ) : null}

      {!available || !config ? (
        <Alert tone="warning" title="Online giving isn't available yet.">
          The church is still setting up online giving. No payment can be made here right now.
        </Alert>
      ) : null}
      {!available || !config ? (
        campaignList ? <div className="mt-6">{campaignList}</div> : null
      ) : !config.funds.length ? (
        <Alert tone="warning" title="No funds are open for giving right now." />
      ) : (
        <>
          {/* Live Stripe keys are refused (src/lib/giving/config.ts), so checkout here is always Stripe test mode. */}
          <Alert tone="warning" title="Testing only: no real money is taken" className="mb-6">
            Online giving is in test mode while we try out the app. Real cards won&apos;t be charged and won&apos;t work here. Please keep
            giving the usual way for now.
          </Alert>
          <p className="mb-6 flex items-start gap-2 text-meta text-text-secondary">
            <HandCoins className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            {viewer ? (
              <span>
                Giving as <span className="font-semibold text-text">{displayName(viewer)}</span>. This gift will appear in{" "}
                <Link href="/giving" className="font-semibold text-primary underline underline-offset-2">
                  your giving history
                </Link>
                .
              </span>
            ) : (
              <span>
                You can give as a guest; you&apos;ll enter your email at checkout for your acknowledgment.{" "}
                <Link href="/sign-in?next=/give" className="font-semibold text-primary underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to keep a giving history.
              </span>
            )}
          </p>
          {campaignList}
          {campaigns.length ? (
            <h2 className="mb-3 text-[1.125rem] font-semibold leading-snug text-text">Give to a fund</h2>
          ) : null}
          <GiveForm funds={config.funds} minCents={config.min_amount_cents} maxCents={config.max_amount_cents} formToken={randomUUID()} />
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
