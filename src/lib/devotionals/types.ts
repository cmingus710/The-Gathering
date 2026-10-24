import type { ImportReport, Slot } from "./morning-evening";

export type CollectionCover = { asset_id: string; path: string; variant_path: string | null; alt: string; width: number | null; height: number | null } | null;

/** What members see about a collection, including its provenance. */
export type CollectionInfo = {
  id: string;
  key: string;
  title: string;
  subtitle: string;
  author: string;
  description: string;
  cover: CollectionCover;
  attribution: string;
  rights: string;
  rights_statement: string;
  text_source_url: string | null;
  upstream_url: string | null;
  source: { repository: string | null; commit: string | null; path: string | null; sha256: string | null; license: string | null; license_notice: string | null; imported_at: string | null };
};

export type CollectionReading = {
  id: string;
  source_key: string;
  month: number;
  day: number;
  slot: Slot;
  label: string;
  key_verse: string;
  scripture_ref: string;
  body: string;
  updated_at: string;
};

export type ReadingStub = { id: string; slot: Slot; label: string; key_verse?: string; scripture_ref: string };

/** media_collections(): the devotionals page cards. */
export type CollectionCards = {
  today: string;
  local_hour: number;
  collections: Array<Pick<CollectionInfo, "id" | "key" | "title" | "subtitle" | "author" | "cover"> & { today: ReadingStub[] }>;
};

/** media_collection_day(): one screen. */
export type CollectionDay = {
  collection: CollectionInfo;
  today: string;
  local_hour: number;
  timezone: string;
  date: string;
  slot: Slot;
  reading: CollectionReading | null;
  /** February 29 readings, offered beside February 28 in a common year. */
  leap_day: ReadingStub[] | null;
};

/** media_collection_reading(): a direct link. */
export type CollectionReadingPage = { collection: CollectionInfo; today: string; local_hour: number; timezone: string; reading: CollectionReading };

export type CollectionSearch = {
  q: string;
  total: number;
  items: Array<{ id: string; month: number; day: number; slot: Slot; label: string; key_verse: string; scripture_ref: string; snippet: string }>;
};

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
export type CollectionState = "draft" | "hidden" | "scheduled" | "live";

export type ImportResult = {
  staged: number;
  inserted: number;
  updated: number;
  unchanged: number;
  kept_edits: number;
  conflicts: string[];
  not_in_source: string[];
  total: number;
};

export type CollectionImport = {
  id: string;
  status: "staging" | "applied" | "failed" | "discarded";
  source_commit: string;
  source_sha256: string;
  expected_count: number;
  staged: number;
  report: ImportReport;
  result: ImportResult | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  created_by: string | null;
};

export type CollectionAdmin = CollectionInfo & {
  state: CollectionState;
  status: "draft" | "published";
  enabled: boolean;
  publish_at: string | null;
  first_published_at: string | null;
  audience: "members" | "group";
  group_id: string | null;
  group_name: string | null;
  cover_asset_id: string | null;
  cover_alt: string | null;
  updated_at: string;
  readings: number;
  mornings: number;
  evenings: number;
  edited: number;
  months?: Array<{ month: number; readings: number }>;
  imports?: CollectionImport[];
};

export type AdminReadingRow = {
  id: string;
  source_key: string;
  month: number;
  day: number;
  slot: "morning" | "evening";
  label: string;
  key_verse: string;
  scripture_ref: string;
  revision: number;
  edited_at: string | null;
  edited: boolean;
};

type ReadingText = { key_verse: string; scripture_ref: string; body: string };

export type AdminReading = CollectionReading & {
  collection: { id: string; key: string; title: string; state: CollectionState; author: string };
  revision: number;
  edited: boolean;
  edited_at: string | null;
  edited_by: string | null;
  imported: ReadingText;
  incoming: (ReadingText & { import_id: string }) | null;
  revisions: Array<ReadingText & { revision: number; replaced_by: "edit" | "restore" | "import"; changed_at: string; changed_by: string | null }>;
};
