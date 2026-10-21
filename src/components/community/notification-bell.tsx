"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { CountPill, label } from "./count-pill";
import { NotificationPanel } from "./notification-panel";

export { CountPill };
import { useCommunityRealtime } from "./realtime-provider";

/**
 * Header bell: opens a compact panel of recent notifications. Opening it reads
 * only; a notification is marked read when it's opened (through
 * /notifications/open/<id>, which rechecks access first) or with "Mark all as
 * read". Without JavaScript the bell is a plain link to the full page.
 */
export function NotificationBell({ className }: { className?: string }) {
  return <NotificationPanel className={className} />;
}

export function MessagesLink({ className }: { className?: string }) {
  const { counts } = useCommunityRealtime();
  return (
    <Link
      href="/messages"
      className={cn("relative flex size-11 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-muted", className)}
      aria-label={label("Messages", counts.messages)}
    >
      <Icon name="messages" className="size-6" />
      <CountPill count={counts.messages} className="absolute right-0.5 top-0.5" />
    </Link>
  );
}

/** Trailing count for a navigation link ("Messages 3"). */
export function NavCount({ kind }: { kind: "notifications" | "messages" }) {
  const { counts } = useCommunityRealtime();
  const n = counts[kind];
  if (n <= 0) return null;
  return (
    <>
      <CountPill count={n} className="ml-auto ring-0" />
      <span className="sr-only">({n} unread)</span>
    </>
  );
}
