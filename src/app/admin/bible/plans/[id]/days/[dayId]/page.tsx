import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { deleteDayAction } from "../../../../actions";
import { DayForm, type AdminDay, type DayOptions } from "../../../../day-form";
import { RetireForm } from "./retire-form";

export const metadata: Metadata = { title: "Reading plan day" };

type Impact = {
  plan_status: "draft" | "published" | "archived";
  is_past: boolean;
  revision: number;
  active_enrollments: number;
  completions: number;
  upcoming_readers: number;
  revisions: Array<{ revision: number; snapshot: { passages: Array<{ label: string }>; kind: string }; reason: string | null; changed_at: string }>;
};

export default async function AdminDayPage({ params }: PageProps<"/admin/bible/plans/[id]/days/[dayId]">) {
  const { id, dayId } = await params;
  if (!isUuid(id) || !isUuid(dayId)) notFound();
  const viewer = await requireAnyCapability([CAPABILITIES.readingEdit, CAPABILITIES.readingPublish], `/admin/bible/plans/${id}`);
  const supabase = await requireClient();
  const [plan, opts, impact] = await Promise.all([
    supabase.rpc("bible_admin_plan", { p_id: id }),
    supabase.rpc("bible_admin_plan_options"),
    supabase.rpc("bible_admin_day_impact", { p_day: dayId }),
  ]);
  if (plan.error?.code === "P0002" || impact.error?.code === "P0002") notFound();
  if (plan.error || !plan.data || !opts.data || impact.error) return <Alert tone="error" title="This day couldn't be loaded right now." />;
  const p = plan.data as { id: string; title: string; mode: "calendar" | "personal"; status: "draft" | "published" | "archived"; audience: "members" | "group"; group_id: string | null; day_list: AdminDay[] };
  const day = p.day_list.find((d) => d.id === dayId);
  if (!day) notFound();
  const im = impact.data as Impact;
  const draft = p.status === "draft";
  const canEdit = viewer.capabilities.has(CAPABILITIES.readingEdit);
  const canPublish = viewer.capabilities.has(CAPABILITIES.readingPublish);
  const label = day.day_date ?? `Day ${day.day_number}`;

  return (
    <>
      <p className="mb-4">
        <Link href={`/admin/bible/plans/${p.id}`} className="font-semibold text-primary hover:underline">
          {p.title}
        </Link>
      </p>
      <PageHeader title={label} description={day.retired_at ? "Retired: no longer shown in the schedule." : draft ? "Draft: edit freely." : `Revision ${day.revision}`} />

      {!draft ? (
        <Card className="mb-6">
          <SectionHeading as="h2">Impact of changing this day</SectionHeading>
          <ul className="space-y-1 text-meta">
            <li>{im.is_past ? "This date has passed. Changing it is a correction and needs explicit confirmation." : "This day is still ahead (or today) for the plan."}</li>
            <li>
              {im.completions} {im.completions === 1 ? "member has" : "members have"} marked it read; they keep their completion on the version they read.
            </li>
            <li>
              {im.upcoming_readers} of {im.active_enrollments} current readers haven&apos;t reached it yet; they&apos;ll get one in-app notice if the passages or date change.
            </li>
            <li>Members&apos; journal entries about this day stay linked to the version they wrote about (they aren&apos;t counted or shown here).</li>
          </ul>
          {im.revisions.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-meta font-semibold">Earlier revisions ({im.revisions.length})</summary>
              <ol className="mt-2 space-y-1 text-meta text-text-secondary">
                {im.revisions.map((r) => (
                  <li key={r.revision}>
                    Revision {r.revision}: {r.snapshot.passages.map((x) => x.label).join("; ") || r.snapshot.kind}
                    {r.reason ? ` (changed because: ${r.reason})` : ""}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </Card>
      ) : null}

      {day.retired_at ? null : draft && canEdit ? (
        <Card className="mb-6">
          <DayForm plan={p} day={day} options={opts.data as DayOptions} variant="draft" />
        </Card>
      ) : !draft && canPublish && p.status === "published" ? (
        <>
          <Card className="mb-6">
            <SectionHeading as="h2">Revise</SectionHeading>
            <DayForm plan={p} day={day} options={opts.data as DayOptions} variant="revise" isPast={im.is_past} />
          </Card>
          <Card className="mb-6">
            <SectionHeading as="h2" description="Removes the day from the schedule. Completions and notes are kept.">
              Retire this day
            </SectionHeading>
            <RetireForm planId={p.id} dayId={day.id} isPast={im.is_past} />
          </Card>
        </>
      ) : (
        <Alert tone="info" title={draft ? "Plan editors change draft days." : "Reading plan publishers change published days."} />
      )}

      {draft && canEdit ? (
        <ConfirmDialog trigger="Delete day" title="Delete this day?" confirmLabel="Delete day" formAction={deleteDayAction} hidden={{ plan_id: p.id, day_id: day.id }}>
          The day is removed from the draft.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
