import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { DemoActivitiesForm } from "@/components/youth/activity-editor";
import { EmptyState, ListRow, PageHeader, rowListClass } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { DemoDraftsButton } from "@/components/youth/coloring/editor";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { ACTIVITY_STATUS, difficultyLabel, kindLabel } from "@/lib/youth/activities";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Learn & Play activities" };

type Row = {
  id: string;
  status: string;
  live: boolean;
  title: string;
  kind: string;
  difficulty: string;
  published_version: number | null;
  draft_version: number | null;
  draft_state: string | null;
  groups: number;
};

const FILTERS: Array<[string | null, string]> = [
  [null, "All"],
  ["draft", "Drafts"],
  ["preview", "Ready for preview"],
  ["published", "Published"],
  ["archived", "Archived"],
];

export default async function ActivitiesAdminPage({ searchParams }: PageProps<"/admin/youth/activities">) {
  await requireCapability(CAPABILITIES.youthActivities, "/admin/youth/activities");
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = FILTERS.some(([k]) => k === raw) ? (raw as string) : null;
  const { data, failed } = await youthRead<Row[]>("youth_admin_activities", { p_status: status });
  return (
    <>
      <PageHeader
        title="Learn & Play activities"
        description="Drafts and previews stay private to editors. Publishing makes a new version; earlier versions and the progress made on them are kept."
        actions={<ButtonLink href="/admin/youth/activities/new">New activity</ButtonLink>}
      />
      <nav aria-label="Filter by status" className="mb-5">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <li key={label}>
              <Link
                href={k ? `/admin/youth/activities?status=${k}` : "/admin/youth/activities"}
                aria-current={status === k ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-meta font-semibold",
                  status === k ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {failed || !data ? (
        <Alert tone="error" title="Activities couldn't be loaded right now." />
      ) : data.length === 0 ? (
        <EmptyState glyph="youth" title={status ? "Nothing here" : "No activities yet"}>
          {status ? "No activities have this status." : "Create the first one, or add the demonstration drafts below. Members see an activity only once it's published."}
        </EmptyState>
      ) : (
        <div className={rowListClass}>
          {data.map((a) => {
            const st = ACTIVITY_STATUS[a.status] ?? ACTIVITY_STATUS.draft;
            return (
              <ListRow
                key={a.id}
                plain
                href={`/admin/youth/activities/${a.id}`}
                label={a.title}
                description={[
                  kindLabel(a.kind),
                  difficultyLabel(a.difficulty),
                  a.published_version ? `version ${a.published_version} published` : null,
                  a.draft_version && a.published_version ? `unpublished changes (version ${a.draft_version})` : null,
                  a.groups ? `${a.groups} ${a.groups === 1 ? "group" : "groups"}` : "all groups",
                  a.status === "published" && !a.live ? "outside its availability window" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={<Badge tone={st.tone}>{st.label}</Badge>}
              />
            );
          })}
        </div>
      )}
      {failed ? null : (
        <section aria-labelledby="demos" className="mt-8 max-w-2xl space-y-2 rounded-card border border-border p-4 sm:p-5">
          <h2 id="demos" className="font-semibold">
            Demonstration games
          </h2>
          <p className="text-meta text-text-secondary">
            Adds four original examples as private drafts: two Put the Story in Order (Noah, and Jesus feeding the crowd) and two Bible Match (picture pairs, and Bible people with
            things from their stories). Each lists its Scripture references. Check the content, preview it, and publish only when it&apos;s right. Drafts already in the list are
            skipped.
          </p>
          <DemoActivitiesForm />
        </section>
      )}
      {failed ? null : (
        <section aria-labelledby="coloring-demos" className="mt-4 max-w-2xl space-y-2 rounded-card border border-border p-4 sm:p-5">
          <h2 id="coloring-demos" className="font-semibold">
            Demonstration coloring pictures
          </h2>
          <DemoDraftsButton />
        </section>
      )}
    </>
  );
}
