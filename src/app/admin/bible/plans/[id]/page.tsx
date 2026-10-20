import { ChevronRight, Download, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allTimeZones } from "@/app/admin/events/series";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatYmd } from "@/lib/bible/dates";
import { kindLabel, scheduleLabel } from "@/lib/bible/format";
import { signBiblePaths } from "@/lib/bible/storage";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { deletePlanAction } from "../../actions";
import { DayForm, type AdminDay, type DayOptions } from "../../day-form";
import { CoverForm, DuplicateForm, ImportForm, StatusControls } from "../../plan-controls";
import { PlanForm, type PlanOptions } from "../../plan-form";

export const metadata: Metadata = { title: "Reading plan" };

type Plan = {
  id: string;
  title: string;
  description: string;
  cover_path: string | null;
  cover_alt: string | null;
  translation_id: string;
  translation: { code: string; name: string; status: string };
  audience: "members" | "group";
  group_id: string | null;
  group_name: string | null;
  audience_note: string | null;
  mode: "calendar" | "personal";
  timezone: string;
  status: "draft" | "published" | "archived";
  featured: boolean;
  version: number;
  previous_plan_id: string | null;
  previous_title: string | null;
  days: number;
  reading_days: number;
  first_date: string | null;
  last_date: string | null;
  last_day_number: number | null;
  enrollments: number;
  today: string;
  day_list: AdminDay[];
  changes: Array<{ id: number; action: string; reason: string | null; created_at: string; actor: string | null; details: Record<string, unknown> }>;
  imports: Array<{ id: string; status: string; file_name: string | null; rows: number; errors: number; created_at: string }>;
};

const NOTICES: Record<string, string> = { imported: "The import was applied.", retired: "The day was retired. Members' history for it is kept." };

export default async function AdminPlanPage({ params, searchParams }: PageProps<"/admin/bible/plans/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireAnyCapability([CAPABILITIES.readingEdit, CAPABILITIES.readingPublish], `/admin/bible/plans/${id}`);
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ data, error }, opts] = await Promise.all([supabase.rpc("bible_admin_plan", { p_id: id }), supabase.rpc("bible_admin_plan_options")]);
  if (error?.code === "P0002") notFound();
  if (error || !data || !opts.data) return <Alert tone="error" title="This plan couldn't be loaded right now." />;
  const plan = data as Plan;
  const options = opts.data as PlanOptions & DayOptions;
  const covers = await signBiblePaths(supabase, [plan.cover_path]);
  const canEdit = viewer.capabilities.has(CAPABILITIES.readingEdit);
  const canPublish = viewer.capabilities.has(CAPABILITIES.readingPublish);
  const draft = plan.status === "draft";
  const current = plan.day_list.filter((d) => !d.retired_at);
  const retired = plan.day_list.filter((d) => d.retired_at);
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;

  return (
    <>
      <p className="mb-4">
        <Link href="/admin/bible" className="font-semibold text-primary hover:underline">
          Reading plans
        </Link>
      </p>
      <PageHeader
        title={plan.title}
        description={`${scheduleLabel(plan)} · ${plan.translation.code} · ${plan.group_name ? `Group: ${plan.group_name}` : "All members"} · version ${plan.version}`}
        actions={
          <ButtonLink href={`/admin/bible/plans/${plan.id}/preview`} variant="secondary" size="sm" icon={<Eye className="size-4" aria-hidden="true" />}>
            Preview
          </ButtonLink>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={plan.status === "published" ? "success" : "neutral"}>{plan.status === "draft" ? "Draft" : plan.status === "published" ? "Published" : "Archived"}</Badge>
        {plan.featured ? <Badge tone="warning">Featured church plan</Badge> : null}
        {plan.status !== "draft" ? <Badge tone="info">{plan.enrollments} reading now</Badge> : null}
        {plan.translation.status !== "active" ? <Badge tone="danger">Translation not active</Badge> : null}
        {plan.previous_title ? (
          <Link href={`/admin/bible/plans/${plan.previous_plan_id}`} className="text-meta font-semibold text-primary hover:underline">
            Next version of “{plan.previous_title}”
          </Link>
        ) : null}
      </div>
      {notice ? <Alert tone="success" title={notice} className="mb-4" /> : null}
      {sp.error === "delete" ? <Alert tone="error" title="Only an unused draft can be deleted. Archive a published plan instead." className="mb-4" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <section aria-labelledby="days">
            <SectionHeading id="days" description={`${plan.reading_days} reading days, ${plan.days - plan.reading_days} rest or catch-up days.${draft ? "" : " Changes are made one day at a time with a reason; earlier versions stay with members' history."}`}>
              Days
            </SectionHeading>
            {current.length ? (
              <ol className={rowListClass}>
                {current.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/bible/plans/${plan.id}/days/${d.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-muted/60">
                      <span className="w-28 shrink-0 text-meta text-text-secondary">{d.day_date ? formatYmd(d.day_date, "short") + `, ${d.day_date.slice(0, 4)}` : `Day ${d.day_number}`}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{d.kind === "rest" ? "Rest day" : d.passages.map((p) => p.label).join("; ") || kindLabel(d.kind)}</span>
                        <span className="block truncate text-meta text-text-secondary">
                          {[d.heading, d.questions.length ? `${d.questions.length} question${d.questions.length > 1 ? "s" : ""}` : null, d.revision > 1 ? `revision ${d.revision}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <ChevronRight className="size-5 text-text-secondary" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-text-secondary">No days yet. Add them one by one or import a CSV.</p>
            )}
            {retired.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-meta font-semibold">Retired days ({retired.length})</summary>
                <ul className="mt-2 space-y-1 text-meta text-text-secondary">
                  {retired.map((d) => (
                    <li key={d.id}>
                      {d.day_date ?? `Day ${d.day_number}`}: {d.passages.map((p) => p.label).join("; ") || kindLabel(d.kind)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {(draft && canEdit) || (!draft && canPublish && plan.status === "published") ? (
            <Card>
              <SectionHeading as="h2">Add a day</SectionHeading>
              <DayForm plan={plan} day={null} options={options} variant={draft ? "draft" : "add-published"} />
            </Card>
          ) : null}

          {draft && canEdit ? (
            <Card>
              <SectionHeading as="h2" description="Import many days at once from a spreadsheet saved as CSV.">
                Import from CSV
              </SectionHeading>
              <div className="mb-4 flex flex-wrap gap-2">
                <ButtonLink href={`/admin/bible/template?mode=${plan.mode}`} variant="ghost" size="sm" icon={<Download className="size-4" aria-hidden="true" />}>
                  Download the {plan.mode === "calendar" ? "dated" : "numbered-day"} template
                </ButtonLink>
              </div>
              <ImportForm planId={plan.id} />
              {plan.imports.length ? (
                <ul className="mt-4 space-y-1 text-meta text-text-secondary">
                  {plan.imports.map((i) => (
                    <li key={i.id}>
                      {i.status === "previewed" ? (
                        <Link href={`/admin/bible/plans/${plan.id}/import/${i.id}`} className="font-semibold text-primary hover:underline">
                          Preview: {i.file_name}
                        </Link>
                      ) : (
                        `${i.file_name}: ${i.status}`
                      )}{" "}
                      · {i.rows} days{i.errors ? `, ${i.errors} problems` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          <section aria-labelledby="changes">
            <SectionHeading id="changes">Change log</SectionHeading>
            {plan.changes.length ? (
              <ol className="space-y-2 text-meta">
                {plan.changes.map((c) => (
                  <li key={c.id} className="rounded-tile border border-border bg-surface px-3 py-2">
                    <span className="font-semibold">{c.action.replace(/_/g, " ")}</span>
                    <span className="text-text-secondary">
                      {" "}
                      · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.created_at))}
                      {c.actor ? ` · ${c.actor}` : ""}
                    </span>
                    {c.reason ? <span className="block text-text-secondary">{c.reason}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-meta text-text-secondary">No changes yet.</p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2">Publishing</SectionHeading>
            <StatusControls planId={plan.id} status={plan.status} featured={plan.featured} canPublish={canPublish} audience={plan.audience} />
          </Card>
          {(draft && canEdit) || (!draft && canPublish) ? (
            <Card>
              <SectionHeading as="h2">Details</SectionHeading>
              <PlanForm plan={plan} options={options} timezones={allTimeZones([plan.timezone])} />
            </Card>
          ) : null}
          {(draft && canEdit) || (!draft && canPublish) ? (
            <Card>
              <SectionHeading as="h2">Cover</SectionHeading>
              {plan.cover_path && covers.get(plan.cover_path) ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={covers.get(plan.cover_path)} alt={plan.cover_alt ?? ""} className="mb-3 aspect-[16/9] w-full rounded-tile object-cover" />
              ) : null}
              <CoverForm planId={plan.id} hasCover={!!plan.cover_path} alt={plan.cover_alt} />
            </Card>
          ) : null}
          {canEdit ? (
            <Card>
              <SectionHeading as="h2" description="Use a copy to plan next year or rework a published plan without touching members' history.">
                Duplicate
              </SectionHeading>
              <DuplicateForm planId={plan.id} title={plan.title} mode={plan.mode} canEdit={canEdit} />
            </Card>
          ) : null}
          {draft && canEdit && !plan.enrollments ? (
            <ConfirmDialog trigger="Delete draft" title="Delete this draft?" confirmLabel="Delete draft" formAction={deletePlanAction} hidden={{ id: plan.id }}>
              The draft and its days are deleted. This can&apos;t be undone.
            </ConfirmDialog>
          ) : null}
        </div>
      </div>
    </>
  );
}
