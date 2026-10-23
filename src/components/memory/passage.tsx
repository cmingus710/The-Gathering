import { Attribution, ScriptureText } from "@/components/bible/scripture";
import type { Passage } from "@/lib/memory/types";
import { LicensedPassageText } from "./licensed-passage";

/**
 * A memory passage exactly as captured from the approved source, with its
 * translation label and attribution. Editorial titles and notes are shown
 * elsewhere, never mixed into the scripture. A licensed version's passage
 * has no stored text; it's fetched and shown unchanged (LicensedPassageText).
 */
export function PassageText({ passage, className }: { passage: Passage; className?: string }) {
  if (passage.source_kind === "api") return <LicensedPassageText passage={passage} className={className} />;
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
