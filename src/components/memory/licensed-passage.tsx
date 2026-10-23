import type { ReactNode } from "react";
import { FumsReport } from "@/components/bible/fums";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { fetchMemoryText, type MemoryText } from "@/lib/memory/provider";
import type { Passage } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

/** A licensed memory passage's text, fetched now on the server through the existing API.Bible integration (its cache only). */
export async function fetchPassageText(passage: Passage): Promise<MemoryText> {
  const supabase = await requireClient();
  return fetchMemoryText(supabase, passage.translation.id, {
    book: passage.book,
    sc: passage.start_chapter,
    sv: passage.start_verse,
    ec: passage.end_chapter,
    ev: passage.end_verse,
  });
}

/**
 * A licensed version's memory passage (collections and assignments): no
 * text is stored, so it's fetched when shown, displayed exactly as returned
 * with the provider's copyright, and reported to API.Bible's usage
 * tracking. When the fetched wording no longer matches the wording the
 * verse was added with (fingerprint), `changed` is shown below it. During an
 * outage the version is named as unavailable; no other version is shown.
 */
export async function LicensedPassageText({ passage, className, changed }: { passage: Passage; className?: string; changed?: ReactNode }) {
  const text = await fetchPassageText(passage);
  if (text.status !== "ok") {
    return <p className={className ?? "text-text-secondary"}>{text.status === "stored" ? null : text.message}</p>;
  }
  const differs = Boolean(passage.fingerprint) && text.payload.fingerprint !== passage.fingerprint;
  return (
    <div className={className}>
      <ScriptureText verses={text.verses} translation={text.translation} label={`${passage.label} (${passage.translation.code})`} showChapters={passage.end_chapter > passage.start_chapter} />
      <Attribution translation={text.translation} extra={text.copyright} />
      <FumsReport id={text.fumsId} />
      {differs
        ? (changed ?? (
            <p className="mt-3 rounded-tile border border-primary/50 bg-primary-soft/40 p-3 text-meta">
              The publisher has revised this wording since it was assigned. The text above is the current wording; practice keeps to the wording you added until you
              choose the new one on the verse&apos;s page.
            </p>
          ))
        : null}
    </div>
  );
}
