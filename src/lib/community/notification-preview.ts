import type { NotificationCategory, NotificationItem } from "./types";

/**
 * What the bell panel may show for one notification. The panel is a glance
 * surface (visible over someone's shoulder, on a shared screen, or in a
 * screenshot), so it carries less than the full Notifications page:
 *
 * - Prayer, care, messages, youth, and moderation never show their title
 *   there, because titles in those categories can name a request, a child, or
 *   a report. They get a generic label; opening it shows the real content
 *   after the usual access check.
 * - Every other title is shortened.
 * - No destination URL is sent: each row opens /notifications/open/<id>,
 *   which rechecks access, marks it read, and only then redirects.
 *
 * Giving never creates notifications.
 */
export const PRIVATE_PREVIEW: Partial<Record<NotificationCategory, string>> = {
  prayer: "Prayer update",
  care: "Care update",
  messages: "New message",
  youth: "Youth & Families update",
  moderation: "Moderation update",
};

export const PREVIEW_TITLE_MAX = 90;

export type NotificationPreview = {
  id: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  /**
   * One short line under the title. Fixed wording chosen by kind only (never
   * names, titles, or message text); private categories use the same
   * generic wording as email and push.
   */
  preview: string;
  /** True when the title was replaced by a generic label. */
  generic: boolean;
  created_at: string;
  read: boolean;
};

/** Short category names for the panel's meta line. */
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  forum: "Discussions",
  groups: "Groups",
  messages: "Messages",
  moderation: "Moderation",
  events: "Events",
  prayer: "Prayer",
  care: "Care",
  teaching: "Teaching",
  gallery: "Photos",
  reading: "Bible reading",
  memory: "Memory verses",
  youth: "Youth & Families",
};

const PRIVATE_LINE: Partial<Record<NotificationCategory, string>> = {
  prayer: "New activity on a prayer request.",
  care: "An update about a care request.",
  messages: "You have a new message.",
  youth: "There's an update in Youth & Families.",
  moderation: "A moderator update about your community activity.",
};

const KIND_LINE: Record<string, string> = {
  reply_followed: "New replies in a discussion you follow.",
  reply_mine: "New replies in your discussion.",
  group_invitation: "You're invited to join a group.",
  group_request: "Someone asked to join a group you lead.",
  group_request_approved: "Your request to join a group was approved.",
  group_request_declined: "Your request to join a group wasn't approved.",
  group_removed: "Your group membership changed.",
  group_role: "Your role in a group changed.",
  event: "An update about an event you're registered for.",
  content_new: "New teaching is available.",
  gallery_new: "New photos in an album you can see.",
  gallery_outcome: "A decision about photos you shared.",
  reading_reminder: "Your Bible reading for today is ready.",
  reading_plan_changed: "Upcoming readings in a plan you follow changed.",
  memory_weekly_verse: "A new weekly memory verse is ready.",
  memory_review_due: "Memory verses are ready to review.",
  memory_practice_reminder: "A reminder to practice your memory verses.",
  memory_challenge_milestone: "A challenge you share in reached a milestone.",
};

export function previewLine(category: NotificationCategory, kind: string): string {
  return PRIVATE_LINE[category] ?? KIND_LINE[kind] ?? "Open to see the details.";
}

/**
 * The panel's filters. Each maps to existing notification categories; there
 * is no "app updates" category in The Gathering, so there is no such filter.
 */
export const PANEL_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "community", label: "Community", categories: ["forum", "groups", "messages", "moderation"] },
  { key: "events", label: "Events", categories: ["events"] },
  { key: "prayer", label: "Prayer & Care", categories: ["prayer", "care"] },
  { key: "teaching", label: "Teaching & Photos", categories: ["teaching", "gallery"] },
  { key: "bible", label: "Bible", categories: ["reading", "memory"] },
  { key: "youth", label: "Youth & Families", categories: ["youth"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; categories?: readonly NotificationCategory[] }>;

export type PanelFilter = (typeof PANEL_FILTERS)[number]["key"];

export function panelFilter(key: string | null | undefined) {
  return PANEL_FILTERS.find((f) => f.key === key) ?? PANEL_FILTERS[0];
}

export function abbreviate(text: string, max = PREVIEW_TITLE_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?“"'‘-]+$/, "")}…`;
}

export function toPreview(n: Pick<NotificationItem, "id" | "kind" | "category" | "title" | "created_at" | "read">): NotificationPreview {
  const generic = PRIVATE_PREVIEW[n.category];
  return {
    id: n.id,
    kind: n.kind,
    category: n.category,
    title: generic ?? abbreviate(n.title || "Notification"),
    preview: previewLine(n.category, n.kind),
    generic: !!generic,
    created_at: n.created_at,
    read: n.read,
  };
}
