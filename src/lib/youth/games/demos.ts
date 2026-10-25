import type { Difficulty } from "@/lib/youth/activities";
import type { GameConfig } from "./config";

/**
 * Demonstration activities for the two games, written for the church and
 * illustrated with the built-in pictures. They are created only as private
 * drafts, by an activity editor, from the activities page. Every scene, pair,
 * and explanation names the Scripture it comes from so a reviewer can check
 * it before anything is published; the change note says so too.
 */
export type DemoActivity = {
  key: string;
  title: string;
  summary: string;
  description: string;
  kind: "puzzle" | "matching";
  difficulty: Difficulty;
  age_min: number;
  age_max: number;
  bible_story: string;
  scripture_refs: string[];
  content_source: "original";
  change_note: string;
  config: GameConfig;
};

const REVIEW = "Demonstration draft: check every scene or pair against the Scripture references before publishing.";

export const DEMO_ACTIVITIES: DemoActivity[] = [
  {
    key: "demo_noah_order",
    title: "Noah and the Rainbow Promise",
    summary: "Put five pictures from Noah's story in order, from the ark to the rainbow.",
    description:
      "Read Genesis 6–9 together (or tell the story in your own words), then put the pictures in order.\n\n" +
      "There's no rush. Use **Check my order** whenever you like, and a hint if you get stuck.",
    kind: "puzzle",
    difficulty: "growing",
    age_min: 5,
    age_max: 8,
    bible_story: "Noah and the flood",
    scripture_refs: ["Genesis 6:13-22", "Genesis 7:7-18", "Genesis 8:6-12", "Genesis 9:12-17"],
    content_source: "original",
    change_note: REVIEW,
    config: {
      player: "story_order",
      scenes: [
        {
          id: "build",
          image: { art: "ark" },
          caption: "Noah builds the ark",
          description: "A large wooden boat with a small house on top.",
          clue: "God told Noah what to build before anything else happened.",
          note: "God told Noah to build an ark, and Noah did everything God commanded (Genesis 6:14, 22).",
        },
        {
          id: "animals",
          image: { art: "animals" },
          caption: "The animals go into the ark",
          description: "Two animals walking side by side.",
          clue: "The animals went in once the ark was ready.",
          note: "Animals came to Noah in pairs, male and female, and went into the ark (Genesis 7:8-9).",
        },
        {
          id: "rain",
          image: { art: "rain" },
          caption: "The rain falls and the ark floats",
          description: "A dark cloud with rain falling on waves.",
          clue: "The rain began after everyone was safe inside.",
          note: "Rain fell for forty days and forty nights, and the water lifted the ark (Genesis 7:12, 17).",
        },
        {
          id: "dove",
          image: { art: "dove" },
          caption: "The dove brings back an olive leaf",
          description: "A dove flying with a leaf in its beak.",
          clue: "Noah sent the dove out when the water was going down.",
          note: "Noah sent out a dove, and it came back with a fresh olive leaf (Genesis 8:10-11).",
        },
        {
          id: "rainbow",
          image: { art: "rainbow" },
          caption: "God puts a rainbow in the sky",
          description: "A rainbow arching over the land.",
          clue: "The rainbow came last, as a sign of God's promise.",
          note: "God set the rainbow in the clouds as the sign of his promise never again to flood the whole earth (Genesis 9:13-15).",
        },
      ],
      wrap_up: "God kept Noah and his family safe, and the rainbow reminds us that God keeps his promises.",
    },
  },
  {
    key: "demo_feeding_order",
    title: "Jesus Feeds a Big Crowd",
    summary: "Four pictures from the day Jesus fed more than five thousand people. Can you put them in order?",
    description: "Read John 6:1-13 together, then put the pictures in the order they happened. Take your time.",
    kind: "puzzle",
    difficulty: "beginner",
    age_min: 4,
    age_max: 7,
    bible_story: "Jesus feeds the five thousand",
    scripture_refs: ["John 6:1-13", "Matthew 14:13-21", "Mark 6:30-44", "Luke 9:10-17"],
    content_source: "original",
    change_note: REVIEW,
    config: {
      player: "story_order",
      scenes: [
        {
          id: "crowd",
          image: { art: "crowd" },
          caption: "A big crowd follows Jesus",
          description: "Many people gathered on a grassy hill.",
          clue: "First, lots of people came to see Jesus.",
          note: "A great crowd followed Jesus up the mountainside (John 6:2-5).",
        },
        {
          id: "lunch",
          image: { art: "loaves_fish" },
          caption: "A boy's five loaves and two fish",
          description: "Five round loaves of bread and two fish in a basket.",
          clue: "Andrew found a boy with a little food.",
          note: "Andrew told Jesus about a boy with five small barley loaves and two small fish (John 6:8-9).",
        },
        {
          id: "thanks",
          image: { art: "thanks" },
          caption: "Jesus gives thanks and everyone eats",
          description: "A loaf of bread held up, with lines of light around it.",
          clue: "Jesus thanked God for the food before it was shared.",
          note: "Jesus gave thanks and shared the bread and fish, and everyone had as much as they wanted (John 6:11).",
        },
        {
          id: "baskets",
          image: { art: "baskets" },
          caption: "Twelve baskets of leftovers",
          description: "Three full baskets of bread.",
          clue: "The leftovers were gathered at the very end.",
          note: "The disciples gathered the pieces that were left: twelve baskets full (John 6:12-13).",
        },
      ],
      wrap_up: "A small lunch, given to Jesus, became enough for everyone, with plenty left over.",
    },
  },
  {
    key: "demo_picture_pairs",
    title: "Bible Picture Pairs",
    summary: "Turn over the cards and find the matching pictures from Bible stories.",
    description: "Find two cards with the same picture. Pick a board size to start. Nothing is timed, so play at your own pace.",
    kind: "matching",
    difficulty: "beginner",
    age_min: 4,
    age_max: 8,
    bible_story: "Pictures from Bible stories",
    scripture_refs: ["Genesis 6:14", "Genesis 8:11", "Genesis 9:13", "Matthew 2:9-10", "John 1:29", "John 6:9", "John 10:11"],
    content_source: "original",
    change_note: REVIEW,
    config: {
      player: "bible_match",
      mode: "identical",
      sizes: [3, 4, 6, 8],
      show_moves: false,
      pairs: [
        { id: "ark", a: { image: { art: "ark" }, label: "Ark", description: "" }, b: null, note: "Noah built the ark, just as God told him (Genesis 6:14, 22)." },
        { id: "dove", a: { image: { art: "dove" }, label: "Dove", description: "" }, b: null, note: "The dove brought Noah an olive leaf (Genesis 8:11)." },
        { id: "rainbow", a: { image: { art: "rainbow" }, label: "Rainbow", description: "" }, b: null, note: "The rainbow is the sign of God's promise (Genesis 9:13)." },
        { id: "star", a: { image: { art: "star" }, label: "Star", description: "" }, b: null, note: "A star led the wise men to Jesus (Matthew 2:9-10)." },
        { id: "fish", a: { image: { art: "fish" }, label: "Fish", description: "" }, b: null, note: "A boy's two fish helped feed a crowd (John 6:9)." },
        { id: "bread", a: { image: { art: "bread" }, label: "Bread", description: "" }, b: null, note: "Jesus shared five loaves with everyone (John 6:9-11)." },
        { id: "lamb", a: { image: { art: "lamb" }, label: "Lamb", description: "" }, b: null, note: "John called Jesus the Lamb of God (John 1:29)." },
        { id: "sheep", a: { image: { art: "sheep" }, label: "Sheep", description: "" }, b: null, note: "Jesus is the good shepherd who cares for his sheep (John 10:11)." },
      ],
    },
  },
  {
    key: "demo_who_had_what",
    title: "Who Had What?",
    summary: "Match each Bible person with something from their story.",
    description: "Turn over two cards to find a person and the thing that goes with their story. When you find a pair, read why they belong together.",
    kind: "matching",
    difficulty: "growing",
    age_min: 6,
    age_max: 10,
    bible_story: "People and objects from Bible stories",
    scripture_refs: ["Genesis 6:14", "Exodus 31:18", "1 Samuel 17:40-50", "Jonah 1:17", "Matthew 2:1-10", "John 6:8-9"],
    content_source: "original",
    change_note: REVIEW,
    config: {
      player: "bible_match",
      mode: "related",
      sizes: [3, 4, 6],
      show_moves: true,
      pairs: [
        {
          id: "noah",
          a: { image: { art: "person" }, label: "Noah", description: "" },
          b: { image: { art: "ark" }, label: "Ark", description: "" },
          note: "God told Noah to build an ark to keep his family and the animals safe (Genesis 6:14-19).",
        },
        {
          id: "moses",
          a: { image: { art: "person" }, label: "Moses", description: "" },
          b: { image: { art: "tablets" }, label: "Stone tablets", description: "" },
          note: "God gave Moses two stone tablets with his law written on them (Exodus 31:18).",
        },
        {
          id: "david",
          a: { image: { art: "person" }, label: "David", description: "" },
          b: { image: { art: "sling" }, label: "Sling and stones", description: "" },
          note: "David faced Goliath with a sling and five smooth stones, trusting God (1 Samuel 17:40, 45-50).",
        },
        {
          id: "jonah",
          a: { image: { art: "person" }, label: "Jonah", description: "" },
          b: { image: { art: "big_fish" }, label: "Big fish", description: "" },
          note: "God sent a great fish to swallow Jonah, and Jonah was inside it three days and three nights (Jonah 1:17).",
        },
        {
          id: "wise_men",
          a: { image: { art: "person" }, label: "The wise men", description: "" },
          b: { image: { art: "star" }, label: "Star", description: "" },
          note: "The wise men followed a star to find the child Jesus (Matthew 2:1-2, 9-10).",
        },
        {
          id: "boy",
          a: { image: { art: "person" }, label: "The boy with a lunch", description: "" },
          b: { image: { art: "loaves_fish" }, label: "Five loaves and two fish", description: "" },
          note: "A boy had five small barley loaves and two small fish, and Jesus fed the crowd with them (John 6:8-11).",
        },
      ],
    },
  },
];
