import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { scheduleLabel } from "@/lib/bible/format";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reading plans" };

export type AdminPlan = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  mode: "calendar" | "personal";
  featured: boolean;
  version: number;
  translation: { code: string; name: string; status: string };
  group_name: string | null;
  days: number;
  reading_days: number;
  first_date: string | null;
  last_date: string | null;
  last_day_number: number | null;
  enrollments: number;
  previous_title: string | null;
};

const STATUS: Record<AdminPlan["status"], { label: string; tone: "neutral" | "success" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "info" },
};

export default async function AdminBiblePage({ searchParams }: PageProps<"/admin/bible">) {
  const viewer = await requireAnyCapability([CAPABILITIES.readingEdit, CAPABILITIES.readingPublish], "/admin/bible");
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_plans", { p_status: null });
  const plans = (data as AdminPlan[] | null) ?? [];
  const sections: Array<[string, AdminPlan[]]> = [
    ["Published", plans.filter((p) => p.status === "published")],
    ["Drafts", plans.filter((p) => p.status === "draft")],
    ["Archived", plans.filter((p) => p.status === "archived")],
  ];

  return (
    <>
      <PageHeader
        title="Reading plans"
        description="Yearly church plans with dates, and personal plans members start any day. Members' progress and journals are never shown here."
        actions={
          <>
            {viewer.capabilities.has(CAPABILITIES.readingEdit) ? (
              <ButtonLink href="/admin/bible/plans/new" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
                New plan
              </ButtonLink>
            ) : null}
            {viewer.capabilities.has(CAPABILITIES.bibleManage) ? (
              <ButtonLink href="/admin/bible/sources" size="sm" variant="secondary">
                Bible sources
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {sp.notice === "deleted" ? <Alert tone="success" title="The draft was deleted." className="mb-4" /> : null}
      {error ? <Alert tone="error" title="Plans couldn't be loaded right now." className="mb-4" /> : null}
      {!error && !plans.length ? (
        <EmptyState glyph="bible" title="No reading plans yet">
          Create a plan, add days by hand or import a CSV, preview it, and publish it when it&apos;s ready.
        </EmptyState>
      ) : null}
      {sections.map(([label, list]) =>
        list.length ? (
          <section key={label} className="mb-8" aria-label={label}>
            <SectionHeading>{label}</SectionHeading>
            <ul className={rowListClass}>
              {list.map((p) => (
                <li key={p.id}>
                  <ListRow
                    plain
                    href={`/admin/bible/plans/${p.id}`}
                    label={p.title}
                    description={[scheduleLabel(p), p.translation.code, p.group_name, `${p.days} days`, p.status !== "draft" ? `${p.enrollments} reading` : null].filter(Boolean).join(" · ")}
                    trailing={
                      <span className="flex items-center gap-2">
                        {p.featured ? <Badge tone="warning">Church plan</Badge> : null}
                        <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                        <ChevronRight className="size-5" aria-hidden="true" />
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}
