import type { Translation } from "@/lib/bible/types";

/** A version in a memory selector; licensed ones say which practice they allow. */
export function versionLabel(t: Pick<Translation, "source_kind" | "name" | "code"> & { memory_modes?: readonly string[] }) {
  if (t.source_kind !== "api") return `${t.name} (${t.code})`;
  return t.memory_modes?.includes("missing_words") ? `${t.name} (${t.code}): licensed, all six activities` : `${t.name} (${t.code}): licensed, flashcards and self-check only`;
}

export const UNAVAILABLE_NOTE =
  "Greyed-out versions are licensed and read from an outside service. Each is offered for memory practice only after the church confirms its terms allow it and it's connected on this server.";

const SHORT_REASON: Record<string, string> = {
  not_confirmed: "not confirmed for memory practice",
  not_configured: "not connected on this server",
  not_published: "not published",
};

/**
 * Readable versions that can't be memorized now, listed in a version
 * selector as disabled options so members see why they're missing: licensed
 * versions whose terms the church hasn't confirmed for memory practice, or
 * whose outside service isn't connected (their text is never stored here
 * either way).
 */
export function UnavailableVersionOptions({ items, label = "Not available for memory practice" }: { items: Array<Pick<Translation, "id" | "name" | "code"> & { memory_reason?: string | null }>; label?: string }) {
  if (!items.length) return null;
  return (
    <optgroup label={label}>
      {items.map((t) => (
        <option key={t.id} value="" disabled>
          {t.name} ({t.code}): {SHORT_REASON[t.memory_reason ?? "not_confirmed"] ?? SHORT_REASON.not_confirmed}
        </option>
      ))}
    </optgroup>
  );
}
