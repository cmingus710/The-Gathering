/**
 * @mentions in Community posts and comments and in prayer requests and
 * prayer comments: one shared set of helpers for both.
 *
 * Stored text carries each mention as `@[Display name](mention:<member id>)`
 * or, for a group, `@[Group name](group:<group id>)` (the database validates
 * every id on save and records it; see 20261107000100_community_mentions.sql
 * and 20261108000100_mentions_groups_prayer.sql). Only that markup is a
 * mention: an email address or "@home" typed by hand stays plain text.
 *
 * In the composer the member sees and edits plain text ("@Ann Rivers") while
 * the mentions are tracked as ranges over it; `serializeMentions` turns the
 * two back into markup for saving. Typing inside a mention, or deleting part
 * of it, removes the whole mention, so a half-edited name never stays linked.
 */
export const MENTION_LIMIT = 10;
/** The default group limit; the church can change it (community.settings), and the server enforces it. */
export const GROUP_MENTION_LIMIT = 3;
export const MENTION_LABEL_MAX = 80;

/** Matches one mention: 1 = label, 2 = member id (same shape the database accepts). */
export const MENTION_SOURCE = String.raw`@\[([^\[\]\n]{1,80})\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`;

/** Matches one person or group mention: 1 = label, 2 = "mention" | "group", 3 = id. */
export const ANY_MENTION_SOURCE = String.raw`@\[([^\[\]\n]{1,80})\]\((mention|group):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`;

export type MentionKind = "member" | "group";

export type Mention = { id: string; name: string; start: number; end: number; kind?: MentionKind };

/**
 * A mention as returned with a post, comment, or prayer request: the current
 * name (null when it can't be shown to this reader) and whether it may be
 * linked (a member's directory entry, or a group the reader may see).
 * `kind` is absent for people.
 */
export type MentionRef = { id: string; name: string | null; listed: boolean; kind?: MentionKind };

/** A person in the composer's list. */
export type MentionSuggestion = { id: string; name: string; photoUrl: string | null; detail: string | null };

/**
 * Whether choosing a group notifies its members: `notify` (and `reach`
 * people), or why not: only leaders and moderators may (`leaders`), only
 * members may (`members`), the group turned it off (`off`), or the post is
 * anonymous (`anonymous`).
 */
export type GroupNotify = "notify" | "leaders" | "members" | "off" | "anonymous";

/** A group in the composer's list. */
export type GroupSuggestion = { id: string; name: string; imageUrl: string | null; notify: GroupNotify; reach: number | null };

export type MentionSuggestions = { members: MentionSuggestion[]; groups: GroupSuggestion[]; unavailable?: "team" | "private" | null };

const kindOf = (k: string | undefined): MentionKind => (k === "group" ? "group" : "member");

/** A label safe to put inside the markup's brackets. */
export function mentionLabel(name: string): string {
  const clean = name.replace(/[[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MENTION_LABEL_MAX).trim();
  return clean || "Member";
}

export function mentionMarkup(name: string, id: string, kind: MentionKind = "member"): string {
  return `@[${mentionLabel(name)}](${kind === "group" ? "group" : "mention"}:${id.toLowerCase()})`;
}

/** Markup → the text the member edits, with each mention's range in it. */
export function parseMentions(markup: string): { text: string; mentions: Mention[] } {
  const re = new RegExp(ANY_MENTION_SOURCE, "g");
  const mentions: Mention[] = [];
  let text = "";
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    text += markup.slice(last, m.index);
    const shown = `@${m[1]}`;
    const found: Mention = { id: m[3].toLowerCase(), name: m[1], start: text.length, end: text.length + shown.length };
    if (m[2] === "group") found.kind = "group";
    mentions.push(found);
    text += shown;
    last = m.index + m[0].length;
  }
  return { text: text + markup.slice(last), mentions };
}

/** The text the member edits plus its mention ranges → markup for saving. */
export function serializeMentions(text: string, mentions: Mention[]): string {
  let out = "";
  let last = 0;
  for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
    if (m.start < last || text.slice(m.start, m.end) !== `@${m.name}`) continue;
    out += text.slice(last, m.start) + mentionMarkup(m.name, m.id, kindOf(m.kind));
    last = m.end;
  }
  return out + text.slice(last);
}

/** Different people mentioned (the limit counts people, not mentions). */
export function mentionedPeople(mentions: Mention[]): number {
  return new Set(mentions.filter((m) => kindOf(m.kind) === "member").map((m) => m.id)).size;
}

/** Different groups mentioned. */
export function mentionedGroups(mentions: Mention[]): number {
  return new Set(mentions.filter((m) => m.kind === "group").map((m) => m.id)).size;
}

/**
 * Carries mention ranges across one edit of the text. Ranges before the
 * change stay, ranges after it shift, and a range the change touches is
 * dropped; when the change only deleted text, the rest of that mention is
 * deleted too, so one Backspace removes "@Ann Rivers" entirely.
 */
export function applyTextEdit(prev: string, next: string, mentions: Mention[]): { text: string; mentions: Mention[] } {
  if (prev === next) return { text: next, mentions };
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd--;
    nextEnd--;
  }
  // A typed character right after a mention ("@Ann" + "a") isn't part of it,
  // and one right before it ("x" + "@Ann") isn't either.
  const touched = (m: Mention) => (prevEnd === start ? m.start < start && start < m.end : m.start < prevEnd && start < m.end);
  const hit = mentions.filter(touched);
  if (hit.length && nextEnd === start) {
    // A pure deletion that cut into mentions: delete those mentions whole.
    const from = Math.min(start, ...hit.map((m) => m.start));
    const to = Math.max(prevEnd, ...hit.map((m) => m.end));
    const text = prev.slice(0, from) + prev.slice(to);
    const delta = to - from;
    return {
      text,
      mentions: mentions.filter((m) => !hit.includes(m)).map((m) => (m.start >= to ? { ...m, start: m.start - delta, end: m.end - delta } : m)),
    };
  }
  const delta = nextEnd - prevEnd;
  return {
    text: next,
    mentions: mentions
      .filter((m) => !touched(m))
      .map((m) => (m.start >= prevEnd && !(prevEnd === start && m.start < start) ? { ...m, start: m.start + delta, end: m.end + delta } : m)),
  };
}

/**
 * The mention being typed at the caret: an "@" at the start of the text or
 * after a space, bracket, or quote (so "rob@example.org" never starts one),
 * followed by up to three words of a name. Null when there isn't one.
 */
export function findMentionQuery(text: string, caret: number, mentions: Mention[] = []): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(“"'‘])@([^\s@[\]()]{1,30}(?: [^\s@[\]()]{1,30}){0,2})$/u.exec(before);
  if (!m) return null;
  const start = caret - m[2].length - 1;
  // Already inside a finished mention.
  if (mentions.some((x) => x.start <= start && start < x.end)) return null;
  return { start, query: m[2] };
}

/** Replaces the typed "@query" with a mention of the chosen member or group. */
export function insertMention(
  text: string,
  mentions: Mention[],
  at: { start: number; end: number },
  person: { id: string; name: string; kind?: MentionKind },
): { text: string; mentions: Mention[]; caret: number } {
  const name = mentionLabel(person.name);
  const shown = `@${name}`;
  const after = text.slice(at.end);
  const spacer = /^\s/.test(after) ? "" : " ";
  const nextText = text.slice(0, at.start) + shown + spacer + after;
  const delta = shown.length + spacer.length - (at.end - at.start);
  const shifted = mentions
    .filter((m) => m.end <= at.start || m.start >= at.end)
    .map((m) => (m.start >= at.end ? { ...m, start: m.start + delta, end: m.end + delta } : m));
  const added: Mention = { id: person.id.toLowerCase(), name, start: at.start, end: at.start + shown.length };
  if (person.kind === "group") added.kind = "group";
  return { text: nextText, mentions: [...shifted, added].sort((a, b) => a.start - b.start), caret: at.start + shown.length + spacer.length };
}

/** Removes one mention and its text (the chip's remove button). */
export function removeMention(text: string, mentions: Mention[], target: Mention): { text: string; mentions: Mention[] } {
  let end = target.end;
  if (text[end] === " " && (target.start === 0 || /\s/.test(text[target.start - 1]))) end++;
  const delta = end - target.start;
  return {
    text: text.slice(0, target.start) + text.slice(end),
    mentions: mentions.filter((m) => m !== target).map((m) => (m.start >= end ? { ...m, start: m.start - delta, end: m.end - delta } : m)),
  };
}

/** Plain text for places that can't show links (previews): "@Name". */
export function mentionsAsText(markup: string): string {
  return markup.replace(new RegExp(ANY_MENTION_SOURCE, "g"), "@$1");
}
