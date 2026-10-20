import type { Metadata } from "next";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { addDays, todayIn } from "@/lib/giving/finance";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { FinanceNav, TestModeNotice } from "../finance-nav";
import { ReconcileForm, RetryEmailButton } from "../finance-forms";

export const metadata: Metadata = { title: "Reconcile and email" };

type Email = { id: string; kind: string; status: string; attempts: number; last_error: string | null; created_at: string; to: string };
type Event = { id: string; type: string; status: string; attempts: number; received_at: string; last_error: string | null };

export default async function OperationsPage() {
  const viewer = await requireCapability(CAPABILITIES.financeManage, "/admin/finance/operations");
  const [{ settings }, supabase] = await Promise.all([getChurchSettings(), requireClient()]);
  const [{ data: emails }, { data: events }] = await Promise.all([supabase.rpc("finance_emails", { p_status: null }), supabase.rpc("finance_events", { p_status: null })]);
  const today = todayIn(settings.timezone);
  const tz = settings.timezone;
  const problemEmails = ((emails as Email[] | null) ?? []).filter((e) => e.status !== "sent").slice(0, 50);
  const recentEvents = ((events as Event[] | null) ?? []).slice(0, 30);

  return (
    <>
      <PageHeader eyebrow="Giving" title="Reconcile and email" description="Repair missed webhooks by re-reading Stripe, and retry emails that didn't send." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/operations" capabilities={viewer.capabilities} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading>Reconcile with Stripe</SectionHeading>
          <p className="mb-4 text-meta text-text-secondary">
            Reads every checkout, recurring invoice, refund, and dispute Stripe created in the range, plus any gifts still waiting for fee data,
            and records anything missing. Safe to run repeatedly: nothing is duplicated and existing records are only updated.
          </p>
          <ReconcileForm from={addDays(today, -7)} to={today} />
        </Card>
        <Card>
          <SectionHeading>Emails needing attention</SectionHeading>
          {!problemEmails.length ? <p className="text-text-secondary">All giving emails have been sent.</p> : (
            <ul className="divide-y divide-border text-meta">
              {problemEmails.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{e.kind.replace("_", " ")} · {e.status} · {e.attempts} attempt(s){e.last_error ? ` · ${e.last_error}` : ""}<span className="block text-text-secondary">{e.to} · {formatDateTime(e.created_at, tz)}</span></span>
                  {e.status === "failed" || e.status === "suppressed" ? <RetryEmailButton emailId={e.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <SectionHeading>Recent webhook events</SectionHeading>
        {!recentEvents.length ? <p className="text-text-secondary">No events received yet.</p> : (
          <ul className="divide-y divide-border text-meta">
            {recentEvents.map((e) => (
              <li key={e.id} className="py-2">
                <span className="font-semibold">{e.type}</span> · {e.status} · {e.attempts} attempt(s) · {formatDateTime(e.received_at, tz)}
                {e.last_error ? <span className="block text-danger">{e.last_error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
