import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ActivityConnection, ActivityDescription, ActivityHero } from "@/components/youth/activity-detail";
import { ActivityProgressControl } from "@/components/youth/activity-progress";
import { requireYouthArea } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { isOlderYouth, type ActivityDetail, type ActivityProgress, type Player } from "@/lib/youth/activities";
import { signActivityArt } from "@/lib/youth/activity-art";
import { youthRead } from "@/lib/youth/queries";

// A generic title: an activity's name never appears in tab titles or history.
export const metadata: Metadata = { title: "Learn & Play" };

type Page = ActivityDetail & {
  role: "youth" | "adult";
  players: Player[];
  child: Player | null;
  progress: ActivityProgress | null;
  earlier: ActivityProgress[] | null;
};

export default async function ActivityPage({ params, searchParams }: PageProps<"/youth/play/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const rawChild = Array.isArray(sp.child) ? sp.child[0] : sp.child;
  const viewer = await requireYouthArea(`/youth/play/${id}`);
  const youth = viewer.accountKind === "youth";
  // Guardians choose the child explicitly; a youth always plays as themselves.
  const child = !youth && rawChild && isUuid(rawChild) ? rawChild : null;
  const { data: a } = await youthRead<Page>("youth_activity", { p_id: id, p_child: child });
  if (!a) return <Alert tone="error" title="This activity couldn't be loaded right now." />;
  const supabase = await requireClient();
  const cover = a.cover_path ? (await signActivityArt(supabase, [a.cover_path])).get(a.cover_path) : null;
  const mature = youth || isOlderYouth(a.age_min);
  const player = a.child;

  return (
    <article className="layout-wide mx-auto max-w-5xl">
      <BackLink route="/youth/play/[id]" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <ActivityHero a={a} coverUrl={cover} mature={mature} />
          <ActivityConnection a={a} />
          {a.description ? (
            <section aria-labelledby="about">
              <SectionHeading id="about">About this activity</SectionHeading>
              <ActivityDescription source={a.description} />
            </section>
          ) : null}
        </div>

        <aside className="space-y-4" aria-label="Who's playing">
          {youth ? null : (
            <Card className="space-y-3">
              <h2 className="text-[1.125rem] font-semibold">Who&apos;s playing?</h2>
              <p className="text-meta text-text-secondary">Choose the child each time, so their progress is saved to them and no one else.</p>
              <ul className="flex flex-wrap gap-2">
                {a.players.map((p) => {
                  const active = a.child?.id === p.id;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/youth/play/${a.id}?child=${p.id}`}
                        aria-current={active ? "true" : undefined}
                        replace
                        scroll={false}
                        className={cn(
                          "inline-flex min-h-11 items-center rounded-full border px-4 font-semibold transition-colors",
                          active ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
                        )}
                      >
                        {p.display_name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {player ? (
            <Card className="space-y-3">
              <h2 className="text-[1.125rem] font-semibold">{youth ? "Your progress" : `${player.display_name}'s progress`}</h2>
              <p className="text-meta text-text-secondary">
                {youth
                  ? "Private to you. Your parent or guardian sees a summary only if you choose to share it."
                  : `Private to ${player.display_name} and their verified guardians. Leaders don't see it.`}
              </p>
              <ActivityProgressControl
                key={`${player.id}:${a.version_id}`}
                activity={a.id}
                child={youth ? null : player.id}
                childName={youth ? "You" : player.display_name}
                version={a.version_id}
                initial={a.progress ? { status: a.progress.status, revision: a.progress.revision, data: a.progress.data ?? {} } : null}
              />
              {a.earlier && a.earlier.length ? (
                <p className="text-meta text-text-secondary">
                  This activity was updated. Earlier progress is kept with the version it was made on
                  {a.earlier.some((e) => e.status === "completed") ? " (finished before the update)" : ""}.
                </p>
              ) : null}
            </Card>
          ) : (
            <Alert tone="info" title="Choose who's playing to save progress." />
          )}
          <p className="text-meta text-text-secondary">
            Interactive play for this activity is on its way. For now, do it together, then mark it finished.
          </p>
        </aside>
      </div>
    </article>
  );
}
