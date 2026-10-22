import { CircleCheck, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getViewer } from "@/lib/auth/viewer";
import { FREQUENCY_LABEL, formatCents, type Frequency } from "@/lib/giving/money";
import { getGivingServer } from "@/lib/giving/server";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };

type Status = { state: "confirmed" | "processing" | "failed" | "expired" | "unknown"; amount_cents?: number; frequency?: Frequency; fund_name?: string };

/**
 * Shows what the database knows about this checkout. Reaching this page
 * never marks a gift paid: confirmation comes only from Stripe's webhook.
 */
export default async function ThanksPage({ searchParams }: PageProps<"/give/thanks">) {
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(params.session_id) ? params.session_id : null;
  const server = getGivingServer();
  let status: Status = { state: "unknown" };
  if (server && sessionId) {
    try {
      status = await server.ingest<Status>("checkout_status", { session_id: sessionId });
    } catch {
      status = { state: "unknown" };
    }
  }
  const viewer = await getViewer();
  const signedIn = viewer.state === "signed-in";
  const summary =
    status.amount_cents != null ? `${formatCents(status.amount_cents)} · ${FREQUENCY_LABEL[status.frequency ?? "one_time"]} · ${status.fund_name}` : null;

  return (
    <div className="mx-auto max-w-xl space-y-6 pt-4">
      {status.state === "confirmed" ? (
        <Card className="text-center">
          <CircleCheck className="mx-auto size-12 text-success" aria-hidden="true" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Thank you for your gift</h1>
          {summary ? <p className="mt-2 text-lg">{summary}</p> : null}
          <p className="mt-2 text-text-secondary">Your gift has been received. An acknowledgment is on its way to your email.</p>
        </Card>
      ) : status.state === "processing" ? (
        <Card className="text-center">
          <Clock className="mx-auto size-12 text-primary" aria-hidden="true" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Thank you — we&apos;re confirming your gift</h1>
          {summary ? <p className="mt-2 text-lg">{summary}</p> : null}
          <p className="mt-2 text-text-secondary">
            Your payment provider is still confirming this payment. Some payment methods take a few days. You&apos;ll receive an email once it&apos;s received.
          </p>
          <AutoRefresh />
        </Card>
      ) : status.state === "failed" ? (
        <Alert tone="error" title="Your payment didn't go through.">
          No gift was recorded. You can <Link href="/give" className="font-semibold underline">try again</Link> with a different payment method.
        </Alert>
      ) : status.state === "expired" ? (
        <Alert tone="info" title="This checkout expired.">
          No payment was made. <Link href="/give" className="font-semibold underline">Start a new gift</Link>.
        </Alert>
      ) : (
        <Alert tone="info" title="We couldn't find that checkout.">
          If you completed a payment, you&apos;ll receive an email confirmation once it&apos;s received.
        </Alert>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {signedIn ? (
          <ButtonLink href="/giving" variant="secondary">
            Your giving
          </ButtonLink>
        ) : null}
        <ButtonLink href="/give" variant="secondary">
          Give again
        </ButtonLink>
      </div>
    </div>
  );
}
