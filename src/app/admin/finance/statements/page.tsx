import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { todayIn } from "@/lib/giving/finance";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { FinanceNav, TestModeNotice } from "../finance-nav";

export const metadata: Metadata = { title: "Giving statements" };
type Donor = { id: string; name: string; email: string };

export default async function StatementsPage({ searchParams }: PageProps<"/admin/finance/statements">) {
  const viewer = await requireCapability(CAPABILITIES.financeView, "/admin/finance/statements");
  const [{ settings }, params, supabase] = await Promise.all([getChurchSettings(), searchParams, requireClient()]);
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const thisYear = Number(todayIn(settings.timezone).slice(0, 4));
  const year = typeof params.year === "string" && /^\d{4}$/.test(params.year) ? Number(params.year) : thisYear - 1;
  const [{ data: results }, { data: s }] = await Promise.all([
    q ? supabase.rpc("finance_donor_search", { p_query: q }) : Promise.resolve({ data: [] }),
    supabase.rpc("finance_settings"),
  ]);
  const approved = (s as { statement_approved?: boolean } | null)?.statement_approved;

  return (
    <>
      <PageHeader eyebrow="Giving" title="Annual statements" description="Generate a statement for one donor and year. Statements are never emailed in bulk." />
      <TestModeNotice />
      <FinanceNav current="/admin/finance/statements" capabilities={viewer.capabilities} />
      {!approved ? (
        <Alert tone="warning" title="Statements are in draft." className="mb-6">
          They are watermarked DRAFT and hidden from members until the organization details and wording are entered and approved in Settings.
        </Alert>
      ) : null}
      <Card>
        <SectionHeading>Find a donor</SectionHeading>
        <form action="/admin/finance/statements" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="grow">
            <label htmlFor="st-q" className="block text-sm font-semibold">Member name or email</label>
            <input id="st-q" name="q" defaultValue={q} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
          </div>
          <div>
            <label htmlFor="st-year" className="block text-sm font-semibold">Year</label>
            <input id="st-year" name="year" inputMode="numeric" defaultValue={year} className="min-h-11 w-24 rounded-control border border-border-strong bg-surface px-3" />
          </div>
          <button type="submit" className="min-h-11 rounded-full border border-border bg-surface-muted px-4 font-semibold">Search</button>
        </form>
        <ul className="divide-y divide-border">
          {((results as Donor[] | null) ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span><span className="font-semibold">{d.name}</span> <span className="text-text-secondary">{d.email}</span></span>
              <a href={`/admin/finance/statements/${d.id}/${year}`} className="font-semibold text-primary underline">
                {year} statement (PDF{approved ? "" : ", draft"})
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-text-secondary">Only gifts linked to a member account appear on their statement. Unlinked guest and unidentified gifts are excluded.</p>
      </Card>
    </>
  );
}
