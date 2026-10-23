/**
 * Unsaved writing on the page (a comment being typed, an edited lesson
 * block, …), so a link opened from rendered content can open in a new tab
 * instead of navigating away from it. Each editor registers a check that
 * says whether it currently holds unsaved text.
 */
const checks = new Map<string, () => boolean>();

export function registerUnsaved(key: string, check: () => boolean): () => void {
  checks.set(key, check);
  return () => {
    if (checks.get(key) === check) checks.delete(key);
  };
}

export function hasUnsavedWork(): boolean {
  for (const check of checks.values()) if (check()) return true;
  return false;
}
