import type { Translation } from "@/lib/bible/types";

export const UNAVAILABLE_NOTE = "Licensed versions read from an outside service (shown greyed out) can't be stored for practice, so they aren't available for memory verses.";

/**
 * Readable versions that can't be memorized, listed in a version selector
 * as disabled options so members see why they're missing. Memory practice
 * checks answers against a stored copy of the exact wording, and licensed
 * text read from an outside service is never stored here.
 */
export function UnavailableVersionOptions({ items }: { items: Translation[] }) {
  if (!items.length) return null;
  return (
    <optgroup label="Not available for memory practice">
      {items.map((t) => (
        <option key={t.id} value="" disabled>
          {t.name} ({t.code}): licensed text can&apos;t be stored for practice
        </option>
      ))}
    </optgroup>
  );
}
