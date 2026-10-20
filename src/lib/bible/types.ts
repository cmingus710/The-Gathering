/**
 * Shapes returned by the bible_* database functions (see the Phase 8
 * migrations). Verse fields are short because chapters are sent whole:
 * c chapter, v verse, t text, o omitted, h heading, p paragraph start,
 * q poetry.
 */
export type Verse = { c: number; v: number; t: string; o: boolean; h: string | null; p: boolean; q: boolean };

export type Translation = {
  id: string;
  code: string;
  name: string;
  language: string;
  source_kind: "database" | "api";
  attribution: string;
  copyright: string;
  source_url: string | null;
  allow_copy: boolean;
  allow_print: boolean;
  allow_export: boolean;
  max_verses_per_view: number;
  tracking_required: boolean;
  text_version: number;
};

export type ProviderConfig = { provider: "api_bible"; ref: string; credential_env: string; cache_days: number | null };

export type ChapterPayload = {
  translation: Translation;
  book: { code: string; name: string; chapters: number };
  chapter: number;
  last_verse: number;
  prev: { book: string; name: string; chapter: number } | null;
  next: { book: string; name: string; chapter: number } | null;
  verses: Verse[] | null;
  provider: ProviderConfig | null;
};

export type PassagePayload = {
  translation: Translation;
  label: string;
  book: string;
  start_chapter: number;
  start_verse: number | null;
  end_chapter: number;
  end_verse: number | null;
  verses: Verse[] | null;
  provider: ProviderConfig | null;
};

export type PlanCard = {
  id: string;
  title: string;
  description: string;
  cover_path: string | null;
  cover_alt: string | null;
  mode: "calendar" | "personal";
  timezone: string;
  audience: "members" | "group";
  audience_note: string | null;
  group_name: string | null;
  status: "draft" | "published" | "archived";
  featured: boolean;
  translation: { id: string; code: string; name: string };
  reading_days: number;
  days: number;
  first_date: string | null;
  last_date: string | null;
  last_day_number: number | null;
  plan_today: string;
};

export type Enrollment = {
  id: string;
  status: "active" | "left";
  is_primary: boolean;
  start_date: string | null;
  expect_from: string | null;
  timezone: string;
  reminders: boolean;
  reminder_time: string;
  reminders_paused: boolean;
  joined_at: string;
  left_at: string | null;
};

export type Progress = {
  today: string;
  total: number;
  completed: number;
  remaining: number;
  due: number;
  behind: number;
  started: boolean;
  finished: boolean;
  day_index: number | null;
};

export type DaySummary = {
  id: string;
  kind: "reading" | "rest" | "catch_up";
  heading: string | null;
  label: string;
  day_number: number | null;
  scheduled: string;
  passages: string[];
  completed: boolean;
};

export type PlanPassage = { id: string; position: number; book: string; sc: number; sv: number | null; ec: number; ev: number | null; label: string };
