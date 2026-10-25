"use client";

import type { Difficulty } from "@/lib/youth/activities";
import { parseGameConfig } from "@/lib/youth/games/config";
import { availableSizes } from "@/lib/youth/games/match";
import { BibleMatchPlayer } from "./bible-match";
import type { MediaMap } from "./game-art";
import { StoryOrderPlayer } from "./story-order";
import type { SaveTarget } from "./use-progress-saver";

/**
 * The game for one activity version, or null when the version has no game
 * (or one that can't be played yet; the editor lists why). The parent keys
 * this by child and version, so switching children never carries a board
 * over. `target` null = the editor's preview: playable, nothing saved.
 */
export function GamePlayer({
  kind,
  difficulty,
  config,
  media,
  initial,
  target,
  seed,
  who,
}: {
  kind: string;
  difficulty: Difficulty;
  config: Record<string, unknown>;
  media: MediaMap;
  initial: { data: Record<string, unknown>; completed: boolean } | null;
  target: SaveTarget;
  seed: number;
  who: string;
}) {
  const game = parseGameConfig(kind, config);
  if (!game) return null;
  if (game.player === "story_order") {
    if (game.scenes.length < 2) return <Unplayable />;
    return <StoryOrderPlayer config={game} difficulty={difficulty} media={media} initial={initial} target={target} seed={seed} who={who} />;
  }
  if (!availableSizes(game).length) return <Unplayable />;
  return <BibleMatchPlayer config={game} media={media} initial={initial} target={target} seed={seed} who={who} />;
}

function Unplayable() {
  return <p className="text-text-secondary">This game isn&apos;t ready to play yet.</p>;
}

