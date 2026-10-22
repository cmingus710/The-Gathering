import type { Translation } from "@/lib/bible/types";

/** A version in a memory selector; licensed ones say which practice they allow. */
export function versionLabel(t: Translation) {
  return t.source_kind === "api" ? `${t.name} (${t.code}): licensed, flashcards and self-check only` : `${t.name} (${t.code})`;
}

export const UNAVAILABLE_NOTE =
  "Greyed-out versions are licensed and read from an outside service. They're offered for memory practice only after the church confirms each version's terms allow it.";

/**
 * Readable versions that can't be memorized, listed in a version selector
 * as disabled options so members see why they're missing: licensed versions
 * whose terms the church hasn't confirmed for memory practice (their text is
 * never stored here either way).
 */
export function UnavailableVersionOptions({ items }: { items: Translation[] }) {
  if (!items.length) return null;
  return (
    <optgroup label="Not available for memory practice">
      {items.map((t) => (
        <option key={t.id} value="" disabled>
          {t.name} ({t.code}): not confirmed for memory practice
        </option>
      ))}
    </optgroup>
  );
}
