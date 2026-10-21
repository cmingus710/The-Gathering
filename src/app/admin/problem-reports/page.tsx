import { LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { categoryLabel } from "@/lib/feedback/report";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { ProblemReportStatusForm } from "./status-form";

export const metadata: Metadata = { title: "Problem reports" };

type Report = {
  id: string;
  category: string;
  description: string;
  page_path: string | null;
  contact_ok: boolean;
  status: "new" | "resolved";
  created_at: string;
  resolved_at: string | null;
  reporter_name: string;
  reporter_email: string | null;
};

const FILTERS = [
  { key: "new", label: "Open" },
  { key: "resolved", label: "Resolved" },
] as const;

export default async function ProblemReportsPage({ searchParams }: PageProps<"/admin/problem-reports">) {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/problem-reports");
  const sp = await searchParams;
  const status = sp.status === "resolved" ? "resolved" : "new";
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const { data: rows, error } = await supabase.rpc("admin_problem_reports", { p_status: status, p_limit: 100 });
  const data = rows as Report[] | null;

  return (
    <>
      <PageHeader
        title="Problem reports"
        description="Sent by members from “Report a problem”. Only super administrators see these; they're never shown to the community. The reporter's email appears only when they agreed to be contacted."
      />
      <div className="mb-4">
        <SegmentedTrack label="Status">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "new" ? "/admin/problem-reports" : "/admin/problem-reports?status=resolved"}
              className={segmentClass(status === f.key)}
              aria-current={status === f.key ? "page" : undefined}
            >
              {f.label}
            </Link>
          ))}
        </SegmentedTrack>
      </div>
      {error ? (
        <Alert tone="error" title="Problem reports couldn't be loaded." />
      ) : !data?.length ? (
        <EmptyState icon={<LifeBuoy className="size-5" aria-hidden="true" />} title={status === "new" ? "No open reports" : "No resolved reports"} />
      ) : (
        <ol className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="rounded-card border border-border bg-surface px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {categoryLabel(r.category)}
                    {r.status === "resolved" ? <Badge tone="success">Resolved</Badge> : null}
                  </p>
                  <p className="text-meta text-text-secondary">
                    {r.reporter_name}
                    {r.reporter_email ? (
                      <>
                        {" · "}
                        <a className="underline [overflow-wrap:anywhere]" href={`mailto:${r.reporter_email}`}>
                          {r.reporter_email}
                        </a>
                      </>
                    ) : (
                      " · prefers not to be contacted"
                    )}
                    {" · "}
                    <time dateTime={r.created_at}>{formatDateTime(r.created_at, settings.timezone)}</time>
                  </p>
                  {r.page_path ? <p className="font-mono text-[0.8125rem] text-text-secondary [overflow-wrap:anywhere]">{r.page_path}</p> : null}
                </div>
                <ProblemReportStatusForm id={r.id} resolved={r.status === "resolved"} />
              </div>
              <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.description}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
