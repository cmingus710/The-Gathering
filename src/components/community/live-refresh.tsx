"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCommunityRealtime } from "./realtime-provider";

/**
 * Re-renders the current page from the server after a community signal or
 * reconnect, so the database (with current access rules) decides what is
 * shown. Client state such as an unsent draft is kept.
 */
export function LiveRefresh() {
  const router = useRouter();
  const { version } = useCommunityRealtime();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => router.refresh(), 300);
    return () => window.clearTimeout(t);
  }, [version, router]);
  return null;
}
