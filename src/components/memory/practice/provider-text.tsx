"use client";

import { useEffect } from "react";
import { ScriptureText } from "@/components/bible/scripture";
import { trackFums } from "@/components/bible/fums";
import type { Verse } from "@/lib/bible/types";
import type { Session } from "@/lib/memory/types";

/**
 * A licensed version's passage, revealed during practice: exactly as the
 * provider returned it (verse numbers included), with its copyright, and
 * reported to API.Bible's usage tracking once shown. Held only in this
 * page's memory; never saved in the browser.
 */
export function ProviderText({ verses, copyright, fumsId, session, label }: { verses: Verse[]; copyright: string | null; fumsId: string | null; session: Session; label: string }) {
  useEffect(() => trackFums(fumsId), [fumsId]);
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
