"use client";

import { CountPill } from "@/components/community/notification-bell";
import { useCommunityRealtime } from "@/components/community/realtime-provider";

/** Live unread count on a home tile, with words for screen readers. */
export function TileCount({ kind }: { kind: "messages" | "notifications" }) {
  const { counts } = useCommunityRealtime();
  const n = counts[kind];
  if (n <= 0) return null;
  return (
    <>
      <CountPill count={n} className="absolute right-2.5 top-2.5 ring-surface" />
      <span className="sr-only">, {n > 99 ? "more than 99" : n} unread</span>
    </>
  );
}
