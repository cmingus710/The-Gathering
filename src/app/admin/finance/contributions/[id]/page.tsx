import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { SOURCE_LABEL, STATUS_LABEL, todayIn, type FinanceDetail, type FinanceFund } from "@/lib/giving/finance";
import { formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { FinanceNav } from "../../finance-nav";
import { AssociateDonorForm, CorrectManualForm, RefundForm, RetryEmailButton, ReverseForm } from "../../finance-forms";

export const metadata: Metadata = { title: "Contribution" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-text-secondary">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export default async function ContributionDetail({ params, searchParams }: PageProps<"/admin/finance/contributions/[id]">) {
  const { id } = await params;
  const viewer = await requireCapability(CAPABILITIES.financeView, `/admin/finance/contributions/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ settings }, sp, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const { data } = await supabase.rpc("finance_contribution", { p_id: id });
  const p = data as FinanceDetail | null;
  if (!p) notFound();
  const tz = settings.timezone;
  const can = (c: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]) => viewer.capabilities.has(c);
  const manual = p.source !== "stripe";
  const q = typeof sp.donor === "string" ? sp.donor.slice(0, 80) : "";
  const candidates = q && can(CAPABILITIES.financeRecord) ? (((await supabase.rpc("finance_donor_search", { p_query: q })).data as Array<{ id: string; name: string; email: string }> | null) ?? []) : [];
  const remaining = p.amount_cents - p.refunded_cents - p.refunds.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount_cents, 0);
  const { data: funds } = manual && can(CAPABILITIES.financeRecord) ? await supabase.rpc("finance_funds") : { data: [] };
  const signedInGift = p.source === "stripe" && p.profile_id && !p.claimed_at;

  return (
    <>
      <Link href="/admin/finance/contributions" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Contributions
      </Link>
      <PageHeader eyebrow={manual ? "Manual entry" : "Stripe payment"} title={`${formatCents(p.amount_cents)} · ${p.fund_name}`} description={`${p.donor} · ${formatDate(p.date, tz)}`} />
      <FinanceNav current="/admin/finance/contributions" capabilities={viewer.capabilities} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading>Details</SectionHeading>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label="Status">
              <Badge tone={p.status === "succeeded" ? "success" : p.status === "pending" ? "warning" : "neutral"}>{STATUS_LABEL[p.status]}</Badge>
            </Row>
            <Row label="Method">{SOURCE_LABEL[p.source]}{p.frequency && p.frequency !== "one_time" ? ` (${p.frequency})` : ""}</Row>
            <Row label="Donor">{p.donor}{p.donor_email ? <span className="block text-sm text-text-secondary">{p.donor_email}</span> : null}</Row>
            <Row label={manual ? "Date received" : "Date"}>{manual && p.received_on ? p.received_on : formatDateTime(p.date, tz)}</Row>
            {p.source === "stripe" ? (
              <>
                <Row label="Processing fee">{p.fee_status === "known" && p.fee_cents != null ? formatCents(p.fee_cents) : p.fee_status === "unavailable" ? "Unavailable" : p.status === "succeeded" ? "Pending" : "—"}</Row>
                <Row label="Net (before refunds)">{p.net_cents != null ? formatCents(p.net_cents) : "—"}</Row>
              </>
            ) : null}
            {p.check_reference ? <Row label="Check reference">{p.check_reference}</Row> : null}
            {p.internal_note ? <Row label="Internal note">{p.internal_note}</Row> : null}
            {p.failure_code ? <Row label="Failure">{p.failure_code}</Row> : null}
            {p.reversed_at ? <Row label="Reversed">{formatDateTime(p.reversed_at, tz)}: {p.reversal_reason}</Row> : null}
            {p.replaces_payment_id ? <Row label="Corrects"><Link className="text-primary underline" href={`/admin/finance/contributions/${p.replaces_payment_id}`}>Original entry</Link></Row> : null}
            {p.replaced_by ? <Row label="Corrected by"><Link className="text-primary underline" href={`/admin/finance/contributions/${p.replaced_by}`}>Correction</Link></Row> : null}
            {p.claimed_at ? <Row label="Claimed by donor">{formatDateTime(p.claimed_at, tz)} (verified reference)</Row> : null}
            {p.stripe_payment_intent_id ? <Row label="Stripe payment">{p.stripe_payment_intent_id}</Row> : null}
            {p.stripe_invoice_id ? <Row label="Stripe invoice">{p.stripe_invoice_id}</Row> : null}
          </dl>
          {p.commitment ? (
            <p className="mt-4 text-meta text-text-secondary">
              Part of a {p.commitment.frequency} recurring gift ({formatCents(p.commitment.amount_cents)} now, {p.commitment.status}).
            </p>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeading>Refunds and disputes</SectionHeading>
            {!p.refunds.length && !p.disputes.length ? <p className="text-text-secondary">None.</p> : null}
            <ul className="space-y-1">
              {p.refunds.map((r) => (
                <li key={r.id}>Refund {formatCents(r.amount_cents)} · {r.status} · {formatDate(r.date, tz)}</li>
              ))}
              {p.disputes.map((d) => (
                <li key={d.id}>Dispute {formatCents(d.amount_cents)} · {d.status}{d.reason ? ` (${d.reason})` : ""}</li>
              ))}
            </ul>
            {p.source === "stripe" && p.status === "succeeded" && remaining > 0 && can(CAPABILITIES.financeRefund) ? (
              <div className="mt-4 border-t border-border pt-4">
                <RefundForm paymentId={p.id} remainingCents={remaining} formToken={randomUUID()} />
              </div>
            ) : null}
          </Card>

          {can(CAPABILITIES.financeRecord) && !signedInGift ? (
            <Card>
              <SectionHeading>Donor account</SectionHeading>
              <p className="mb-3 text-meta text-text-secondary">
                {p.profile_id ? "Linked to a member account; it appears in their giving history." : "Not linked to an account. Link it only when you're sure who gave it."}
              </p>
              <form action={`/admin/finance/contributions/${p.id}`} className="mb-3 flex gap-2">
                <label htmlFor="donor-search" className="sr-only">Search members</label>
                <input id="donor-search" name="donor" defaultValue={q} placeholder="Search members by name or email" className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                <button type="submit" className="min-h-11 rounded-full border border-border bg-surface-muted px-4 font-semibold">Search</button>
              </form>
              <AssociateDonorForm paymentId={p.id} candidates={candidates} linked={!!p.profile_id} />
            </Card>
          ) : null}
        </div>
      </div>

      {manual && p.status === "succeeded" && can(CAPABILITIES.financeRecord) ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeading>Correct this entry</SectionHeading>
            <p className="mb-3 text-meta text-text-secondary">The original stays in history as reversed and links to the correction.</p>
            <CorrectManualForm
              paymentId={p.id}
              funds={(funds as FinanceFund[] | null) ?? []}
              donor={p.profile_id ? { id: p.profile_id, name: p.donor, email: p.donor_email ?? "" } : null}
              defaults={{ donorName: p.profile_id ? "" : p.donor === "Unidentified donor" ? "" : p.donor, receivedOn: p.received_on ?? todayIn(tz), amount: (p.amount_cents / 100).toFixed(2), fundId: p.fund_id, method: p.source as "cash" | "check", checkReference: p.check_reference ?? "", note: p.internal_note ?? "" }}
              today={todayIn(tz)}
              formToken={randomUUID()}
            />
          </Card>
          <Card>
            <SectionHeading>Reverse this entry</SectionHeading>
            <ReverseForm paymentId={p.id} />
          </Card>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading>Emails</SectionHeading>
          {!p.emails.length ? <p className="text-text-secondary">None.</p> : (
            <ul className="divide-y divide-border">
              {p.emails.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{e.kind.replace("_", " ")} · {e.status}{e.sent_at ? ` · ${formatDateTime(e.sent_at, tz)}` : ""}{e.last_error ? ` · ${e.last_error}` : ""}</span>
                  {can(CAPABILITIES.financeManage) && (e.status === "failed" || e.status === "suppressed") ? <RetryEmailButton emailId={e.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionHeading>History</SectionHeading>
          {!p.history.length ? <p className="text-text-secondary">No finance actions recorded.</p> : (
            <ul className="space-y-1 text-meta">
              {p.history.map((h, i) => (
                <li key={i}>{formatDateTime(h.at, tz)} · {h.action.replace("finance.", "").replace(/_/g, " ")} · {h.actor ?? "system"}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {p.status === "pending" ? <Alert tone="info" className="mt-6" title="Awaiting confirmation from Stripe. This gift is not counted as received yet." live={false} /> : null}
    </>
  );
}
