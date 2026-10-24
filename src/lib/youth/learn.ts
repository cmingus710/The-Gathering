import "server-only";
import { requireClient } from "@/lib/supabase/server";
import type { ActivityCard, Player } from "./activities";
import { signActivityArt } from "./activity-art";
import type { Learning } from "./types";

export type LearnHome = {
  role: "youth" | "adult";
  /** Children the viewer may play for (a youth: themselves). */
  players: Player[];
  /** Verified children the viewer can't play for here (no practice permission, paused, or their own account). */
  other_children: number;
  activities: ActivityCard[];
  lesson: Array<Learning & { group: string }>;
};

/**
 * The Learn & Play home for the signed-in person, with signed cover links.
 * The database returns only published, available activities open to a child
 * the viewer may play for; covers are signed with the viewer's own session,
 * so Storage RLS checks each one again.
 */
export async function loadLearnHome(): Promise<{ home: LearnHome | null; covers: Map<string, string> }> {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("youth_activities_home");
  if (error || !data) return { home: null, covers: new Map() };
  const home = data as LearnHome;
  const covers = await signActivityArt(supabase, home.activities.map((a) => a.cover_path));
  return { home, covers };
}
