import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { ActivityCard, ActivityFilterBar, ActivityGrid, NoActivities } from "@/components/youth/learn-play";
import { requireYouthArea } from "@/lib/auth/viewer";
import { applyFilters, parseFilters, sortForHome } from "@/lib/youth/activities";
import { loadLearnHome } from "@/lib/youth/learn";

export const metadata: Metadata = { title: "Learn & Play" };

export default async function LearnPlayPage({ searchParams }: PageProps<"/youth/play">) {
  const viewer = await requireYouthArea("/youth/play");
  const filters = parseFilters(await searchParams);
  const { home, covers } = await loadLearnHome();
  const mature = viewer.accountKind === "youth";
  const all = sortForHome(home?.activities ?? []);
  const shown = applyFilters(all, filters);
  return (
    <>
      <BackLink route="/youth/play" />
      <PageHeader
        title="Learn & Play"
        description={
          mature
            ? "Bible stories, puzzles, and games. Ages are only suggestions: try whatever looks good."
            : "Bible stories, puzzles, and games to enjoy with your child. Ages are only suggestions, and any child can try any level."
        }
      />
      {!home ? (
        <Alert tone="error" title="Activities couldn't be loaded right now." />
      ) : home.players.length === 0 ? (
        <EmptyState glyph="youth" title="Activities are played with a child you're a verified guardian for">
          Once the church office verifies you as a parent or guardian with permission to practice together, published activities appear here.
        </EmptyState>
      ) : all.length === 0 ? (
        <NoActivities />
      ) : (
        <div className="space-y-6">
          <ActivityFilterBar base="/youth/play" filters={filters} />
          <p className="text-meta text-text-secondary" aria-live="polite">
            {shown.length === all.length ? `${all.length} ${all.length === 1 ? "activity" : "activities"}` : `${shown.length} of ${all.length} activities`}
          </p>
          {shown.length === 0 ? (
            <NoActivities filtered />
          ) : (
            <ActivityGrid>
              {shown.map((a) => (
                <ActivityCard key={a.id} activity={a} href={`/youth/play/${a.id}`} coverUrl={a.cover_path ? covers.get(a.cover_path) : null} players={home.players} mature={mature} />
              ))}
            </ActivityGrid>
          )}
        </div>
      )}
    </>
  );
}
