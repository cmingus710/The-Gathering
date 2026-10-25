import { Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { SectionHeading } from "@/components/ui/card";
import { ActivityConnection, ActivityDescription, ActivityHero } from "@/components/youth/activity-detail";
import { ColoringSection } from "@/components/youth/coloring/section";
import { ColoringStudio } from "@/components/youth/coloring/studio";
import { GamePlayer } from "@/components/youth/games/game-player";
import { ActivityCard, ActivityGrid } from "@/components/youth/learn-play";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { isOlderYouth, type ActivityDetail } from "@/lib/youth/activities";
import { signActivityArt, signGameMedia } from "@/lib/youth/activity-art";
import { emptyDoc, lineArtPath, templateFromConfig } from "@/lib/youth/coloring";
import { GAME_NAMES, gameIssues, parseGameConfig } from "@/lib/youth/games/config";
import { freshSeed } from "@/lib/youth/games/random";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Preview activity" };

/**
 * What members would see for the draft (or a chosen published version): the
 * card and the activity page, without progress or child choice. Nothing here
 * is visible to members.
 */
export default async function PreviewActivityPage({ params, searchParams }: PageProps<"/admin/youth/activities/[id]/preview">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireCapability(CAPABILITIES.youthActivities, `/admin/youth/activities/${id}/preview`);
  const sp = await searchParams;
  const raw = Array.isArray(sp.version) ? sp.version[0] : sp.version;
  const { data: a } = await youthRead<ActivityDetail & { state: string }>("youth_admin_activity_preview", { p_id: id, p_version: isUuid(raw) ? raw : null });
  if (!a) return <Alert tone="error" title="This preview couldn't be loaded right now." />;
  const supabase = await requireClient();
  const coloring = a.kind === "drawing" ? templateFromConfig(a.config) : null;
  const linePath = coloring ? lineArtPath(id, coloring) : null;
  const signed = await signActivityArt(supabase, [a.cover_path, linePath]);
  const cover = a.cover_path ? (signed.get(a.cover_path) ?? null) : null;
  const mature = isOlderYouth(a.age_min);
  const game = parseGameConfig(a.kind, a.config);
  const media = game ? await signGameMedia(supabase, a.media) : {};
  const issues = game ? gameIssues(game, a.difficulty) : [];
  return (
    <div className="layout-wide space-y-8">
      <p className="-mt-1">
        <Link href={`/admin/youth/activities/${id}`} className="inline-flex min-h-11 items-center text-meta font-semibold text-text-secondary hover:text-text hover:underline">
          ‹ Back to the editor
        </Link>
      </p>
      <Alert tone="info" title={`Preview of version ${a.version} (${a.state === "published" ? "published" : a.state === "retired" ? "replaced" : "not published"})`}>
        <span className="inline-flex items-center gap-1.5">
          <Eye className="size-4" aria-hidden="true" /> This is how members see it. You can play the game or color the picture here; nothing is saved.
        </span>
      </Alert>

      <section aria-labelledby="card">
        <SectionHeading id="card">Card</SectionHeading>
        <div className="max-w-md">
          <ActivityGrid>
            <ActivityCard activity={a} coverUrl={cover} href={`/admin/youth/activities/${id}/preview${raw && isUuid(raw) ? `?version=${raw}` : ""}`} />
          </ActivityGrid>
        </div>
      </section>

      <section aria-labelledby="page" className="space-y-4">
        <SectionHeading id="page">Activity page</SectionHeading>
        <ActivityHero a={a} coverUrl={cover} mature={mature} as="h2" />
        {game ? (
          <section aria-labelledby="play" className="space-y-3">
            <SectionHeading id="play">{GAME_NAMES[game.player]}</SectionHeading>
            {issues.length ? (
              <Alert tone="warning" title="Not ready to publish yet">
                <ul className="list-disc space-y-0.5 pl-5">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <GamePlayer kind={a.kind} difficulty={a.difficulty} config={a.config} media={media} initial={null} target={null} seed={freshSeed()} who="You" />
          </section>
        ) : null}
        <ActivityConnection a={a} />
        <ActivityDescription source={a.description} />
      </section>

      {coloring ? (
        <ColoringSection t={coloring} scriptureRefs={a.scripture_refs} bibleStory={a.bible_story}>
          <ColoringStudio
            mode="preview"
            activityId={id}
            versionId={a.version_id}
            title={a.title}
            template={coloring}
            accountId={viewer.id}
            child={null}
            childId="preview"
            childName="the child"
            initial={{ doc: emptyDoc(), revision: 0, updatedAt: null }}
            lineArtUrl={linePath ? (signed.get(linePath) ?? null) : null}
          />
        </ColoringSection>
      ) : null}
    </div>
  );
}
