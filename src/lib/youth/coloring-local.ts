/**
 * On-device copy of a child's coloring that the server hasn't confirmed yet,
 * so a dropped connection, a closed tab, or a crash doesn't lose it. It is
 * not offline support: the page itself still needs the connection to open.
 *
 * Keyed by the signed-in account, the child, and the activity version
 * (gathering.coloring.v1:<account>:<child>:<version>), so another account or
 * another child on a shared device never sees it. Removed as soon as the
 * server confirms the picture, when the studio opens under a different
 * account, after 30 days, and on sign-out (purgeColoringDrafts).
 */
export const COLORING_PREFIX = "gathering.coloring.v1";
/** Set on sign-out so studios open in other tabs stop keeping copies (they hear it as a storage event). */
export const SIGNED_OUT_KEY = "gathering.signed-out";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 400_000;

export type ColoringDraft = { doc: string; base: number; at: number };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function storage(s?: StorageLike | null): StorageLike | null {
  if (s !== undefined) return s;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function coloringKey(accountId: string, childId: string, versionId: string): string {
  return `${COLORING_PREFIX}:${accountId}:${childId}:${versionId}`;
}

export function readColoringDraft(key: string, s?: StorageLike | null): ColoringDraft | null {
  try {
    const raw = storage(s)?.getItem(key);
    if (!raw || raw.length > MAX_CHARS + 200) return null;
    const v = JSON.parse(raw) as Partial<ColoringDraft>;
    if (typeof v.doc !== "string" || typeof v.base !== "number" || !Number.isInteger(v.base) || v.base < 0) return null;
    return { doc: v.doc, base: v.base, at: typeof v.at === "number" ? v.at : 0 };
  } catch {
    return null;
  }
}

/** False when the device's storage is full or blocked (the picture is still on screen). */
export function writeColoringDraft(key: string, draft: ColoringDraft, s?: StorageLike | null): boolean {
  try {
    const st = storage(s);
    if (!st || draft.doc.length > MAX_CHARS) return false;
    st.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearColoringDraft(key: string, s?: StorageLike | null): void {
  try {
    storage(s)?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/**
 * Removes on-device coloring copies: all of them (sign-out), or those of
 * any other account and any older than 30 days (`keepAccount`).
 */
export function purgeColoringDrafts(opts: { keepAccount?: string; now?: number } = {}, s?: StorageLike | null): number {
  const st = storage(s);
  if (!st) return 0;
  if (!opts.keepAccount) {
    try {
      st.setItem(SIGNED_OUT_KEY, String(opts.now ?? Date.now()));
    } catch {
      // Other tabs then clear their copy when they next open a studio under another account.
    }
  }
  const now = opts.now ?? Date.now();
  const doomed: string[] = [];
  try {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k || !k.startsWith(`${COLORING_PREFIX}:`)) continue;
      const account = k.split(":")[1];
      if (!opts.keepAccount || account !== opts.keepAccount) {
        doomed.push(k);
        continue;
      }
      const d = readColoringDraft(k, st);
      if (!d || now - d.at > MAX_AGE_MS) doomed.push(k);
    }
    for (const k of doomed) st.removeItem(k);
  } catch {
    return 0;
  }
  return doomed.length;
}

/**
 * What to do with an on-device copy when the studio opens:
 *   none      nothing kept, or it matches what's saved
 *   restore   made on top of the revision that is still saved: put it back and save it
 *   conflict  the saved picture changed since (another tab or device): let them choose
 */
export type ColoringDecision = { kind: "none" } | { kind: "restore"; doc: string } | { kind: "conflict"; doc: string };

export function reconcileColoring(server: { doc: string; revision: number }, local: ColoringDraft | null): ColoringDecision {
  if (!local || local.doc === server.doc) return { kind: "none" };
  if (local.base === server.revision) return { kind: "restore", doc: local.doc };
  return { kind: "conflict", doc: local.doc };
}
