import type { MentionRef } from "./mentions";

/** Shapes returned by the community_* database functions. */
export type ContentStatus = "visible" | "hidden" | "deleted";
export type ReactionKind = "heart" | "pray" | "amen";
export type Reactions = Record<ReactionKind, { count: number; mine: boolean }>;

export type ThreadCard = {
  id: string;
  title: string | null;
  excerpt: string | null;
  status: ContentStatus;
  author: string | null;
  mine: boolean;
  category: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
  pinned: boolean;
  locked: boolean;
  reply_count: number;
  created_at: string;
  last_activity_at: string;
  following: boolean;
};

export type Post = {
  id: string;
  status: ContentStatus;
  body: string | null;
  author: string | null;
  author_id: string | null;
  mine: boolean;
  created_at: string;
  edited_at: string | null;
  reactions: Reactions | null;
};

/** A photo or video on a discussion or reply (files are served by id through /api/community/attachments). */
export type Attachment = {
  id: string;
  kind: "image" | "video";
  status: string;
  alt_text: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  mime: string;
  sort_order: number;
  post_id: string | null;
};

export type ThreadAttachments = { thread: Attachment[]; posts: Record<string, Attachment[]> };

export type ThreadDetail = ThreadCard & {
  body: string | null;
  edited_at: string | null;
  audience: "church" | "group";
  group_archived: boolean;
  reactions: Reactions | null;
  posts: Post[];
  has_more: boolean;
  can_moderate: boolean;
  can_reply: boolean;
  muted: boolean;
};

export type ThreadPage = { pinned: ThreadCard[]; items: ThreadCard[]; next_cursor: { at: string; id: string } | null };

export type Category = { id: string; name: string; description: string; threads: number; last_activity_at: string | null };

export type GroupMentionNotify = "leaders" | "members" | "off";

export type GroupCard = {
  id: string;
  name: string;
  summary: string;
  image_path: string | null;
  image_alt: string | null;
  visibility: "discoverable" | "hidden";
  accepts_requests: boolean;
  status: "active" | "archived";
  /** "Who can notify this group through @mentions?"; absent before migration 20261108000100. */
  mention_notify?: GroupMentionNotify;
  my_role: "member" | "leader" | null;
  my_request: boolean;
  my_invitation: string | null;
};

export type GroupDetail = GroupCard & {
  is_member: boolean;
  can_manage: boolean;
  is_admin: boolean;
  about: string | null;
  leaders: string[] | null;
  member_count: number | null;
  muted: boolean;
};

export type Roster = {
  members: Array<{ id: string; name: string; role: "member" | "leader"; joined_at: string; me: boolean; can_message: boolean }>;
  requests: Array<{ id: string; name: string; message: string | null; created_at: string }> | null;
  invitations: Array<{ id: string; name: string; expires_at: string; created_at: string }> | null;
  can_manage: boolean;
  is_admin: boolean;
};

export type GroupInvitation = {
  id: string;
  expires_at: string;
  invited_by: string;
  group: { id: string; name: string; summary: string; image_path: string | null; image_alt: string | null };
};

export type Conversation = {
  id: string;
  other_id: string;
  other_name: string;
  last_message_at: string;
  last_from_me: boolean;
  unread: number;
  blocked: boolean;
  muted: boolean;
};

export type Message = { id: string; body: string; mine: boolean; created_at: string };

export type ConversationPage = {
  id: string;
  other_id: string;
  other_name: string;
  messages: Message[];
  has_more: boolean;
  can_send: boolean;
  blocked: boolean;
  muted: boolean;
  last_read_at: string;
};

export type NotificationItem = {
  id: string;
  kind: string;
  category: "forum" | "groups" | "messages" | "moderation" | "events" | "prayer" | "care" | "teaching" | "gallery" | "reading" | "memory" | "youth" | "mentions" | "group_mentions";
  title: string;
  url: string;
  count: number;
  created_at: string;
  read: boolean;
  reason: string | null;
  group_name: string | null;
};

export type NotificationCategory = NotificationItem["category"];
export type Pref = { in_app: boolean; email: "off" | "immediate" | "daily" | "weekly"; push: boolean };

export type MySettings = {
  // Prayer and care appear once the Phase 6 migrations are applied.
  prefs: Partial<Record<NotificationCategory, Pref>> & Record<"forum" | "groups" | "messages" | "moderation" | "events", Pref>;
  timezone: string | null;
  effective_timezone: string;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  dm_allow: "members" | "shared_groups" | "none";
  dm_eligible: boolean;
  guidelines_acked: boolean;
  posting_restricted: boolean;
  messaging_restricted: boolean;
  push_devices: Array<{ id: string; label: string | null; created_at: string; last_success_at: string | null }>;
  mutes: Array<{ type: "thread" | "group" | "conversation"; id: string; label: string | null }>;
};

export type UnreadCounts = { notifications: number; messages: number };

export type ReportSummary = {
  id: string;
  target_type: "thread" | "post" | "message";
  reason: string;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  items: number;
  created_at: string;
  place: string;
  involves_group_leader: boolean;
  reported: string;
};

export type EvidenceItem = {
  type: "thread" | "post" | "message";
  id: string;
  title?: string;
  thread_title?: string;
  body: string;
  author?: string;
  from?: "reporter" | "reported";
  created_at: string;
  edited_at?: string | null;
};

export type ReportDetail = {
  id: string;
  target_type: "thread" | "post" | "message";
  target_ids: string[];
  reason: string;
  details: string | null;
  status: ReportSummary["status"];
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  reporter: string;
  reported: string;
  reported_id: string | null;
  thread_id: string | null;
  group_id: string | null;
  group_name: string | null;
  is_message: boolean;
  involves_group_leader: boolean;
  evidence: EvidenceItem[] | null;
  evidence_cleared_at: string | null;
  current: { status: ContentStatus; locked?: boolean; pinned?: boolean } | null;
  can_restrict: boolean;
  active_restriction: { id: string; scope: string; ends_at: string | null } | null;
  log: Array<{ action: string; actor: string; reason: string | null; at: string }>;
};

export const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "spam", label: "Spam or selling" },
  { value: "privacy", label: "Shares private information" },
  { value: "safety", label: "Someone may be at risk" },
  { value: "other", label: "Something else" },
] as const;

export const REACTIONS: Array<{ kind: ReactionKind; label: string; emoji: string }> = [
  { kind: "heart", label: "Love", emoji: "❤️" },
  { kind: "pray", label: "Praying", emoji: "🙏" },
  { kind: "amen", label: "Amen", emoji: "🙌" },
];

/** One original post in the Community feed (community_feed / community_feed_post). */
export type FeedPost = ThreadCard & {
  body: string | null;
  edited_at: string | null;
  audience: "church" | "group";
  group_archived: boolean;
  reactions: Reactions | null;
  comment_count: number;
  attachments: Attachment[];
  /** People and groups mentioned in the text (null when the text isn't shown); absent before migration 20261107000100. */
  mentions?: MentionRef[] | null;
  can_moderate: boolean;
  can_reply: boolean;
  muted: boolean;
};

export type FeedCursor = { at: string; id: string };

export type FeedPage = {
  items: FeedPost[];
  pinned: Array<{ id: string; title: string; author: string | null; created_at: string }>;
  can_post: boolean;
  next_cursor: FeedCursor | null;
};

/** A reply shown as a comment, with its photos and videos. */
export type Comment = Post & { attachments: Attachment[]; mentions?: MentionRef[] | null };

export type CommentPage = {
  items: Comment[];
  count: number;
  target_found: boolean;
  can_moderate: boolean;
  can_reply: boolean;
  next_cursor: FeedCursor | null;
};

/** Feed shapes with their text already rendered by the safe community renderer. */
export type RenderedPost = FeedPost & { html: string | null };
export type RenderedComment = Comment & { html: string | null };
