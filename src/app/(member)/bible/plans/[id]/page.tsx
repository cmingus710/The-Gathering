import { Check, ChevronRight, Coffee, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allTimeZones } from "@/app/admin/events/series";
import { EnrollmentStatus } from "@/components/bible/enrollment-status";
import { ProgressSummary } from "@/components/bible/progress";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionHeading } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { formatYmd } from "@/lib/bible/dates";
import { formatTime, kindLabel, scheduleLabel } from "@/lib/bible/format";
import { signBiblePaths } from "@/lib/bible/storage";
import type { DaySummary, Enrollment, PlanCard, Progress } from "@/lib/bible/types";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { EnrollmentOptions, JoinForm, LeaveControls, ReminderForm } from "./forms";

export const metadata: Metadata = { title: "Reading plan" };

type PlanDay = {
  id: string;
  day_number: number | null;
  day_date: string | null;
  kind: "reading" | "rest" | "catch_up";
  heading: string | null;
  label: string;
  scheduled: string | null;
  passages: string[];
  completed: boolean;
  counted: boolean;
};

type PlanPage = PlanCard & {
  enrollment: Enrollment | null;
  progress: Progress | null;
  today: string;
  member_timezone: string;
  today_day: DaySummary | null;
  day_list: PlanDay[];
};

/** Groups a long list by month (dated plans) or by blocks of 30 days. */
function groups(days: PlanDay[], mode: "calendar" | "personal") {
  const out = new Map<string, PlanDay[]>();
  for (const d of days) {
    const key =
      mode === "calendar" && d.day_date
        ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d.day_date}T12:00:00Z`))
        : `Days ${Math.floor(((d.day_number ?? 1) - 1) / 30) * 30 + 1}–${Math.floor(((d.day_number ?? 1) - 1) / 30) * 30 + 30}`;
    out.set(key, [...(out.get(key) ?? []), d]);
  }
  return [...out.entries()];
}

export default async function PlanPage({ params }: PageProps<"/bible/plans/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireLearner(`/bible/plans/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_plan", { p_id: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This plan couldn't be loaded right now." />;
  const plan = data as PlanPage;
  const covers = await signBiblePaths(supabase, [plan.cover_path]);
  const e = plan.enrollment;
  const active = e?.status === "active";
  const { data: hubData } = await supabase.rpc("bible_hub");
  const multiple = ((hubData as { enrollments?: unknown[] } | null)?.enrollments?.length ?? 0) > 1;
  const started = plan.mode === "calendar" ? !!plan.first_date && plan.first_date <= plan.plan_today : false;
  const coverUrl = plan.cover_path ? covers.get(plan.cover_path) : undefined;

  return (
    <>
      <p className="mb-4">
        <Link href="/bible" className="font-semibold text-primary hover:underline">
          Bible reading
        </Link>
      </p>
      <header className="mb-6 grid gap-5 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-start">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={coverUrl} alt={plan.cover_alt ?? ""} className="aspect-[16/9] w-full rounded-card object-cover" />
        ) : null}
        <div className={coverUrl ? "" : "sm:col-span-2"}>
          <div className="flex flex-wrap gap-2">
            {plan.featured ? <Badge tone="warning">Church plan</Badge> : null}
            {plan.status === "archived" ? <Badge>Archived</Badge> : null}
            {plan.group_name ? <Badge tone="info">{plan.group_name}</Badge> : null}
          </div>
          <h1 className="mt-2 font-display text-display font-semibold">{plan.title}</h1>
          <p className="mt-1 text-meta text-text-secondary">
            {scheduleLabel(plan)} · {plan.translation.name} ({plan.translation.code}){plan.audience_note ? ` · ${plan.audience_note}` : ""}
          </p>
          {plan.description ? <p className="mt-3 max-w-[65ch] whitespace-pre-line text-text-secondary">{plan.description}</p> : null}
          {plan.mode === "calendar" ? (
            <p className="mt-2 text-meta text-text-secondary">Dates follow the church&apos;s time zone ({plan.timezone.replace(/_/g, " ")}).</p>
          ) : e?.start_date ? (
            <p className="mt-2 text-meta text-text-secondary">
              You started on {formatYmd(e.start_date, "full")}; “today” follows {e.timezone.replace(/_/g, " ")}.
            </p>
          ) : null}
        </div>
      </header>

      <EnrollmentStatus
        planId={plan.id}
        enrollment={e}
        joinable={plan.status === "published"}
        className="mb-6"
        joinForm={
          <JoinForm
            planId={plan.id}
            mode={plan.mode}
            started={started}
            today={plan.today}
            startDate={e?.start_date ?? null}
            timezone={e?.timezone ?? plan.member_timezone}
            timezones={allTimeZones([e?.timezone ?? plan.member_timezone])}
            rejoin={!!e}
          />
        }
      />

      {active && plan.progress ? (
        <Card className="mb-6 space-y-4">
          {plan.today_day ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-meta font-semibold text-text-secondary">Today · {plan.today_day.label}</p>
                <p className="font-semibold">
                  {plan.today_day.kind === "rest" ? "A day to rest" : plan.today_day.passages.join("; ") || kindLabel(plan.today_day.kind)}
                  {plan.today_day.completed ? " · Read" : ""}
                </p>
              </div>
              <ButtonLink href={`/bible/day/${plan.today_day.id}`} size="sm">
                {plan.today_day.completed ? "Open" : "Continue reading"}
              </ButtonLink>
            </div>
          ) : (
            <p className="text-text-secondary">{plan.progress.finished ? "You've finished this plan." : plan.progress.started ? "Nothing is assigned for today." : "This plan hasn't started yet."}</p>
          )}
          <ProgressSummary progress={plan.progress} />
          {plan.progress.behind ? (
            <ButtonLink href={`/bible/plans/${plan.id}/catch-up`} variant="secondary" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
              Catch up
            </ButtonLink>
          ) : null}
        </Card>
      ) : null}

      <section aria-labelledby="plan-days" className="mb-8">
        <SectionHeading id="plan-days" description={`${plan.reading_days} readings${plan.days > plan.reading_days ? `, plus ${plan.days - plan.reading_days} rest or catch-up days` : ""}.`}>
          All days
        </SectionHeading>
        <div className="space-y-2">
          {groups(plan.day_list, plan.mode).map(([label, days]) => {
            const containsToday = days.some((d) => d.scheduled === plan.today);
            return (
              <details key={label} open={containsToday || plan.day_list.length <= 31} className="rounded-card border border-border bg-surface">
                <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 font-semibold">
                  {label}
                  <span className="text-meta font-normal text-text-secondary">
                    {days.filter((d) => d.completed).length} of {days.filter((d) => d.kind === "reading").length} read
                  </span>
                </summary>
                <ol className="divide-y divide-border border-t border-border">
                  {days.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/bible/day/${d.id}`}
                        aria-current={d.scheduled === plan.today ? "date" : undefined}
                        className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-muted/60 aria-[current=date]:bg-primary-soft"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border" aria-hidden="true">
                          {d.completed ? <Check className="size-4 text-success" /> : d.kind === "rest" ? <Coffee className="size-4 text-text-secondary" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-meta text-text-secondary">
                            {plan.mode === "calendar" ? d.label : `${d.label}${d.scheduled && e ? ` · ${formatYmd(d.scheduled, "short")}` : ""}`}
                            {d.scheduled === plan.today ? " · Today" : ""}
                            {!d.counted ? " · before you joined" : ""}
                          </span>
                          <span className="block truncate font-semibold">{d.kind === "rest" ? "Rest day" : d.passages.join("; ") || d.heading || kindLabel(d.kind)}</span>
                        </span>
                        <span className="sr-only">{d.completed ? "Read" : d.kind === "rest" ? "Rest day" : "Not read yet"}</span>
                        <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ol>
              </details>
            );
          })}
        </div>
      </section>

      {e ? (
        <section aria-labelledby="plan-settings" className="space-y-4">
          <SectionHeading id="plan-settings">Your settings for this plan</SectionHeading>
          {active ? (
            <>
              <Card>
                <SectionHeading as="h3" description={e.reminders ? (e.reminders_paused ? "Paused." : `Daily at ${formatTime(e.reminder_time)}.`) : "Off."}>
                  Reminders
                </SectionHeading>
                <ReminderForm
                  enrollmentId={e.id}
                  reminders={e.reminders}
                  time={e.reminder_time}
                  paused={e.reminders_paused}
                  timezone={e.timezone}
                  timezones={allTimeZones([e.timezone])}
                  showTimezone={plan.mode === "personal"}
                />
              </Card>
              <Card>
                <EnrollmentOptions
                  enrollmentId={e.id}
                  mode={plan.mode}
                  startDate={e.start_date}
                  countingFromToday={!!e.expect_from}
                  isPrimary={e.is_primary}
                  multiple={multiple}
                />
              </Card>
            </>
          ) : null}
          <LeaveControls enrollmentId={e.id} />
        </section>
      ) : null}
    </>
  );
}
