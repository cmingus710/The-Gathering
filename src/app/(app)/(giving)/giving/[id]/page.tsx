import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { requireSignedIn } from "@/lib/auth/viewer";
import { FREQUENCY_LABEL, formatCents } from "@/lib/giving/money";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { GiftStatusBadge as StatusBadge } from "@/components/giving/gift-status-badge";
import type { MyPayment } from "../types";

export const metadata: Metadata = { title: "Gift acknowledgment" };

/** Printable acknowledgment for one of the member's own gifts. */
export default async function GiftPage({ params }: PageProps<"/giving/[id]">) {
  const { id } = await params;
  await requireSignedIn(`/giving/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const { data } = await supabase.rpc("my_giving_payment", { p_id: id });
  const p = data as MyPayment | null;
  if (!p) notFound();
  const method = p.source === "stripe" ? (p.frequency && p.frequency !== "one_time" ? `Online, ${FREQUENCY_LABEL[p.frequency].toLowerCase()}` : "Online") : p.source === "cash" ? "Cash" : "Check";

  return (
    <>
      <Link href="/giving" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline print:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Your giving
      </Link>
      <PageHeader title="Gift acknowledgment" description={settings.churchName} />
      <Card className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold text-text-secondary">Amount</dt>
            <dd className="text-xl font-bold">{formatCents(p.amount_cents)}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-text-secondary">Status</dt>
            <dd className="mt-1">
              <StatusBadge status={p.status} refunded={p.refunded_cents} amount={p.amount_cents} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-text-secondary">Fund</dt>
            <dd>{p.fund_name}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-text-secondary">Date</dt>
            <dd>{formatDate(p.date, settings.timezone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-text-secondary">Method</dt>
            <dd>{method}</dd>
          </div>
        </dl>
        {p.refunds.length ? (
          <div>
            <h2 className="font-semibold">Refunds</h2>
            <ul className="mt-1 text-meta">
              {p.refunds.map((r) => (
                <li key={r.id}>
                  {formatCents(r.amount_cents)} · {formatDate(r.date, settings.timezone)} · {r.status === "succeeded" ? "Refunded" : r.status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {p.status === "succeeded" && p.acknowledgment_message ? <p className="border-t border-border pt-4">{p.acknowledgment_message}</p> : null}
        <p className="text-sm text-text-secondary">This page acknowledges a gift you made. It is not an annual giving statement.</p>
      </Card>
    </>
  );
}
