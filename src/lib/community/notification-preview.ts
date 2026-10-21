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
  category: NotificationCategory;
  title: string;
  /** True when the title was replaced by a generic label. */
  generic: boolean;
  created_at: string;
  read: boolean;
};

export function abbreviate(text: string, max = PREVIEW_TITLE_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?“"'‘-]+$/, "")}…`;
}

export function toPreview(n: Pick<NotificationItem, "id" | "category" | "title" | "created_at" | "read">): NotificationPreview {
  const generic = PRIVATE_PREVIEW[n.category];
  return {
    id: n.id,
    category: n.category,
    title: generic ?? abbreviate(n.title || "Notification"),
    generic: !!generic,
    created_at: n.created_at,
    read: n.read,
  };
}
