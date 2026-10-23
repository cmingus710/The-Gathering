/**
 * Church-wide push and email settings per notification type, with an "All"
 * override per channel (Church settings → Notifications). The database is the
 * authority: it lists each channel's types, validates changes, and applies the
 * effective setting when notifications are queued and sent (see
 * supabase/migrations/20261112000100_notification_channel_overrides.sql).
 */
export const NOTIFICATION_CHANNELS = ["push", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type ChannelSettings = { all: boolean; types: string[]; disabled: string[] };
export type NotificationChannelsAdmin = Record<NotificationChannel, ChannelSettings> & { membership_alerts_enabled: boolean };

/** Membership approval alerts keep their own switch (in their section); "All" email covers them. */
export const MEMBERSHIP_APPROVAL_TYPE = "membership_approval";

export const ALL_ON_TEXT = "All notification types are enabled. Turn this off to use individual settings.";
export const ALL_OFF_TEXT = "Individual notification settings apply.";

const TYPE_LABELS: Record<string, string> = {
  forum: "Discussions",
  mentions: "Someone is mentioned",
  group_mentions: "A group is mentioned",
  groups: "Groups",
  messages: "Direct messages",
  moderation: "Moderator actions",
  events: "Event updates",
  prayer: "Prayer",
  care: "Care",
  teaching: "Teaching and media",
  gallery: "Media gallery",
  reading: "Bible reading",
  memory: "Memory verses",
  youth: "Youth & Families",
  membership_approval: "Membership approval notifications",
};

/** A readable name for a type; types added later fall back to their key. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Whether the church allows a type on a channel (mirrors community.channel_allows). */
export function channelAllows(settings: Pick<ChannelSettings, "all" | "disabled">, type: string): boolean {
  return settings.all || !settings.disabled.includes(type);
}

export type ChannelSubmission = { channel: NotificationChannel; all: boolean; disabled: string[] | null };

/**
 * Reads one channel's form. While All is on the individual switches are
 * disabled (browsers don't submit them), so `disabled` is null and the stored
 * selections are kept. Otherwise every listed type left unchecked is disabled.
 */
export function readChannelForm(formData: FormData): ChannelSubmission | null {
  const channel = formData.get("channel");
  if (channel !== "push" && channel !== "email") return null;
  const all = formData.get("all") === "on";
  if (all) return { channel, all, disabled: null };
  const listed = String(formData.get("types") ?? "")
    .split(",")
    .filter((t) => /^[a-z_]{1,40}$/.test(t));
  return { channel, all, disabled: listed.filter((t) => formData.get(`type.${t}`) !== "on") };
}
