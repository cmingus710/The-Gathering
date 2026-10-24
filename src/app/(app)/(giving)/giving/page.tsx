import { randomUUID } from "node:crypto";
import { FileText, HandCoins, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GiftStatusBadge as StatusBadge } from "@/components/giving/gift-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireSignedIn } from "@/lib/auth/viewer";
import { FREQUENCY_LABEL, formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { ClaimForm, RecurringControls } from "./giving-forms";
import type { MyGiving } from "./types";

export const metadata: Metadata = { title: "Your giving" };

const COMMITMENT_STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment failed: update your payment method",
  unpaid: "Paused by failed payments",
  canceled: "Canceled",
  incomplete: "Waiting for first payment",
};

export default async function GivingPage() {
  const viewer = await requireSignedIn("/giving");
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const { data, error } = await supabase.rpc("my_giving");
  const giving = data as MyGiving | null;

  return (
    <>
      <SectionHeader section="give" size="compact"
        title="Your giving"
        description="Only you can see this page. Finance administrators can see contribution records; other members never can."
        actions={<ButtonLink href="/give" icon={<HandCoins className="size-4" aria-hidden="true" />}>Give</ButtonLink>}
      />
      {error || !giving ? (
        <Alert tone="error" title="Your giving couldn't be loaded right now." />
      ) : (
        <div className="space-y-8">
          {giving.commitments.length ? (
            <section aria-labelledby="recurring-heading">
              <SectionHeading id="recurring-heading">Recurring gifts</SectionHeading>
              <ul className="space-y-3">
                {giving.commitments.map((c) => {
                  const live = ["active", "trialing", "past_due"].includes(c.status);
                  return (
                    <li key={c.id}>
                      <Card className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="flex items-center gap-2 text-lg font-bold">
                              <Repeat className="size-5 text-primary" aria-hidden="true" />
                              {formatCents(c.amount_cents)} {FREQUENCY_LABEL[c.frequency].toLowerCase()}
                            </p>
                            <p className="text-text-secondary">{c.fund_name}</p>
                          </div>
                          <Badge tone={c.status === "past_due" ? "danger" : live ? "success" : "neutral"}>{COMMITMENT_STATUS[c.status] ?? c.status}</Badge>
                        </div>
                        <p className="text-meta text-text-secondary">
                          {c.next_payment_at
                            ? `Next gift: ${formatDate(c.next_payment_at, settings.timezone)}`
                            : c.canceled_at
                              ? `Canceled ${formatDate(c.canceled_at, settings.timezone)}. No further gifts will be charged.`
                              : "No upcoming gift scheduled."}
                        </p>
                        {live ? <RecurringControls commitmentId={c.id} amountCents={c.amount_cents} formToken={randomUUID()} /> : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="history-heading">
            <SectionHeading id="history-heading">Gift history</SectionHeading>
            {!giving.payments.length ? (
              <EmptyState icon={<HandCoins className="size-6" aria-hidden="true" />} title="No gifts yet">
                Gifts you make while signed in appear here.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {giving.payments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/giving/${p.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3 hover:bg-surface-muted">
                      <span>
                        <span className="block font-semibold">
                          {formatCents(p.amount_cents)} · {p.fund_name}
                        </span>
                        <span className="block text-meta text-text-secondary">
                          {formatDate(p.date, settings.timezone)} · {p.source === "stripe" ? (p.frequency && p.frequency !== "one_time" ? FREQUENCY_LABEL[p.frequency] : "Online") : p.source === "cash" ? "Cash" : "Check"}
                          {p.refunded_cents > 0 ? ` · ${formatCents(p.refunded_cents)} refunded` : ""}
                        </span>
                      </span>
                      <StatusBadge status={p.status} refunded={p.refunded_cents} amount={p.amount_cents} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="statements-heading">
            <SectionHeading id="statements-heading">Annual statements</SectionHeading>
            {!giving.statement_ready ? (
              <Card>
                <p className="text-text-secondary">
                  Annual giving statements will be available here once the church has finalized its statement details.
                </p>
              </Card>
            ) : giving.years.length ? (
              <ul className="flex flex-wrap gap-2">
                {giving.years.map((y) => (
                  <li key={y}>
                    <a href={`/giving/statement/${y}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong bg-surface px-4 font-semibold hover:bg-surface-muted">
                      <FileText className="size-4" aria-hidden="true" /> {y} statement (PDF)
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Card>
                <p className="text-text-secondary">Statements appear once you have received gifts in a year.</p>
              </Card>
            )}
          </section>

          <section aria-labelledby="claim-heading">
            <SectionHeading id="claim-heading">Add a gift you made as a guest</SectionHeading>
            <Card>
              <p className="mb-4 text-meta text-text-secondary">
                If you gave without signing in using {viewer.email}, enter the gift reference from that gift&apos;s acknowledgment
                email. Gifts are never added just because an email address matches.
              </p>
              <ClaimForm />
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
