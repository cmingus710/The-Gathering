/**
 * Lesson workbooks (20261031000300): the shapes the database returns, block
 * kinds, and the small pure pieces of the member's autosave (status wording
 * and the on-device copy kept while a save hasn't gone through). Since
 * 20261122000100 a member's answers and notes are My Journal entries
 * (entry_id); the lesson page is one of two places to edit them.
 *
 * Member payloads never contain teacher fields: the database's member
 * projection doesn't select them. The admin shapes below are only returned
 * to content editors.
 */
import { parsePassages, type Passage } from "@/lib/bible/reference";
import type { AutosaveState } from "@/lib/journal/autosave";
import { normalizeReference } from "./scripture";

export const BLOCK_KINDS = [
  "title_intro",
  "scripture",
  "teaching",
  "discussion",
  "response",
  "illustration",
  "image",
  "media",
  "reflection",
  "closing",
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BLOCK_LABEL: Record<BlockKind, string> = {
  title_intro: "Introduction",
  scripture: "Scripture",
  teaching: "Teaching",
  discussion: "Discussion question",
  response: "Response question",
  illustration: "Illustration",
  image: "Image",
  media: "Audio, video, or document",
  reflection: "Reflection",
  closing: "Closing",
};

export const ANSWERABLE: ReadonlySet<BlockKind> = new Set(["discussion", "response", "reflection"]);

export function isBlockKind(v: unknown): v is BlockKind {
  return typeof v === "string" && (BLOCK_KINDS as readonly string[]).includes(v);
}

export type BlockAsset = {
  asset_id: string;
  kind: "audio" | "video" | "image" | "document" | "external_video";
  title: string;
  mime: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  path: string | null;
  variant_path: string | null;
  alt: string;
  provider: "youtube" | "vimeo" | null;
  provider_ref: string | null;
  provider_hash: string | null;
  attribution: string | null;
  captions: Array<{ asset_id: string; language: string; label: string }>;
};

/** A block as members (and the teacher's preview) receive it. */
export type WorkbookBlock = {
  id: string;
  kind: BlockKind;
  position: number;
  heading: string | null;
  body: string;
  prompt: string | null;
  prompt_revision: number;
  answerable: boolean;
  scripture_ref: string | null;
  caption: string | null;
  asset: BlockAsset | null;
};

export type AnswerState = "current" | "changed" | "removed";

export type WorkbookAnswer = {
  /** The My Journal entry holding this answer. */
  entry_id: string;
  block_id: string;
  body: string;
  version: number;
  updated_at: string;
  block_revision: number;
  prompt_snapshot: string;
  state: AnswerState;
};

export type Workbook = {
  preview: boolean;
  available: boolean;
  lesson: {
    id: string;
    title: string;
    summary: string;
    delivered_on: string;
    audience: "public" | "members" | "group";
    scripture_refs: string[];
    series: { id: string; title: string } | null;
    people: Array<{ id: string; name: string; role: string }>;
    group_name: string | null;
  } | null;
  blocks: WorkbookBlock[];
  answers: WorkbookAnswer[];
  note: { entry_id: string; body: string; version: number; updated_at: string } | null;
};

export type WorkbookSummary = {
  item_id: string;
  available: boolean;
  title: string | null;
  delivered_on: string | null;
  answers: number;
  has_note: boolean;
  updated_at: string;
};

/** A block as the builder receives it (teacher fields included). */
export type AdminBlock = {
  id: string;
  kind: BlockKind;
  position: number;
  heading: string | null;
  body: string;
  prompt: string | null;
  scripture_ref: string | null;
  asset_id: string | null;
  caption: string | null;
  alt_text: string | null;
  teacher_only: boolean;
  teacher_note: string;
  revision: number;
  prompt_revision: number;
  answerable: boolean;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  updated_by_name: string | null;
  asset: { id: string; kind: string; title: string; status: string } | null;
};

export type BuilderPayload = {
  lesson: {
    id: string;
    title: string;
    status: "draft" | "scheduled" | "published" | "archived";
    state: "draft" | "scheduled" | "live" | "expired" | "archived";
    audience: "public" | "members" | "group";
    delivered_on: string;
    publish_at: string | null;
    first_published_at: string | null;
    group_name: string | null;
  };
  can_edit: boolean;
  can_publish: boolean;
  blocks: AdminBlock[];
  removed: AdminBlock[];
};

/**
 * A scripture block's reference as passages to fetch. The editor stores the
 * canonical form (normalizeReference); this turns it into book codes and
 * verse ranges, or null when it can't be read (the page then shows the
 * reference and a link to the Bible reader instead of text).
 */
export function scripturePassages(ref: string | null | undefined): Passage[] | null {
  if (!ref) return null;
  const canonical = normalizeReference(ref) ?? ref;
  const parsed = parsePassages(canonical);
  if (!parsed.ok || !parsed.passages.length || parsed.passages.length > 5) return null;
  return parsed.passages;
}

/** Validates a scripture reference typed in the builder. */
export function checkScriptureRef(input: string): { ok: true; ref: string } | { ok: false; error: string } {
  const ref = normalizeReference(input);
  if (!ref) return { ok: false, error: "Enter a reference like John 3:16–18 or Psalm 23." };
  const parsed = parsePassages(ref);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, ref };
}

// ---------------------------------------------------------------------------
// Member autosave
// ---------------------------------------------------------------------------

/** Status line wording for an answer or note. */
export function workbookStatusLabel(s: Pick<AutosaveState, "status">): string {
  switch (s.status) {
    case "saved":
      return "Saved";
    case "unsaved":
      return "Not saved yet";
    case "saving":
      return "Saving…";
    case "retrying":
    case "failed":
    case "offline":
      return "Couldn't save — your text is kept here, retrying";
    case "conflict":
      return "Changed in another tab or device — choose which to keep";
    case "signed_out":
      return "Couldn't save — sign in again; your text is kept here";
  }
}

/**
 * On-device copy of text that hasn't been confirmed saved, so a network
 * failure, a closed tab, or a crash doesn't lose it. Keyed by member,
 * lesson, and block (or "note"); removed as soon as the server confirms the
 * text. Nothing is kept once it is saved.
 */
export type LocalDraft = { text: string; base: number; at: number };

export const DRAFT_PREFIX = "gathering.workbook.v1";

export function draftKey(userId: string, itemId: string, slot: string): string {
  return `${DRAFT_PREFIX}:${userId}:${itemId}:${slot}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(s?: StorageLike | null): StorageLike | null {
  if (s !== undefined) return s;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(key: string, s?: StorageLike | null): LocalDraft | null {
  try {
    const raw = storage(s)?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LocalDraft>;
    if (typeof v.text !== "string" || typeof v.base !== "number" || !Number.isInteger(v.base) || v.base < 0) return null;
    return { text: v.text.slice(0, 10_000), base: v.base, at: typeof v.at === "number" ? v.at : 0 };
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: LocalDraft, s?: StorageLike | null): void {
  try {
    storage(s)?.setItem(key, JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the text is still on screen.
  }
}

export function clearDraft(key: string, s?: StorageLike | null): void {
  try {
    storage(s)?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/**
 * What to do with an on-device copy when the page loads:
 *   none      nothing kept, or it matches what's saved (the copy is stale)
 *   restore   it was written on top of the version that is still saved:
 *             put it back on screen and save it
 *   conflict  the saved text changed since (another tab or device): show
 *             both and let the member choose
 */
export type DraftDecision = { kind: "none" } | { kind: "restore"; text: string } | { kind: "conflict"; text: string };

export function reconcileDraft(server: { body: string; version: number }, local: LocalDraft | null): DraftDecision {
  if (!local || local.text === server.body) return { kind: "none" };
  if (local.base === server.version) return { kind: "restore", text: local.text };
  return { kind: "conflict", text: local.text };
}
