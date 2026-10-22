import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressSummary } from "@/components/bible/progress";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { formatYmd } from "@/lib/bible/dates";
import type { DaySummary, Enrollment, PlanCard, Progress } from "@/lib/bible/types";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Catch up" };

export default async function CatchUpPage({ params }: PageProps<"/bible/plans/[id]/catch-up">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireLearner(`/bible/plans/${id}/catch-up`);
  const supabase = await requireClient();
  const plan = await supabase.rpc("bible_plan", { p_id: id });
  if (plan.error?.code === "P0002") notFound();
  const enrollment = (plan.data as { enrollment: Enrollment | null } | null)?.enrollment;
  if (!enrollment || enrollment.status !== "active") notFound();
  const { data, error } = await supabase.rpc("bible_catch_up", { p_enrollment: enrollment.id });
  const c = data as { plan: PlanCard; progress: Progress; days: DaySummary[] } | null;

  return (
    <>
      <BackLink route="/bible/plans/[id]/catch-up" params={{ id }} />
      <PageHeader title="Catch up" description="Earlier readings you haven't marked yet. Read them in any order, whenever it suits you." />
      {error || !c ? (
        <Alert tone="error" title="Catch-up couldn't be loaded right now." />
      ) : (
        <>
          <div className="mb-6">
            <ProgressSummary progress={c.progress} compact />
          </div>
          {c.days.length ? (
            <ol className={rowListClass}>
              {c.days.map((d) => (
                <li key={d.id}>
                  <Link href={`/bible/day/${d.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-muted/60">
                    <span className="min-w-0 flex-1">
                      <span className="block text-meta text-text-secondary">
                        {d.label}
                        {c.plan.mode === "personal" ? ` · ${formatYmd(d.scheduled, "short")}` : ""}
                      </span>
                      <span className="block truncate font-semibold">{d.passages.join("; ")}</span>
                    </span>
                    <ChevronRight className="size-5 text-text-secondary" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState glyph="bible" title="You're all caught up">
              Nothing earlier is waiting.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
