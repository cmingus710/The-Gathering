/** Shapes returned by the media_* database functions (see the Phase 7 migrations). */
export type ItemKind = "devotional" | "lesson" | "episode" | "book" | "assignment" | "playlist";
export type Audience = "public" | "members" | "group";
export type ItemState = "draft" | "scheduled" | "live" | "expired" | "archived";
export type AssetKind = "audio" | "video" | "image" | "document" | "captions" | "external_video";

export type Cover = { asset_id: string; path: string; variant_path: string | null; alt: string; width: number | null; height: number | null };
export type Person = { id: string; name: string; role: "author" | "speaker" | "host" | "contributor" };

export type ItemCard = {
  id: string;
  kind: ItemKind;
  title: string;
  summary: string;
  audience: Audience;
  featured: boolean;
  publish_at: string | null;
  devotional_on: string | null;
  delivered_on: string | null;
  starts_on: string | null;
  ends_on: string | null;
  episode_number: number | null;
  season_number: number | null;
  book_author: string | null;
  book_current: boolean;
  spotify_id: string | null;
  scripture_refs: string[];
  tags: string[];
  cover: Cover | null;
  series: { id: string; title: string } | null;
  show: { id: string; title: string } | null;
  book: { id: string; title: string; book_author: string | null } | null;
  people: Person[];
  media: { audio: boolean | null; video: boolean | null; duration_seconds: number | null } | null;
  bookmarked: boolean;
  completed: boolean;
};

export type Caption = { asset_id: string; language: string; label: string };

export type Attachment = {
  asset_id: string;
  role: "audio" | "video" | "handout" | "slides" | "resource";
  label: string;
  title: string;
  kind: AssetKind;
  mime: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  members_only: boolean;
  public_ok: boolean;
  status: string;
  provider: "youtube" | "vimeo" | null;
  provider_ref: string | null;
  provider_hash: string | null;
  external_url: string | null;
  path: string | null;
  has_transcript: boolean;
  rights?: string | null;
  rights_confirmed: boolean;
  attribution: string | null;
  captions: Caption[];
};

export type ItemDetail = ItemCard & {
  body: string;
  notes: string;
  questions: string[];
  instructions: string | null;
  attribution: string | null;
  audible_url: string | null;
  group_name: string | null;
  topics: Array<{ id: string; name: string }>;
  attachments: Attachment[];
  related: ItemCard[];
  discussion: { thread_id: string; title: string; replies: number; group: string | null } | null;
  progress: Record<string, { position: number; completed: boolean }>;
  assignments: ItemCard[] | null;
};

export type ItemAdmin = {
  id: string;
  kind: ItemKind;
  title: string;
  summary: string;
  body: string;
  notes: string;
  questions: string[];
  cover_asset_id: string | null;
  cover_alt: string | null;
  status: "draft" | "scheduled" | "published" | "archived";
  state: ItemState;
  publish_at: string | null;
  expires_at: string | null;
  audience: Audience;
  group_id: string | null;
  group_name: string | null;
  featured: boolean;
  sort_order: number;
  series_id: string | null;
  tags: string[];
  scripture_refs: string[];
  attribution: string | null;
  devotional_on: string | null;
  delivered_on: string | null;
  show_id: string | null;
  episode_number: number | null;
  season_number: number | null;
  book_author: string | null;
  audible_url: string | null;
  book_current: boolean;
  book_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  instructions: string | null;
  spotify_id: string | null;
  discussion_thread_id: string | null;
  notify: boolean;
  notified_at: string | null;
  first_published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
  cover: Cover | null;
  people: Person[];
  topics: Array<{ id: string; name: string }>;
  attachments: Attachment[];
  links: Array<{ id: string; kind: ItemKind; title: string; state: ItemState }>;
  series: { id: string; title: string } | null;
  show: { id: string; title: string; status: string; audience: Audience } | null;
  book: { id: string; title: string } | null;
  discussion: { thread_id: string; title: string; group_id: string | null; group: string | null } | null;
  rights_missing: string[];
  members_only_files: string[];
};

export type AssetRow = {
  id: string;
  kind: AssetKind;
  status: "uploading" | "processing" | "ready" | "failed" | "removed";
  title: string;
  path: string | null;
  variant_path: string | null;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  duration_source: string | null;
  alt_text: string | null;
  parent_id: string | null;
  language: string | null;
  label: string | null;
  has_transcript: boolean;
  provider: "youtube" | "vimeo" | null;
  provider_ref: string | null;
  provider_hash: string | null;
  external_url: string | null;
  public_ok: boolean;
  rights: "unknown" | "church_owned" | "licensed" | "permission" | "public_domain";
  source: string | null;
  attribution: string | null;
  rights_notes: string | null;
  rights_confirmed_at: string | null;
  error: string | null;
  created_at: string;
  ready_at: string | null;
  replaced_by: string | null;
  usage_count?: number;
};

export type AssetDetail = AssetRow & {
  transcript: string | null;
  usage: Array<{ type: "item" | "show" | "series"; id: string; kind: string; title: string; status: string; role: string }>;
  captions: AssetRow[];
  rights_confirmed_by: string | null;
  created_by: string | null;
};

export type Show = {
  id: string;
  kind: "church" | "external";
  title: string;
  description: string;
  author: string | null;
  artwork_url: string | null;
  website_url: string | null;
  artwork: { asset_id: string; path: string; variant_path: string | null; alt: string } | null;
  provider: "spotify" | "apple" | null;
  provider_url: string | null;
  provider_ref: string | null;
  allow_stream: boolean;
  featured: boolean;
  audience: Audience;
  public_feed: boolean;
  episode_count: number;
  latest_at: string | null;
  bookmarked: boolean;
};

export type ExternalEpisode = {
  id: string;
  show_id: string;
  show_title: string;
  title: string;
  description: string;
  link: string | null;
  artwork_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  audio_url: string | null;
  audio_type: string | null;
  provider: "spotify" | "apple" | null;
  provider_url: string | null;
  provider_ref: string | null;
  progress?: { position: number; completed: boolean } | null;
};

export type EpisodeEntry = (ItemCard & { type: "church" }) | (ExternalEpisode & { type: "external" });

export type Album = {
  id: string;
  title: string;
  description: string;
  album_on: string | null;
  audience: Audience;
  group_name: string | null;
  uploads_open: boolean;
  status: string;
  event: { series_id: string; title: string } | null;
  cover: { photo_id: string; thumb_path: string; alt: string } | null;
  photo_count: number;
  can_upload: boolean;
};

export type Photo = {
  id: string;
  album_id: string;
  status: "uploading" | "processing" | "pending" | "approved" | "rejected" | "hidden" | "removed" | "failed";
  caption: string;
  alt_text: string;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: string;
  approved_at: string | null;
  mine: boolean;
  display_path: string | null;
  thumb_path: string | null;
  review_display_path: string | null;
  review_thumb_path: string | null;
  review_reason: string | null;
  uploader?: string | null;
  minors?: string | null;
  permission_confirmed?: boolean | null;
  caption_edited_at?: string | null;
  open_reports?: number | null;
};

/** One episode on the Podcasts landing page (media_podcast_episodes), with what it needs to play in place. */
export type PodcastEpisode =
  | (ItemCard & { type: "church"; play: Attachment | null; progress: { position: number; completed: boolean } | null })
  | (ExternalEpisode & { type: "external" });
