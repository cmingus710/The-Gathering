"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { useCommunityRealtime } from "./realtime-provider";

/** Count pill: a number in text (never colour alone), capped at 99+. */
export function CountPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold tabular-nums leading-none text-on-primary ring-2 ring-background",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function label(base: string, count: number) {
  return count > 0 ? `${base}, ${count > 99 ? "more than 99" : count} unread` : base;
}

export function NotificationBell({ className }: { className?: string }) {
  const { counts } = useCommunityRealtime();
  return (
    <Link
      href="/notifications"
      className={cn("relative flex size-11 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-muted", className)}
      aria-label={label("Notifications", counts.notifications)}
    >
      <Icon name="notifications" className="size-6" />
      <CountPill count={counts.notifications} className="absolute right-0.5 top-0.5" />
    </Link>
  );
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
