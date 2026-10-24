import type { ItemCard } from "./types";

/**
 * The featured lesson (public.media_lessons, public.media_home): the database picks the
 * featured lesson by lesson date in the church's time zone and lists the
 * rest oldest first; this only names the result.
 */
export type FeaturedState = "today" | "upcoming" | "latest";

export type LessonsPage = {
  today: string | null;
  featured: ItemCard | null;
  featured_state: FeaturedState | null;
  items: ItemCard[];
  total: number;
};

export const EMPTY_LESSONS: LessonsPage = { today: null, featured: null, featured_state: null, items: [], total: 0 };

const LABEL: Record<FeaturedState, string> = { today: "Today's lesson", upcoming: "Upcoming lesson", latest: "Latest lesson" };

export function featuredLabel(state: FeaturedState | null | undefined): string {
  return LABEL[state ?? "latest"] ?? LABEL.latest;
}
