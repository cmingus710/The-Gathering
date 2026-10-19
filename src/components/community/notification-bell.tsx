"use client";

import { Bell, MessageCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { useCommunityRealtime } from "./realtime-provider";

/** Count pill: a number in text (never colour alone), capped at 99+. */
export function CountPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-cta px-1.5 text-[0.7rem] font-bold leading-5 text-on-cta ring-2 ring-background",
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
      className={cn("relative flex size-11 items-center justify-center rounded-full bg-surface text-text hover:bg-surface-muted", className)}
      aria-label={label("Notifications", counts.notifications)}
    >
      <Bell className="size-5" aria-hidden="true" />
      <CountPill count={counts.notifications} className="absolute -right-1 -top-1" />
    </Link>
  );
}

export function MessagesLink({ className }: { className?: string }) {
  const { counts } = useCommunityRealtime();
  return (
    <Link
      href="/messages"
      className={cn("relative flex size-11 items-center justify-center rounded-full bg-surface text-text hover:bg-surface-muted", className)}
      aria-label={label("Messages", counts.messages)}
    >
      <MessageCircle className="size-5" aria-hidden="true" />
      <CountPill count={counts.messages} className="absolute -right-1 -top-1" />
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
