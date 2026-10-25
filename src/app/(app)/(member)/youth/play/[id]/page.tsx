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
import { GamePlayer } from "@/components/youth/games/game-player";
import { requireYouthArea } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { isOlderYouth, type ActivityDetail, type ActivityProgress, type Player } from "@/lib/youth/activities";
import { signActivityArt, signGameMedia } from "@/lib/youth/activity-art";
import { checkDoc, lineArtPath, templateFromConfig } from "@/lib/youth/coloring";
import { GAME_NAMES, parseGameConfig } from "@/lib/youth/games/config";
import { freshSeed } from "@/lib/youth/games/random";
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
  const game = parseGameConfig(a.kind, a.config);
  const media = game ? await signGameMedia(supabase, a.media) : {};
  // The chosen child's artwork, read through the same who-may-play checks as progress.
  const artwork = coloring && player ? (await youthRead<Artwork>("youth_coloring_artwork", { p_activity: a.id, p_child: youth ? null : player.id })).data : null;
  const artworkDoc = artwork ? checkDoc(artwork.doc, coloring) : null;

  return (
    <article className="layout-wide mx-auto max-w-5xl">
      <BackLink route="/youth/play/[id]" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <ActivityHero a={a} coverUrl={cover} mature={mature} />
          {game ? (
            <section aria-labelledby="play" className="space-y-3">
              <SectionHeading id="play">{GAME_NAMES[game.player]}</SectionHeading>
              {player ? (
                <GamePlayer
                  key={`${player.id}:${a.version_id}`}
                  kind={a.kind}
                  difficulty={a.difficulty}
                  config={a.config}
                  media={media}
                  initial={a.progress ? { data: a.progress.data ?? {}, completed: a.progress.status === "completed" } : null}
                  target={{ activity: a.id, child: youth ? null : player.id, version: a.version_id, revision: a.progress?.revision ?? 0 }}
                  seed={freshSeed()}
                  who={youth ? "You" : player.display_name}
                />
              ) : (
                <Alert tone="info" title="Choose who's playing to start.">
                  <p className="mb-2">The game saves progress to the child you choose, so each child keeps their own.</p>
                  <PlayerChips activity={a.id} players={a.players} current={null} />
                </Alert>
              )}
            </section>
          ) : null}
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
              <PlayerChips activity={a.id} players={a.players} current={a.child?.id ?? null} />
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
              {game ? (
                <p className="font-semibold">
                  {a.progress?.status === "completed"
                    ? `${youth ? "You" : player.display_name} finished this. Play again any time; it stays finished.`
                    : a.progress
                      ? `${youth ? "You" : player.display_name} started this. The game picks up where ${youth ? "you" : "they"} left off.`
                      : `${youth ? "You haven't" : `${player.display_name} hasn't`} started this yet.`}
                </p>
              ) : (
                <ActivityProgressControl
                  key={`${player.id}:${a.version_id}`}
                  activity={a.id}
                  child={youth ? null : player.id}
                  childName={youth ? "You" : player.display_name}
                  version={a.version_id}
                  initial={a.progress ? { status: a.progress.status, revision: a.progress.revision, data: a.progress.data ?? {} } : null}
                />
              )}
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
          {game || coloring ? null : (
            <p className="text-meta text-text-secondary">Do this activity together, then mark it finished.</p>
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

/** The children this viewer may play for, as links (the choice lives in the URL). */
function PlayerChips({ activity, players, current }: { activity: string; players: Player[]; current: string | null }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {players.map((p) => {
        const active = current === p.id;
        return (
          <li key={p.id}>
            <Link
              href={`/youth/play/${activity}?child=${p.id}`}
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
  );
}
