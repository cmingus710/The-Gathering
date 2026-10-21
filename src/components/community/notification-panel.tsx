"use client";

import { Bell, BookMarked, BookOpen, BookOpenCheck, CalendarDays, CheckCheck, HandHeart, HandHelping, Images, MessageCircle, MessagesSquare, ShieldAlert, Sprout, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { markReadAction } from "@/app/(member)/notifications/actions";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { relativeTime } from "@/lib/community/format";
import type { NotificationPreview } from "@/lib/community/notification-preview";
import { initialFormState } from "@/lib/forms";
import { CountPill, label } from "./count-pill";
import { useCommunityRealtime } from "./realtime-provider";

const ICON = {
  forum: MessagesSquare,
  groups: UsersRound,
  messages: MessageCircle,
  moderation: ShieldAlert,
  events: CalendarDays,
  prayer: HandHeart,
  care: HandHelping,
  teaching: BookOpen,
  gallery: Images,
  reading: BookOpenCheck,
  memory: BookMarked,
  youth: Sprout,
} as const;

type State =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: NotificationPreview[]; hasMore: boolean }
  | { status: "error" };

async function fetchRecent(): Promise<State | "reload"> {
  try {
    const res = await fetch("/api/community/notifications/recent", { cache: "no-store", credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) return "reload";
    if (!res.ok) return { status: "error" };
    const body = (await res.json()) as { items: NotificationPreview[]; has_more: boolean };
    return { status: "ready", items: body.items, hasMore: body.has_more };
  } catch {
    return { status: "error" };
  }
}

/**
 * Bell + compact notification panel (phones and tablets; desktop has the
 * Notifications link in the sidebar). The list is fetched each time the panel
 * opens and again whenever a Realtime signal arrives while it's open, so new
 * notifications appear in place. Opening the panel never marks anything read.
 *
 * The trigger is a link to /notifications that JavaScript turns into a
 * disclosure button, so it still works before hydration or without scripts.
 */
export function NotificationPanel({ className }: { className?: string }) {
  const { counts, version, refresh } = useCommunityRealtime();
  const pathname = usePathname();
  // Open on the page it was opened on; navigating (a row was chosen, or
  // "View all") closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [state, setState] = useState<State>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const headingId = useId();

  // Fetch while open, and again (quietly) whenever a Realtime signal or a
  // changed count arrives, so new notifications appear in place. A failed
  // background refresh keeps the list already shown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchRecent().then((next) => {
      if (cancelled) return;
      if (next === "reload") window.location.reload();
      else setState((prev) => (next.status === "error" && prev.status === "ready" ? prev : next));
    });
    return () => {
      cancelled = true;
    };
  }, [open, attempt, version, counts.notifications]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const toggle = useCallback(() => {
    if (open) {
      setOpenOn(null);
      return;
    }
    setNote(null);
    setState({ status: "loading" });
    setOpenOn(pathname);
  }, [open, pathname]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpenOn(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  async function markAll() {
    setMarking(true);
    setNote(null);
    const fd = new FormData();
    const result = await markReadAction(initialFormState, fd).catch(() => null);
    setMarking(false);
    if (!result || result.status !== "success") {
      setNote(result?.message ?? "Couldn't mark notifications as read. Try again.");
      return;
    }
    setState((s) => (s.status === "ready" ? { ...s, items: s.items.map((i) => ({ ...i, read: true })) } : s));
    setNote("All caught up.");
    refresh();
  }

  const items = state.status === "ready" ? state.items : null;
  const unreadShown = items ? items.some((i) => !i.read) : false;

  return (
    <div ref={root} className="relative">
      <Link
        ref={trigger}
        href="/notifications"
        prefetch={false}
        role="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label("Notifications", counts.notifications)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn(
          "relative flex size-11 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-muted",
          open && "bg-surface-muted",
          className,
        )}
      >
        <Icon name="notifications" className="size-6" />
        <CountPill count={counts.notifications} className="absolute right-0.5 top-0.5" />
      </Link>

      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        role="region"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={cn(
          "notification-panel fixed z-50 flex flex-col overflow-hidden rounded-card border border-border bg-surface-raised text-text shadow-(--elev-lift) outline-none",
          "inset-x-2 top-[calc(env(safe-area-inset-top,0px)+4.25rem)] max-h-[min(32rem,calc(100dvh-env(safe-area-inset-top,0px)-var(--dock-height)-env(safe-area-inset-bottom,0px)-6rem))]",
          "sm:inset-x-auto sm:right-3 sm:w-[24rem]",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 id={headingId} className="font-display text-lg font-semibold">
            Notifications
            {counts.notifications > 0 ? <span className="sr-only"> ({counts.notifications} unread)</span> : null}
          </h2>
          {unreadShown || counts.notifications > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={marking}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
            >
              <CheckCheck className="size-4" aria-hidden="true" />
              {marking ? "Marking…" : "Mark all as read"}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite" aria-busy={state.status === "loading"}>
          {state.status === "loading" || state.status === "idle" ? (
            <ul aria-label="Loading notifications" className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-14 animate-pulse rounded-tile bg-surface-muted motion-reduce:animate-none" />
              ))}
            </ul>
          ) : state.status === "error" ? (
            <div className="space-y-2 p-4">
              <p>Notifications couldn&apos;t be loaded right now.</p>
              <button type="button" onClick={retry} className="min-h-11 rounded-full border border-border-strong/60 px-4 font-semibold hover:bg-surface-muted">
                Try again
              </button>
            </div>
          ) : !items || items.length === 0 ? (
            <p className="p-4 text-text-secondary">You&apos;re all caught up. New replies, events, and updates will show here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const CategoryIcon = ICON[n.category] ?? Bell;
                return (
                  <li key={n.id}>
                    <a
                      href={`/notifications/open/${n.id}`}
                      className={cn("flex min-h-14 items-start gap-3 px-4 py-2.5 hover:bg-surface-muted", !n.read && "bg-primary-soft/60")}
                    >
                      <CategoryIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className={cn("line-clamp-2 break-words leading-snug", n.read ? "text-text-secondary" : "font-semibold text-text")}>
                          {!n.read ? <span className="sr-only">Unread: </span> : null}
                          {n.title}
                        </span>
                        <span className="block text-meta text-text-secondary">
                          <time dateTime={n.created_at}>{relativeTime(n.created_at)}</time>
                          {n.generic ? " · Open to view" : null}
                        </span>
                      </span>
                      {!n.read ? <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" /> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-1.5">
          {note ? (
            <p role="status" className="py-1 text-meta text-text-secondary">
              {note}
            </p>
          ) : null}
          <Link href="/notifications" prefetch={false} className="flex min-h-11 items-center justify-center font-semibold text-primary hover:underline">
            View all notifications
          </Link>
        </div>
      </div>
    </div>
  );
}
