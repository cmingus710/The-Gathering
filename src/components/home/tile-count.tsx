"use client";

import { CountPill } from "@/components/community/notification-bell";
import { useCommunityRealtime } from "@/components/community/realtime-provider";
import { cn } from "@/components/ui/cn";

/** Live unread count on a home tile, with words for screen readers. */
export function TileCount({ kind, className }: { kind: "messages" | "notifications"; className?: string }) {
  const { counts } = useCommunityRealtime();
  const n = counts[kind];
  if (n <= 0) return null;
  return (
    <>
      <CountPill count={n} className={cn("absolute ring-surface", className ?? "right-2.5 top-2.5")} />
      <span className="sr-only">, {n > 99 ? "more than 99" : n} unread</span>
    </>
  );
}
