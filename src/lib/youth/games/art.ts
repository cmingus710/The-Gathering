/**
 * The built-in illustration library for Learn & Play games: original line
 * drawings shipped with the app (src/components/youth/games/game-art.tsx), so
 * staff can build a game without uploading anything. The keys are checked in
 * the database too (youth.game_art_keys(), 20261124000100); a unit test
 * keeps the two lists the same.
 */
export const GAME_ART = [
  { key: "ark", label: "Ark" },
  { key: "animals", label: "Animals two by two" },
  { key: "rain", label: "Rain cloud" },
  { key: "dove", label: "Dove with an olive leaf" },
  { key: "rainbow", label: "Rainbow" },
  { key: "crowd", label: "Crowd on a hillside" },
  { key: "loaves_fish", label: "Five loaves and two fish" },
  { key: "thanks", label: "Bread lifted up in thanks" },
  { key: "baskets", label: "Baskets of leftovers" },
  { key: "fish", label: "Fish" },
  { key: "bread", label: "Loaf of bread" },
  { key: "star", label: "Bright star" },
  { key: "sling", label: "Sling and stones" },
  { key: "tablets", label: "Stone tablets" },
  { key: "big_fish", label: "Big fish" },
  { key: "person", label: "Person" },
  { key: "lamb", label: "Lamb" },
  { key: "crown", label: "Crown" },
  { key: "lamp", label: "Oil lamp" },
  { key: "sheep", label: "Sheep" },
] as const;

export type GameArtKey = (typeof GAME_ART)[number]["key"];

const artLabels = new Map<string, string>(GAME_ART.map((a) => [a.key, a.label]));

export const isGameArtKey = (v: unknown): v is GameArtKey => typeof v === "string" && artLabels.has(v);
export const gameArtLabel = (k: string) => artLabels.get(k) ?? "Picture";
