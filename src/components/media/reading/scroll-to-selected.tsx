"use client";

import { useEffect } from "react";

/**
 * Brings the selected assignment into view (below the sticky header, which
 * the target's scroll-margin accounts for) and moves focus to it, so links
 * from the Church reading page, the home page, and notifications land on it.
 */
export function ScrollToSelected({ targetId }: { targetId: string }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [targetId]);
  return null;
}
