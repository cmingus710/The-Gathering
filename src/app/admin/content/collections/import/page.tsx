import type { Metadata } from "next";
import Link from "next/link";
import { ImportReportView } from "@/components/devotionals/import-report";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { MORNING_EVENING } from "@/lib/devotionals/morning-evening";
import { prepareMorningEvening } from "@/lib/devotionals/source";
import type { CollectionAdmin } from "@/lib/devotionals/types";
import { requireClient } from "@/lib/supabase/server";
import { ImportForm } from "../forms";

export const metadata: Metadata = { title: "Import Morning & Evening" };

/**
 * The dry run (computed on every visit from the pinned file; nothing is
 * written) and the import button. Content publishers only.
 */
export default async function ImportPage() {
  await requireCapability(CAPABILITIES.contentPublish, "/admin/content/collections/import");
  const supabase = await requireClient();
  const [prepared, existing] = await Promise.all([prepareMorningEvening(), supabase.rpc("media_admin_collections")]);
  const current = ((existing.data as CollectionAdmin[] | null) ?? []).find((c) => c.key === MORNING_EVENING.key) ?? null;
  const s = MORNING_EVENING.source;

  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href="/admin/content/collections" className="hover:underline">
            Devotional collections
          </Link>
        }
        title="Import Morning & Evening"
        description="Charles Spurgeon's daily devotional, from a data file pinned to one commit. This page is the dry run: nothing is written until you import."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <Card>
          <SectionHeading>Dry run</SectionHeading>
          {prepared.ok ? <ImportReportView report={prepared.report} /> : <Alert tone="error" title={prepared.message} />}
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionHeading>Import</SectionHeading>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-meta">
              <li>Readings go into an unpublished, hidden collection for review. Members see nothing until it is published.</li>
              <li>All or nothing: if any reading is refused, nothing is imported and the reason is recorded.</li>
              <li>Running it again adds nothing twice and never overwrites a correction; differences are reported as conflicts.</li>
              <li>No email, push, or in-app notices are sent.</li>
            </ul>
            {current ? (
              <p className="mb-4 text-meta">
                <Link href={`/admin/content/collections/${current.id}`} className="font-semibold text-primary hover:underline">
                  {current.title}
                </Link>{" "}
                already has {current.readings.toLocaleString("en-US")} readings ({current.edited} corrected).
              </p>
            ) : null}
            <ImportForm disabled={!prepared.ok || !prepared.report.ok} rerun={!!current} />
          </Card>
          <Card>
            <SectionHeading>Provenance</SectionHeading>
            <dl className="space-y-2 text-meta [overflow-wrap:anywhere]">
              <div>
                <dt className="font-semibold text-text-secondary">Text</dt>
                <dd>
                  {MORNING_EVENING.text.statement}{" "}
                  <a href={MORNING_EVENING.text.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                    CCEL edition<span className="sr-only"> (opens a new tab)</span>
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Data file</dt>
                <dd>
                  <a href={`${s.repository}/blob/${s.commit}/${s.path}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                    {s.repository.replace("https://github.com/", "")}/{s.path}<span className="sr-only"> (opens a new tab)</span>
                  </a>{" "}
                  at commit {s.commit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Licence</dt>
                <dd>{s.licenseNotice}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Upstream</dt>
                <dd>{MORNING_EVENING.text.upstreamNote}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
