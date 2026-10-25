import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_ART } from "./art";
import { compactConfig, gameIssues, parseMatchConfig, parseStoryConfig, type MatchConfig, type StoryConfig } from "./config";
import { DEMO_ACTIVITIES } from "./demos";
import { availableSizes, buildDeck, cardFace, gridStep, matchData, matchReducer, newMatch, pairOf, resumeMatch, type MatchState } from "./match";
import { nextSeed, shuffled } from "./random";
import { inPlace, newStory, resumeStory, shuffleScenes, storyData, storyReducer, type StoryState } from "./story";

const story: StoryConfig = {
  player: "story_order",
  scenes: ["build", "animals", "rain", "dove", "rainbow"].map((id) => ({
    id,
    image: { art: id === "build" ? "ark" : id === "animals" ? "animals" : id === "rain" ? "rain" : id === "dove" ? "dove" : "rainbow" },
    caption: `Scene ${id}`,
    description: "",
    clue: `Clue ${id}`,
    note: "",
  })),
  wrap_up: "God keeps his promises.",
};
const ids = story.scenes.map((s) => s.id);

const match: MatchConfig = {
  player: "bible_match",
  mode: "related",
  sizes: [3, 4, 6],
  show_moves: true,
  pairs: [
    ["noah", "ark"],
    ["david", "sling"],
    ["moses", "tablets"],
    ["jonah", "big_fish"],
  ].map(([id, art]) => ({ id, a: { image: { art: "person" as const }, label: id, description: "" }, b: { image: { art: art as "ark" }, label: art, description: "" }, note: `${id} note` })),
};

const play = <S, A>(reducer: (s: S, a: A) => S, s: S, actions: A[]) => actions.reduce(reducer, s);

describe("seeded boards", () => {
  it("are the same for the same seed and differ for another", () => {
    expect(shuffled(ids, 42)).toEqual(shuffled(ids, 42));
    expect(shuffled(ids, 42)).not.toEqual(shuffled(ids, nextSeed(42)));
    expect(shuffled(ids, 7).sort()).toEqual([...ids].sort());
  });

  it("never start a story already in order", () => {
    for (let seed = 1; seed < 400; seed++) {
      expect(shuffleScenes(["a", "b"], seed)).toEqual(["b", "a"]);
      expect(shuffleScenes(ids, seed)).not.toEqual(ids);
    }
  });
});

describe("Put the Story in Order", () => {
  const reduce = storyReducer(story);
  const solve = (s: StoryState) => ids.reduce((acc, id, i) => reduce(acc, { type: "move", id, to: i }), s);

  it("starts shuffled and the same for the same seed", () => {
    const s = newStory(story, 99);
    expect(s.order).not.toEqual(ids);
    expect(newStory(story, 99).order).toEqual(s.order);
    expect(s).toMatchObject({ hintsUsed: 0, checks: 0, solved: false, completions: 0 });
  });

  it("checks a wrong answer gently: says what's already right and takes nothing away", () => {
    const s = reduce(newStory(story, 5), { type: "check" });
    expect(s.solved).toBe(false);
    expect(s.checks).toBe(1);
    expect(s.checked).toEqual(inPlace(story, s.order));
    // The next move clears the feedback; Try Again (dismiss) does too.
    const moved = reduce(s, { type: "step", id: s.order[0], by: 1 });
    expect(moved.checked).toBeNull();
    expect(reduce(s, { type: "dismiss" }).checked).toBeNull();
  });

  it("finishes on a correct answer, once", () => {
    const solved = reduce(solve(newStory(story, 5)), { type: "check" });
    expect(solved).toMatchObject({ solved: true, completions: 1 });
    expect(reduce(solved, { type: "check" })).toBe(solved);
    expect(reduce(solved, { type: "move", id: ids[0], to: 3 })).toBe(solved);
  });

  it("moves by drag (to a slot) and by step, and ignores moves off the ends", () => {
    const s = { ...newStory(story, 5), order: ["rain", "build", "animals", "dove", "rainbow"] };
    expect(reduce(s, { type: "move", id: "rain", to: 2 }).order).toEqual(["build", "animals", "rain", "dove", "rainbow"]);
    expect(reduce(s, { type: "step", id: "build", by: -1 }).order).toEqual(["build", "rain", "animals", "dove", "rainbow"]);
    expect(reduce(s, { type: "step", id: "rain", by: -1 })).toBe(s);
    expect(reduce(s, { type: "step", id: "rainbow", by: 1 })).toBe(s);
    expect(reduce(s, { type: "move", id: "nope", to: 1 })).toBe(s);
  });

  it("gives hints up to the difficulty's limit, pinning each placed scene", () => {
    let s: StoryState = { ...newStory(story, 5), order: ["rainbow", "dove", "rain", "animals", "build"] };
    s = reduce(s, { type: "hint", max: 2 });
    expect(s.order[0]).toBe("build");
    expect(s.pinned).toEqual(["build"]);
    expect(s.lastHint).toBe("build");
    s = reduce(s, { type: "hint", max: 2 });
    expect(s.order.slice(0, 2)).toEqual(["build", "animals"]);
    expect(s.hintsUsed).toBe(2);
    expect(reduce(s, { type: "hint", max: 2 })).toBe(s);
    // Pinned scenes don't move, and nothing can be dropped onto them.
    expect(reduce(s, { type: "step", id: "build", by: 1 })).toBe(s);
    expect(reduce(s, { type: "move", id: "rainbow", to: 0 })).toBe(s);
    // Stepping skips over pinned slots.
    const t = reduce(s, { type: "step", id: "rain", by: -1 });
    expect(t).toBe(s); // slot 2 is the first free slot: nowhere earlier to go
    const u = reduce(s, { type: "move", id: "dove", to: 4 });
    expect(u.order.slice(0, 2)).toEqual(["build", "animals"]);
  });

  it("starts over with a new shuffle but keeps completions; replay only after finishing", () => {
    const solved = reduce(solve(newStory(story, 5)), { type: "check" });
    const again = reduce(solved, { type: "replay" });
    expect(again).toMatchObject({ solved: false, completions: 1, hintsUsed: 0, checks: 0, pinned: [] });
    expect(again.seed).not.toBe(solved.seed);
    const unfinished = newStory(story, 5);
    expect(reduce(unfinished, { type: "replay" })).toBe(unfinished);
    expect(reduce(reduce(unfinished, { type: "hint", max: 3 }), { type: "restart" })).toMatchObject({ hintsUsed: 0, pinned: [], completions: 0 });
  });

  it("resumes saved progress exactly, and starts fresh when the scenes changed", () => {
    const s = reduce(reduce(newStory(story, 11), { type: "hint", max: 3 }), { type: "check" });
    const data = JSON.parse(JSON.stringify(storyData(s)));
    const back = resumeStory(story, data, 1234);
    expect(back).toMatchObject({ seed: s.seed, order: s.order, pinned: s.pinned, hintsUsed: 1, checks: 1, solved: false });
    // A new version with different scenes: a fresh board, completion count kept.
    const changed = { ...story, scenes: story.scenes.slice(0, 4) };
    const fresh = resumeStory(changed, { ...data, completions: 2 }, 1234);
    expect(fresh.order).toHaveLength(4);
    expect(fresh).toMatchObject({ hintsUsed: 0, completions: 2 });
    // Tampered data (duplicates, a pinned scene out of place) isn't trusted.
    expect(resumeStory(story, { ...data, order: [ids[0], ids[0], ids[1], ids[2], ids[3]] }, 1).pinned).toEqual([]);
    expect(resumeStory(story, { ...data, pinned: [s.order.find((id, i) => ids[i] !== id)] }, 1).pinned).toEqual([]);
    // A recorded completion counts even without saved data.
    expect(resumeStory(story, null, 1, true).completions).toBe(1);
  });
});

describe("Bible Match", () => {
  const reduce = matchReducer(match);
  const start = () => newMatch(match, 4, 77);
  const partner = (s: MatchState, card: string) => s.deck.find((c) => c !== card && pairOf(c) === pairOf(card))!;
  const stranger = (s: MatchState, card: string) => s.deck.find((c) => pairOf(c) !== pairOf(card))!;

  it("builds a stable board of the chosen size", () => {
    const s = start();
    expect(s.deck).toHaveLength(8);
    expect(new Set(s.deck.map(pairOf)).size).toBe(4);
    expect(buildDeck(match, 4, 77)).toEqual(s.deck);
    expect(buildDeck(match, 3, 77)).toHaveLength(6);
    expect(availableSizes(match)).toEqual([3, 4]);
  });

  it("matches a pair, counts one move, and explains it", () => {
    const s0 = start();
    const c = s0.deck[0];
    const s = play(reduce, s0, [{ type: "flip", card: c }, { type: "flip", card: partner(s0, c) }]);
    expect(s).toMatchObject({ matched: [pairOf(c)], moves: 1, faceUp: [], lastMatch: pairOf(c) });
    expect(cardFace(match, `${pairOf(c)}:b`)?.label).not.toBe(cardFace(match, `${pairOf(c)}:a`)?.label);
  });

  it("leaves a miss face up until the next tap, with no timer", () => {
    const s0 = start();
    const c = s0.deck[0];
    const miss = play(reduce, s0, [{ type: "flip", card: c }, { type: "flip", card: stranger(s0, c) }]);
    expect(miss.faceUp).toHaveLength(2);
    expect(miss.lastMiss).toEqual(miss.faceUp);
    expect(miss.moves).toBe(1);
    const next = reduce(miss, { type: "flip", card: s0.deck.find((x) => !miss.faceUp.includes(x))! });
    expect(next.faceUp).toHaveLength(1);
    expect(next.moves).toBe(1);
    expect(reduce(miss, { type: "cover" }).faceUp).toEqual([]);
  });

  it("ignores rapid repeated taps: no third card, no double match, no extra moves", () => {
    const s0 = start();
    const c = s0.deck[0];
    const p = partner(s0, c);
    const s = play(reduce, s0, [
      { type: "flip", card: c },
      { type: "flip", card: c },
      { type: "flip", card: c },
      { type: "flip", card: p },
      { type: "flip", card: p },
      { type: "flip", card: c },
      { type: "flip", card: "not-a-card:a" },
    ]);
    expect(s.matched).toEqual([pairOf(c)]);
    expect(s.moves).toBe(1);
    expect(s.faceUp).toEqual([]);
  });

  it("finishes when every pair is found, then replays without losing the completion", () => {
    let s = start();
    for (const pair of [...new Set(s.deck.map(pairOf))]) s = play(reduce, s, [{ type: "flip", card: `${pair}:a` }, { type: "flip", card: `${pair}:b` }]);
    expect(s).toMatchObject({ solved: true, completions: 1, moves: 4 });
    expect(reduce(s, { type: "flip", card: s.deck[0] })).toBe(s);
    const again = reduce(s, { type: "replay" });
    expect(again).toMatchObject({ solved: false, matched: [], moves: 0, completions: 1 });
    expect(again.deck).not.toEqual(s.deck);
  });

  it("changes board size only to one the pairs can fill", () => {
    expect(reduce(start(), { type: "restart", size: 3 }).deck).toHaveLength(6);
    expect(reduce(start(), { type: "restart", size: 6 }).deck).toHaveLength(8);
  });

  it("resumes the same board and the pairs found", () => {
    const s0 = start();
    const c = s0.deck[2];
    const s = play(reduce, s0, [{ type: "flip", card: c }, { type: "flip", card: partner(s0, c) }]);
    const back = resumeMatch(match, JSON.parse(JSON.stringify(matchData(s))), 5)!;
    expect(back).toMatchObject({ deck: s.deck, matched: s.matched, moves: 1, faceUp: [] });
    expect(resumeMatch(match, { ...matchData(s), matched: ["ghost", pairOf(c), pairOf(c)] }, 5)!.matched).toEqual([pairOf(c)]);
    expect(resumeMatch(match, { ...matchData(s), size: 12 }, 5)!.size).toBe(3);
    expect(resumeMatch({ ...match, pairs: match.pairs.slice(0, 2) }, null, 5)).toBeNull();
  });

  it("moves keyboard focus around the grid", () => {
    expect(gridStep(0, "ArrowRight", 4, 8)).toBe(1);
    expect(gridStep(0, "ArrowLeft", 4, 8)).toBe(0);
    expect(gridStep(1, "ArrowDown", 4, 8)).toBe(5);
    expect(gridStep(5, "ArrowDown", 4, 8)).toBe(5);
    expect(gridStep(5, "ArrowUp", 4, 8)).toBe(1);
    expect(gridStep(5, "Home", 4, 8)).toBe(0);
    expect(gridStep(2, "End", 4, 8)).toBe(7);
    expect(gridStep(3, "a", 4, 8)).toBe(3);
  });
});

describe("game configuration", () => {
  it("reads only known fields with plain text and unique ids", () => {
    const c = parseStoryConfig({
      player: "story_order",
      scenes: [
        { id: "a", image: { art: "ark" }, caption: "Noah <b>builds</b>", extra: "x" },
        { id: "a", image: { art: "<script>" }, caption: "Two" },
        { id: "BAD ID", image: { asset: "not-a-uuid" }, caption: "Three" },
      ],
    })!;
    expect(c.scenes.map((s) => s.id)).toEqual(["a", "s2", "s3"]);
    expect(c.scenes[0]).toEqual({ id: "a", image: { art: "ark" }, caption: "Noah builds", description: "", clue: "", note: "" });
    expect(c.scenes[1].image).toBeNull();
    expect(c.scenes[2].image).toBeNull();
    expect(parseStoryConfig({ player: "bible_match" })).toBeNull();
    const m = parseMatchConfig({ player: "bible_match", mode: "identical", sizes: [6, 5, 3, 3], pairs: [{ id: "x", a: { image: { art: "dove" } }, b: { label: "ignored" } }] })!;
    expect(m.sizes).toEqual([3, 6]);
    expect(m.pairs[0].b).toBeNull();
  });

  it("drops empty optional fields when storing", () => {
    const c = compactConfig(parseStoryConfig({ player: "story_order", scenes: [{ id: "a", caption: "One" }] })!);
    expect(c).toEqual({ player: "story_order", scenes: [{ id: "a", caption: "One" }] });
  });

  it("lists what keeps a story from being published, by difficulty", () => {
    expect(gameIssues(story, "growing")).toEqual([]);
    expect(gameIssues(story, "beginner")).toEqual(["A Beginner story needs 3 to 4 scenes (it has 5). Change the scenes or the difficulty."]);
    expect(gameIssues({ ...story, scenes: [] }, "beginner")).toEqual(["Add the story's scenes, in the correct order."]);
    const missing = { ...story, scenes: story.scenes.map((s, i) => (i === 1 ? { ...s, image: null, caption: " " } : s)) };
    expect(gameIssues(missing, "challenge")).toEqual(["Scene 2 needs a picture.", "Scene 2 needs a caption."]);
  });

  it("lists incomplete pairs, look-alike cards, and sizes the pairs can't fill", () => {
    expect(gameIssues(match, "beginner")).toEqual(["A board of 6 pairs needs at least 6 pairs (there are 4)."]);
    const broken: MatchConfig = {
      ...match,
      sizes: [],
      pairs: [
        match.pairs[0],
        { ...match.pairs[1], b: { image: null, label: "", description: "" }, note: "" },
        { ...match.pairs[2], a: { ...match.pairs[0].a } },
      ],
    };
    expect(gameIssues(broken, "beginner")).toEqual([
      "Pair 2 needs a picture or a name on its second card.",
      "Pair 2 needs a short explanation, shown when it's matched.",
      "Pairs 1 and 3 have cards that look the same. Change one of them.",
      "Choose at least one board size.",
    ]);
    const identical: MatchConfig = { ...match, mode: "identical", sizes: [3], pairs: [match.pairs[0], { ...match.pairs[1], a: { image: null, label: "", description: "" } }, { ...match.pairs[2], a: match.pairs[0].a }].map((p) => ({ ...p, b: null })) };
    expect(gameIssues(identical, "beginner")).toEqual(["Pair 2 needs a picture.", "Pairs 1 and 3 have cards that look the same. Change one of them."]);
  });

  it("keeps the built-in pictures in step with the database", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261124000100_youth_activity_games.sql"), "utf8");
    const list = sql.match(/create function youth\.game_art_keys\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/)![1];
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(GAME_ART.map((a) => a.key));
  });

  it("ships complete, original demonstration drafts with Scripture references", () => {
    expect(DEMO_ACTIVITIES.length).toBeGreaterThanOrEqual(3);
    for (const d of DEMO_ACTIVITIES) {
      expect(d.scripture_refs.length).toBeGreaterThan(0);
      expect(d.content_source).toBe("original");
      expect(gameIssues(d.config, d.difficulty)).toEqual([]);
      expect(JSON.stringify(d)).not.toMatch(/<|javascript:/i);
    }
  });
});
