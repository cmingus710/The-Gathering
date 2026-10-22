import { ChevronRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_COPY } from "@/components/media/workbook-view";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/media/format";
import type { WorkbookSummary } from "@/lib/media/workbook";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My workbooks" };

/** Lessons the member has written in, most recent first (their own data only). */
export default async function MyWorkbooksPage({ searchParams }: PageProps<"/lessons/workbooks">) {
  await requireApprovedMember("/lessons/workbooks");
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_workbooks");
  const items = (data as WorkbookSummary[] | null) ?? [];

  return (
    <>
      <BackLink route="/lessons/workbooks" />
      <PageHeader title="My workbooks" description="Lessons you've written answers or notes for." />
      <p className="mb-6 flex items-center gap-1.5 text-meta font-semibold">
        <Lock className="size-4 text-primary" aria-hidden="true" />
        {PRIVACY_COPY}
      </p>
      {sp.deleted ? <Alert tone="success" title="Your answers and notes for that lesson were deleted." className="mb-6" /> : null}
      {error ? <Alert tone="error" title="Your workbooks couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !items.length ? (
        <EmptyState title="No workbooks yet">Open a Sunday lesson and choose Open workbook to write private answers and notes.</EmptyState>
      ) : null}
      {items.length ? (
        <ul className={rowListClass}>
          {items.map((w) => (
            <li key={w.item_id}>
              <Link href={`/lessons/${w.item_id}/workbook`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{w.available ? w.title : "A lesson that is no longer available"}</span>
                  <span className="block text-meta text-text-secondary">
                    {[
                      w.delivered_on ? formatDay(w.delivered_on, "long") : null,
                      `${w.answers} answer${w.answers === 1 ? "" : "s"}`,
                      w.has_note ? "notes" : null,
                      `last written ${formatDay(w.updated_at.slice(0, 10), "short")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronRight className="size-5 text-text-secondary" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
