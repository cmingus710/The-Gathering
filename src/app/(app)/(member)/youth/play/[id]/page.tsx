import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ActivityConnection, ActivityDescription, ActivityHero } from "@/components/youth/activity-detail";
import { ActivityProgressControl } from "@/components/youth/activity-progress";
import { ColoringSection } from "@/components/youth/coloring/section";
import { ColoringStudio } from "@/components/youth/coloring/studio";
import { requireYouthArea } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { isOlderYouth, type ActivityDetail, type ActivityProgress, type Player } from "@/lib/youth/activities";
import { signActivityArt } from "@/lib/youth/activity-art";
import { checkDoc, lineArtPath, templateFromConfig } from "@/lib/youth/coloring";
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

type Artwork = { child_id: string; version_id: string; revision: number; doc: unknown; updated_at: string | null; earlier: boolean };

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
  const coloring = a.kind === "drawing" ? templateFromConfig(a.config) : null;
  const linePath = coloring ? lineArtPath(a.id, coloring) : null;
  const signed = await signActivityArt(supabase, [a.cover_path, linePath]);
  const cover = a.cover_path ? (signed.get(a.cover_path) ?? null) : null;
  const mature = youth || isOlderYouth(a.age_min);
  const player = a.child;
  // The chosen child's artwork, read through the same who-may-play checks as progress.
  const artwork = coloring && player ? (await youthRead<Artwork>("youth_coloring_artwork", { p_activity: a.id, p_child: youth ? null : player.id })).data : null;
  const artworkDoc = artwork ? checkDoc(artwork.doc, coloring) : null;

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
          {coloring ? null : (
            <p className="text-meta text-text-secondary">
              Interactive play for this activity is on its way. For now, do it together, then mark it finished.
            </p>
          )}
        </aside>
      </div>

      {coloring ? (
        <div className="mt-8">
          <ColoringSection t={coloring} scriptureRefs={a.scripture_refs} bibleStory={a.bible_story}>
            {player && artwork && (artwork.version_id !== a.version_id || !artworkDoc?.ok) ? (
              // Published again between the two reads, or a picture this page can't show: never a blank studio that could save over it.
              <Alert tone="error" title={artwork.version_id !== a.version_id ? "This activity was just updated. Reload the page to continue." : "This picture couldn't be opened. Nothing was changed."} />
            ) : player && artwork && artworkDoc?.ok ? (
              <>
                <p className="text-meta text-text-secondary">
                  {youth
                    ? "Your picture is private to you and saves as you color. It isn't shared or posted anywhere."
                    : `Coloring as ${player.display_name}. The picture is private to ${player.display_name} and their verified guardians, saves as you color, and isn't shared or posted anywhere.`}
                  {artwork.earlier ? " A picture from before this activity was updated is kept with the earlier version." : ""}
                </p>
                <ColoringStudio
                  key={`${player.id}:${a.version_id}`}
                  activityId={a.id}
                  versionId={a.version_id}
                  title={a.title}
                  template={coloring}
                  accountId={viewer.id}
                  child={youth ? null : player.id}
                  childId={player.id}
                  childName={youth ? "you" : player.display_name}
                  initial={{ doc: artworkDoc.value, revision: artwork.revision, updatedAt: artwork.updated_at }}
                  lineArtUrl={linePath ? (signed.get(linePath) ?? null) : null}
                />
              </>
            ) : player ? (
              <Alert tone="error" title="This picture couldn't be loaded right now." />
            ) : (
              <Alert tone="info" title="Choose who's coloring (under Who's playing) to start. Each child's picture is saved to them." />
            )}
          </ColoringSection>
        </div>
      ) : null}
    </article>
  );
}
