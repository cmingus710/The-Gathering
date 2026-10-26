import type { Translation, Verse } from "@/lib/bible/types";

/** Shapes returned by the memory_* database functions (Phase 9). */
export type Activity = "read_repeat" | "flashcards" | "missing_words" | "word_order" | "type_verse" | "self_check";
export type Difficulty = "guided" | "growing" | "challenge";
export type Stage = "new" | "learning" | "reviewing" | "well_known";
export type Confidence = "not_yet" | "partly" | "mostly" | "fully";
export type Quality = "strong" | "partial" | "practice" | "none";

export type MemoryTranslation = {
  id: string;
  code: string;
  name: string;
  attribution: string;
  copyright: string;
  source_url: string | null;
  allow_copy: boolean;
  allow_print: boolean;
  allow_export: boolean;
  status: string;
};

export type Segment = { n: number; label: string; words: number };

export type Passage = {
  id: string;
  label: string;
  ref_key: string;
  version: number;
  text_version: number;
  book: string;
  start_chapter: number;
  start_verse: number;
  end_chapter: number;
  end_verse: number;
  word_count: number;
  segments: Segment[];
  short_segments: Segment[];
  superseded: boolean;
  translation: MemoryTranslation;
  verses: Verse[] | null;
  /** "api": a licensed version; no text is stored, it's fetched on the server when shown. */
  source_kind: "database" | "api";
  /** Licensed versions: one-way fingerprint of the exact wording added. */
  fingerprint: string | null;
  provider_passage_id: string | null;
  verse_numbers: Array<[number, number]> | null;
};

export type Item = {
  id: string;
  collection_id: string;
  position: number;
  title: string | null;
  note: string;
  hint: string | null;
  starts_on: string | null;
  ends_on: string | null;
  retired: boolean;
  passage: Passage;
  /** The collection lets members practice in another stored version. */
  translation_choice?: boolean;
  card?: { id: string; stage: Stage; sessions: number; review_ready: boolean; current_version: boolean; modes?: Activity[]; translation?: { id: string; code: string; name: string } } | null;
  collection?: { id: string; title: string; kind?: string; goal_note?: string | null; goal_sessions_per_week?: number | null };
};

export type Collection = {
  id: string;
  title: string;
  description: string;
  cover_path: string | null;
  cover_alt: string | null;
  audience: "members" | "group" | "personal";
  group_id: string | null;
  group_name: string | null;
  /** source_kind "api": a licensed version; memory_available: its memory practice is permitted now (20261111000100). */
  translation: { id: string; code: string; name: string; source_kind?: "database" | "api"; memory_available?: boolean; memory_modes?: Activity[] };
  /** Members may practice in their own version (false: the collection's version is required). */
  translation_choice: boolean;
  kind: "collection" | "sequence";
  status: "draft" | "published" | "archived";
  publish_at: string | null;
  scheduled: boolean;
  sort_order: number;
  goal_note: string | null;
  goal_sessions_per_week: number | null;
  timezone: string;
  previous_collection_id: string | null;
  published_at: string | null;
  archived_at: string | null;
  updated_at: string;
  item_count: number;
  practiced?: number;
};

export type Card = {
  id: string;
  status: "active" | "removed" | "superseded";
  step: number;
  stage: Stage;
  review_ready: boolean;
  best_step: number;
  due_on: string | null;
  due: boolean;
  sessions: number;
  last_practiced_at: string | null;
  added_at: string;
  previous_card_id: string | null;
  passage: Passage;
  item: { id: string; title: string | null; note: string; hint: string | null; collection: { id: string; title: string; audience: string } } | null;
  update_available: { source: "collection" | "bible"; reason: string | null } | null;
  translation_available: boolean;
  /** Set for verses from a church or group collection. */
  assignment: { translation: TranslationBrief; choice: boolean; own_translation: boolean } | null;
  can_change_translation: boolean;
  /** Practice modes the verse's version allows now (licensed: flashcards and self-check, or all six once permitted). */
  modes: Activity[];
  provider: boolean;
};

export type TranslationBrief = { id: string; code: string; name: string; attribution: string; copyright: string; source_url: string | null; available: boolean };

export type HistoryEntry = {
  activity: Activity;
  difficulty: Difficulty;
  segment: number;
  accuracy: number | null;
  hints: number;
  confidence: Confidence | null;
  quality: Quality;
  step_before: number;
  step_after: number;
  date: string;
  at: string;
  translation: string;
  text_version: number;
};

export type CardDetail = Card & {
  history: HistoryEntry[];
  earlier: Array<{ id: string; version: number; sessions: number; status: string; translation: string; same_translation: boolean }>;
  settings: PracticeSettings;
};

export type PracticeSettings = {
  difficulty: Difficulty;
  presentation: "standard" | "kids";
  ignore_case: boolean;
  ignore_punctuation: boolean;
  celebrations: boolean;
  daily_goal: number | null;
  timezone: string | null;
  effective_timezone: string;
  paused: boolean;
  remind_weekly: boolean;
  remind_review: boolean;
  remind_practice: boolean;
  remind_challenge: boolean;
  reminder_time: string;
  /** The member's stored choice (null: not chosen). */
  default_translation_id: string | null;
  default_translation_available: boolean;
  /** What new verses start with now, and why. */
  effective_translation: (TranslationBrief & { source: "memory" | "reading" | "church" }) | null;
};

/** memory_translations: stored-text versions a member can memorize. */
export type MemoryTranslations = {
  effective_id: string | null;
  source: "memory" | "reading" | "church" | "none";
  church_id: string | null;
  reading_id: string | null;
  items: Array<Translation & { memory_modes: Activity[] }>;
};

export type ChallengeAggregate =
  | { visible: false; min_participants: number; goal: number }
  | { visible: true; participants: number; sessions: number; goal: number; percent: number; through: string | null; min_participants: number };

export type Challenge = {
  id: string;
  title: string;
  description: string;
  starts_on: string;
  ends_on: string;
  goal_sessions: number;
  min_participants: number;
  status: "active" | "ended" | "canceled";
  group: { id: string; name: string } | null;
  collection: { id: string; title: string; visible: boolean } | null;
  me: { joined: boolean; sharing: boolean; joined_at: string; left_at: string | null } | null;
  aggregate: ChallengeAggregate;
  can_manage?: boolean;
};

export type MemoryHome = {
  today: string;
  leads: boolean;
  settings: PracticeSettings;
  assignments: Item[];
  due_count: number;
  card_count: number;
  done_today: number;
  challenges: Array<{ id: string; title: string; ends_on: string; joined: boolean }>;
  recent: Card[];
};

export type ReviewQueue = {
  today: string;
  timezone: string;
  paused: boolean;
  daily_goal: number | null;
  done_today: number;
  due: Card[];
  upcoming: Array<{ date: string; cards: Card[] }>;
  later: number;
};

export type Badge = { key: string; name: string; description: string; earned: boolean; awarded_at: string | null; times: number | null };

export type Progress = {
  today: string;
  verses_practiced: number;
  verses: number;
  stages: Partial<Record<Stage, number>> | null;
  review_ready: number;
  sessions: number;
  sessions_7: number;
  days_28: string[];
  activities: Partial<Record<Activity, number>>;
  collections: Array<{ id: string; title: string; items: number; practiced: number; review_ready: number }>;
  badges: Badge[];
};

/** Public token views served with a session (never hidden answers). */
export type Token = { i: number; t?: string; g: boolean; b: boolean; v?: string; c?: string; w?: boolean; blank?: number; pre?: string; post?: string };

export type SessionSetup = {
  tokens?: Token[];
  direction?: "ref_to_text" | "text_to_ref";
  front?: string;
  hint_count?: number;
  words?: number;
  ignore_case?: boolean;
  ignore_punctuation?: boolean;
  typed?: boolean;
  blank_count?: number;
  bank?: Array<{ text: string; count?: number }> | null;
  chips?: Array<{ id: string; text: string }>;
};

export type Session = {
  id: string;
  card_id: string | null;
  activity: Activity;
  difficulty: Difficulty;
  segment: number;
  segment_count: number;
  short_segments: boolean;
  label: string;
  reference: string;
  hints: number;
  revealed: boolean;
  status: "open" | "submitted" | "expired";
  expires_at: string;
  translation: Pick<MemoryTranslation, "code" | "name" | "attribution" | "copyright" | "source_url" | "allow_copy" | "allow_print">;
  setup: SessionSetup;
  result: SubmitResult | null;
  preview?: boolean;
  answer_text?: string;
  /** A licensed version's activity (its text is never stored). */
  provider?: boolean;
  /** Added by the app's server for a licensed version: the provider's copyright notice and the FUMS token of the passage shown. */
  licensed?: { copyright: string | null; fums_id: string | null };
};

export type TypedOp =
  | { op: "match"; expected: string; typed: string; exact: boolean }
  | { op: "changed"; expected: string; typed: string }
  | { op: "missing"; expected: string }
  | { op: "extra"; typed: string };

export type ReviewChange = "advanced" | "kept" | "eased" | "early" | "practice" | "already_today";

export type SubmitResult = {
  status: "saved";
  saved: true;
  replayed?: boolean;
  session_id: string;
  card_id: string;
  activity: Activity;
  difficulty: Difficulty;
  completed: boolean;
  accuracy: number | null;
  hints: number;
  confidence: Confidence | null;
  quality: Quality;
  recall: boolean;
  details: {
    // missing words
    results?: Array<{ blank: number; correct: boolean; answer: string; expected: string }>;
    // word order
    chips?: number;
    correct?: number;
    // typing
    ops?: TypedOp[];
    matched?: number;
    expected?: number;
    extra?: number;
    reference_detected?: boolean;
    verse_numbers_ignored?: number;
    your_text?: string;
    text?: string;
    ignore_case?: boolean;
    ignore_punctuation?: boolean;
    level?: number;
  };
  review: { change: ReviewChange; step: number; stage: Stage; due_on: string | null; review_ready: boolean };
  badges: Array<{ key: string; name: string; description: string; collection?: string }>;
  done_today: number;
  daily_goal: number | null;
  celebrations: boolean;
};
