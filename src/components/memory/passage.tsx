import { Attribution, ScriptureText } from "@/components/bible/scripture";
import type { Passage } from "@/lib/memory/types";

/**
 * A memory passage exactly as captured from the approved source, with its
 * translation label and attribution. Editorial titles and notes are shown
 * elsewhere, never mixed into the scripture.
 */
export function PassageText({ passage, className }: { passage: Passage; className?: string }) {
  if (!passage.verses) return null;
  return (
    <div className={className}>
      <ScriptureText
        verses={passage.verses}
        translation={passage.translation}
        label={`${passage.label} (${passage.translation.code})`}
        showChapters={passage.end_chapter > passage.start_chapter}
      />
      <Attribution translation={passage.translation} extra={passage.version > 1 ? `Text version ${passage.version} of this passage.` : null} />
    </div>
  );
}
