import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { kindLabel } from "@/lib/bible/format";
import type { ImportRow, RowIssue } from "@/lib/bible/plan-import";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { importDiscardAction } from "../../../../actions";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Import preview" };

type Preview = { id: string; plan_id: string; status: string; file_name: string; rows: ImportRow[]; errors: RowIssue[]; warnings: RowIssue[]; expired: boolean; existing_days: number };

export default async function ImportPreviewPage({ params }: PageProps<"/admin/bible/plans/[id]/import/[importId]">) {
  const { id, importId } = await params;
  if (!isUuid(id) || !isUuid(importId)) notFound();
  await requireCapability(CAPABILITIES.readingEdit, `/admin/bible/plans/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_plan_import", { p_id: importId });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This preview couldn't be loaded right now." />;
  const pv = data as Preview;
  if (pv.plan_id !== id) notFound();
  const blocked = pv.errors.length > 0 || pv.status !== "previewed" || pv.expired;

  return (
    <>
      <p className="mb-4">
        <Link href={`/admin/bible/plans/${id}`} className="font-semibold text-primary hover:underline">
          Back to the plan
        </Link>
      </p>
      <PageHeader title="Import preview" description={`${pv.file_name}: ${pv.rows.length} days ready${pv.errors.length ? `, ${pv.errors.length} problems` : ""}. Nothing has changed yet.`} />

      {pv.status !== "previewed" ? <Alert tone="info" title={`This preview was ${pv.status}.`} className="mb-4" /> : null}
      {pv.expired ? <Alert tone="warning" title="This preview has expired. Upload the file again." className="mb-4" /> : null}

      {pv.errors.length ? (
        <section className="mb-6" aria-labelledby="errors">
          <Alert tone="error" title="Fix these problems in the file and upload it again. Nothing is imported until every row is valid." />
          <SectionHeading id="errors">Problems</SectionHeading>
          <ul className="space-y-1 text-meta">
            {pv.errors.map((e, i) => (
              <li key={i} className="rounded-tile border border-danger/40 bg-danger-soft px-3 py-2">
                {e.row ? <span className="font-semibold">Row {e.row}: </span> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pv.warnings.length ? (
        <section className="mb-6" aria-labelledby="warnings">
          <SectionHeading id="warnings">Check these</SectionHeading>
          <ul className="space-y-1 text-meta">
            {pv.warnings.map((w, i) => (
              <li key={i} className="rounded-tile border border-primary/40 bg-primary-soft px-3 py-2">
                {w.row ? <span className="font-semibold">Row {w.row}: </span> : null}
                {w.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-6" aria-labelledby="rows">
        <SectionHeading id="rows">Days in the file</SectionHeading>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left text-meta">
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Row</th>
                <th scope="col" className="px-3 py-2">Day</th>
                <th scope="col" className="px-3 py-2">Type</th>
                <th scope="col" className="px-3 py-2">Passages</th>
                <th scope="col" className="px-3 py-2">Heading</th>
                <th scope="col" className="px-3 py-2">Questions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pv.rows.slice(0, 500).map((r) => (
                <tr key={r.row}>
                  <td className="px-3 py-2 tabular-nums">{r.row}</td>
                  <td className="px-3 py-2">{r.day_date ?? `Day ${r.day_number}`}</td>
                  <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2">{r.labels.join("; ") || "—"}</td>
                  <td className="px-3 py-2">{r.heading ?? ""}</td>
                  <td className="px-3 py-2">{r.questions.length || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pv.rows.length > 500 ? <p className="mt-2 text-meta text-text-secondary">Showing the first 500 of {pv.rows.length} days.</p> : null}
      </section>

      {!blocked ? (
        <Card>
          <ApplyForm planId={id} importId={pv.id} existingDays={pv.existing_days} count={pv.rows.length} />
        </Card>
      ) : null}
      <form action={importDiscardAction} className="mt-4">
        <input type="hidden" name="plan_id" value={id} />
        <input type="hidden" name="import_id" value={pv.id} />
        <button type="submit" className="min-h-11 font-semibold text-primary hover:underline">
          Discard this preview
        </button>
      </form>
    </>
  );
}
