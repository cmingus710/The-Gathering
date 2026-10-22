"use client";

import { useEffect } from "react";

/** The account this page's memory belongs to (survives client-side navigation, not a reload). */
let knownAccount: string | null = null;

/**
 * Client-side navigation keeps earlier pages in memory (the router's
 * back/forward cache, the Community feed's saved position). Signing out is a
 * full page load, which clears all of that, but signing in as someone else
 * in the same tab (after a session expired, for example) is not. When the
 * signed-in account differs from the one this memory was built for, reload
 * so nothing from the previous account can be shown again.
 */
export function AccountBoundary({ accountId }: { accountId: string | null }) {
  useEffect(() => {
    if (!accountId) return;
    if (knownAccount && knownAccount !== accountId) {
      window.location.reload();
      return;
    }
    knownAccount = accountId;
  }, [accountId]);
  return null;
}
