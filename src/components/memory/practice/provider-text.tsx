"use client";

import { ScriptureText } from "@/components/bible/scripture";
import type { Verse } from "@/lib/bible/types";
import type { Session } from "@/lib/memory/types";

/**
 * A licensed version's passage, revealed during practice: exactly as the
 * provider returned it (verse numbers included), with its copyright. The
 * reveal that fetched it reports the display to API.Bible's usage tracking
 * (once per activity: ./api.ts). Held only in this page's memory; never
 * saved in the browser.
 */
export function ProviderText({ verses, copyright, session, label }: { verses: Verse[]; copyright: string | null; fumsId?: string | null; session: Session; label: string }) {
  return (
    <div>
      <ScriptureText verses={verses} translation={session.translation} label={label} showChapters={new Set(verses.map((v) => v.c)).size > 1} />
      <p className="mt-3 text-meta text-text-secondary">
        {session.translation.code} · {session.translation.name}
        {copyright ? ` · ${copyright}` : ""}
      </p>
    </div>
  );
}
