/**
 * @mentions in Community posts and comments.
 *
 * Stored text carries each mention as `@[Display name](mention:<member id>)`
 * (the database validates every id on save and records it; see
 * 20261107000100_community_mentions.sql). Only that markup is a mention:
 * an email address or "@home" typed by hand stays plain text.
 *
 * In the composer the member sees and edits plain text ("@Ann Rivers") while
 * the mentions are tracked as ranges over it; `serializeMentions` turns the
 * two back into markup for saving. Typing inside a mention, or deleting part
 * of it, removes the whole mention, so a half-edited name never stays linked.
 */
export const MENTION_LIMIT = 10;
export const MENTION_LABEL_MAX = 80;

/** Matches one mention: 1 = label, 2 = member id (same shape the database accepts). */
export const MENTION_SOURCE = String.raw`@\[([^\[\]\n]{1,80})\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`;

export type Mention = { id: string; name: string; start: number; end: number };

/** A mention as returned with a post or comment: the member's current name (null when they can't be shown) and whether their directory entry may be linked. */
export type MentionRef = { id: string; name: string | null; listed: boolean };

/** A suggestion in the composer's list. */
export type MentionSuggestion = { id: string; name: string; photoUrl: string | null; detail: string | null };

/** A label safe to put inside the markup's brackets. */
export function mentionLabel(name: string): string {
  const clean = name.replace(/[[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MENTION_LABEL_MAX).trim();
  return clean || "Member";
}

export function mentionMarkup(name: string, id: string): string {
  return `@[${mentionLabel(name)}](mention:${id.toLowerCase()})`;
}

/** Markup → the text the member edits, with each mention's range in it. */
export function parseMentions(markup: string): { text: string; mentions: Mention[] } {
  const re = new RegExp(MENTION_SOURCE, "g");
  const mentions: Mention[] = [];
  let text = "";
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    text += markup.slice(last, m.index);
    const shown = `@${m[1]}`;
    mentions.push({ id: m[2].toLowerCase(), name: m[1], start: text.length, end: text.length + shown.length });
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
    out += text.slice(last, m.start) + mentionMarkup(m.name, m.id);
    last = m.end;
  }
  return out + text.slice(last);
}

/** Different people mentioned (the limit counts people, not mentions). */
export function mentionedPeople(mentions: Mention[]): number {
  return new Set(mentions.map((m) => m.id)).size;
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

/** Replaces the typed "@query" with a mention of the chosen member. */
export function insertMention(
  text: string,
  mentions: Mention[],
  at: { start: number; end: number },
  person: { id: string; name: string },
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
  return markup.replace(new RegExp(MENTION_SOURCE, "g"), "@$1");
}
