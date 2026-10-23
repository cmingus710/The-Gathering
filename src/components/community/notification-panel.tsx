"use client";

import {
  AtSign,
  Bell,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  CheckCheck,
  ExternalLink,
  HandHeart,
  HandHelping,
  Images,
  MessageCircle,
  MessagesSquare,
  ShieldAlert,
  Sprout,
  Trash2,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clearReadAction, markReadAction, undoClearReadAction } from "@/app/(app)/(member)/notifications/actions";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/components/ui/cn";
import { CATEGORY_LABEL, PANEL_FILTERS, type NotificationPreview, type PanelFilter } from "@/lib/community/notification-preview";
import { DAY_GROUP_LABEL, groupByDay, panelTime } from "@/lib/community/notification-time";
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
  mentions: AtSign,
  group_mentions: UsersRound,
} as const;

type Page = { items: NotificationPreview[]; has_more: boolean; timezone: string; has_read: boolean };

type List =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: NotificationPreview[]; hasMore: boolean; more: "idle" | "loading" | "error" };

type Note = { tone: "ok" | "error"; text: string; undoAt?: string };

async function fetchPage(filter: PanelFilter, after?: NotificationPreview): Promise<Page | "reload" | null> {
  const qs = new URLSearchParams({ filter });
  if (after) {
    qs.set("before", after.created_at);
    qs.set("before_id", after.id);
  }
  try {
    const res = await fetch(`/api/community/notifications/recent?${qs}`, { cache: "no-store", credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) return "reload";
    if (!res.ok) return null;
    return (await res.json()) as Page;
  } catch {
    return null;
  }
}

/** Newest-first order by (time, id), the same as the database's. */
const newer = (a: NotificationPreview, b: NotificationPreview) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);

/**
 * A fresh first page merged over what's already loaded: the fresh page wins
 * for its range (new items, read state, removals), and older pages loaded
 * with "load more" are kept below it.
 */
function mergeFresh(fresh: Page, prev: List): { items: NotificationPreview[]; hasMore: boolean } {
  if (prev.status !== "ready" || !fresh.items.length || !fresh.has_more) return { items: fresh.items, hasMore: fresh.has_more };
  const last = fresh.items[fresh.items.length - 1];
  const ids = new Set(fresh.items.map((i) => i.id));
  const older = prev.items.filter((i) => !ids.has(i.id) && newer(last, i));
  return { items: [...fresh.items, ...older], hasMore: older.length ? prev.hasMore : fresh.has_more };
}

/**
 * Bell + notification panel, anchored under the bell in the header (phones
 * and tablets) and in the top bar (desktop).
 *
 * - A non-modal dialog: the bell reports its expanded state; Escape, an
 *   outside click, or tabbing away closes it; Escape returns focus to the
 *   bell. Filters are a tab list (arrow keys, Home, End).
 * - Opening it never marks anything read. A row opens
 *   /notifications/open/<id>, which rechecks access, marks it read, and only
 *   then redirects. "Mark all as read" and "Clear read" act on all of the
 *   member's notifications, in every category.
 * - The list loads one page at a time (more on scroll), refreshes quietly on
 *   each Realtime signal or count change while open, and keeps the reader's
 *   place when new items arrive above.
 *
 * The trigger is a link to /notifications that JavaScript turns into a
 * disclosure button, so it still works before hydration or without scripts.
 */
export function NotificationPanel({ className }: { className?: string }) {
  const { counts, version, refresh } = useCommunityRealtime();
  const pathname = usePathname();
  // Open on the page it was opened on; navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [filter, setFilter] = useState<PanelFilter>("all");
  const [list, setList] = useState<List>({ status: "loading" });
  const [timezone, setTimezone] = useState("UTC");
  const [hasRead, setHasRead] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"mark" | "clear" | "undo" | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const tabs = useRef<Map<PanelFilter, HTMLButtonElement>>(new Map());
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const listRef = useRef(list);
  useLayoutEffect(() => {
    listRef.current = list;
  }, [list]);

  const panelId = useId();
  const headingId = useId();
  const listId = useId();

  // Where to put the panel: just under the bell, right edges aligned (phones
  // use the full width minus margins through CSS).
  const measure = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPlace({ top: Math.round(r.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - r.right - 4)) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure]);

  // Remember the first visible row before a background refresh so new rows
  // arriving above it don't move what the reader is looking at.
  const rememberPlace = useCallback(() => {
    const box = scroller.current;
    anchor.current = null;
    if (!box || box.scrollTop <= 0) return;
    for (const row of box.querySelectorAll<HTMLElement>("[data-notification]")) {
      if (row.offsetTop + row.offsetHeight > box.scrollTop) {
        anchor.current = { id: row.dataset.notification!, offset: row.offsetTop - box.scrollTop };
        return;
      }
    }
  }, []);

  useLayoutEffect(() => {
    const box = scroller.current;
    const a = anchor.current;
    if (!box || !a) return;
    anchor.current = null;
    const row = box.querySelector<HTMLElement>(`[data-notification="${a.id}"]`);
    if (row) box.scrollTop = row.offsetTop - a.offset;
  }, [list]);

  // First page: on open, on filter change, on retry, and quietly again on
  // every Realtime signal or count change while open. A failed background
  // refresh keeps the list already shown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchPage(filter).then((page) => {
      if (cancelled) return;
      if (page === "reload") {
        window.location.reload();
        return;
      }
      setNow(Date.now());
      if (!page) {
        setList((prev) => (prev.status === "ready" ? prev : { status: "error" }));
        return;
      }
      setTimezone(page.timezone);
      setHasRead(page.has_read);
      rememberPlace();
      setList((prev) => ({ status: "ready", ...mergeFresh(page, prev), more: prev.status === "ready" ? prev.more : "idle" }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, filter, attempt, version, counts.notifications, rememberPlace]);

  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (current.status !== "ready" || !current.hasMore || current.more === "loading") return;
    const last = current.items[current.items.length - 1];
    setList({ ...current, more: "loading" });
    const page = await fetchPage(filter, last);
    if (page === "reload") {
      window.location.reload();
      return;
    }
    setList((prev) => {
      if (prev.status !== "ready") return prev;
      if (!page) return { ...prev, more: "error" };
      const ids = new Set(prev.items.map((i) => i.id));
      return { status: "ready", items: [...prev.items, ...page.items.filter((i) => !ids.has(i.id))], hasMore: page.has_more, more: "idle" };
    });
  }, [filter]);

  // Load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!open || !el || list.status !== "ready" || !list.hasMore || list.more !== "idle") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { root: scroller.current, rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [open, list, loadMore]);

  // Relative times stay current while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpenOn(null);
    setNote(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close(false);
      return;
    }
    setNote(null);
    setList({ status: "loading" });
    setOpenOn(pathname);
  }, [open, pathname, close]);

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
    // Tabbing out of the panel (to anything but the bell) closes it.
    const onFocus = (e: FocusEvent) => {
      const to = e.target as Node | null;
      if (to && root.current && !root.current.contains(to) && to !== document.body) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, close]);

  function choose(next: PanelFilter, focus = false) {
    if (focus) tabs.current.get(next)?.focus();
    tabs.current.get(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (next === filter) return;
    setFilter(next);
    setList({ status: "loading" });
    scroller.current?.scrollTo({ top: 0 });
  }

  function onTabKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const keys = PANEL_FILTERS.map((f) => f.key);
    const i = keys.indexOf(filter);
    const target =
      e.key === "ArrowRight" ? keys[(i + 1) % keys.length]
      : e.key === "ArrowLeft" ? keys[(i - 1 + keys.length) % keys.length]
      : e.key === "Home" ? keys[0]
      : e.key === "End" ? keys[keys.length - 1]
      : null;
    if (!target) return;
    e.preventDefault();
    choose(target, true);
  }

  function retry() {
    setList({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  async function markAll() {
    setBusy("mark");
    setNote(null);
    const result = await markReadAction(initialFormState, new FormData()).catch(() => null);
    setBusy(null);
    if (!result || result.status !== "success") {
      setNote({ tone: "error", text: result?.message ?? "Couldn't mark notifications as read. Nothing was changed." });
      return;
    }
    setList((s) =>
      s.status !== "ready" ? s : { ...s, items: filter === "unread" ? [] : s.items.map((i) => ({ ...i, read: true })), hasMore: filter === "unread" ? false : s.hasMore },
    );
    setHasRead(true);
    setNote({ tone: "ok", text: "All notifications marked as read, in every category." });
    refresh();
  }

  async function clearRead() {
    setBusy("clear");
    setNote(null);
    const result = await clearReadAction().catch(() => null);
    setBusy(null);
    if (!result?.ok) {
      setNote({ tone: "error", text: result?.message ?? "Couldn't clear read notifications. Nothing was changed." });
      return;
    }
    setList((s) => (s.status === "ready" ? { ...s, items: s.items.filter((i) => !i.read) } : s));
    setHasRead(false);
    setNote({ tone: "ok", text: result.message, undoAt: result.cleared ? result.at : undefined });
    refresh();
  }

  async function undoClear(at: string) {
    setBusy("undo");
    const result = await undoClearReadAction(at).catch(() => null);
    setBusy(null);
    if (!result?.ok) {
      setNote({ tone: "error", text: result?.message ?? "Couldn't restore them. Try again." });
      return;
    }
    setNote({ tone: "ok", text: "Read notifications restored." });
    setAttempt((n) => n + 1);
    refresh();
  }

  const items = list.status === "ready" ? list.items : [];
  const anyUnread = counts.notifications > 0 || items.some((i) => !i.read);
  const current = PANEL_FILTERS.find((f) => f.key === filter)!;
  const scoped = filter !== "all" && filter !== "unread";

  return (
    <div ref={root} className="relative">
      <Link
        ref={trigger}
        href="/notifications"
        prefetch={false}
        role="button"
        aria-haspopup="dialog"
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
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        tabIndex={-1}
        style={place ? ({ "--np-top": `${place.top}px`, "--np-right": `${place.right}px` } as CSSProperties) : undefined}
        className="notification-panel fixed z-50 flex flex-col overflow-hidden rounded-card border border-border bg-surface-raised text-text shadow-(--elev-lift) outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3 sm:px-5">
          <h2 id={headingId} className="font-display text-[1.25rem] font-semibold leading-tight">
            Notifications
            {counts.notifications > 0 ? <span className="sr-only"> ({counts.notifications} unread)</span> : null}
          </h2>
          <Link
            href="/notifications"
            prefetch={false}
            className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 font-semibold text-primary hover:bg-primary-soft"
          >
            View all
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Filters */}
        <div className="notification-filters border-y border-border">
          <div role="tablist" aria-label="Filter notifications" className="flex gap-1 overflow-x-auto overscroll-x-contain px-3 py-2 sm:px-4">
            {PANEL_FILTERS.map((f) => {
              const selected = f.key === filter;
              const n = f.key === "unread" ? counts.notifications : 0;
              return (
                <button
                  key={f.key}
                  ref={(el) => {
                    if (el) tabs.current.set(f.key, el);
                    else tabs.current.delete(f.key);
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${f.key}`}
                  aria-selected={selected}
                  aria-controls={listId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => choose(f.key)}
                  onKeyDown={onTabKey}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-meta font-semibold transition-colors",
                    selected ? "bg-cta text-on-cta" : "text-text-secondary hover:bg-surface-muted hover:text-text",
                  )}
                >
                  {f.label}
                  {n > 0 ? (
                    <span className={cn("tabular-nums", selected ? "text-on-cta/80" : "text-primary")}>
                      {n > 99 ? "99+" : n}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-x-1 border-b border-border px-2 py-1 sm:px-3">
          {scoped ? <p className="mr-auto pl-2 text-[0.8125rem] text-text-secondary">Actions apply to all categories</p> : null}
          <button
            type="button"
            onClick={markAll}
            disabled={!anyUnread || busy !== null}
            title="Marks every notification as read, in all categories"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-semibold text-text-secondary hover:bg-surface-muted hover:text-text disabled:pointer-events-none disabled:opacity-50"
          >
            <CheckCheck className="size-[1.125rem]" aria-hidden="true" />
            {busy === "mark" ? "Marking…" : "Mark all as read"}
          </button>
          <button
            type="button"
            onClick={clearRead}
            disabled={!hasRead || busy !== null}
            title="Removes read notifications from your list, in all categories"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-semibold text-text-secondary hover:bg-surface-muted hover:text-text disabled:pointer-events-none disabled:opacity-50"
          >
            <Trash2 className="size-[1.125rem]" aria-hidden="true" />
            {busy === "clear" ? "Clearing…" : "Clear read"}
          </button>
        </div>

        <div role="status" aria-live="polite" className={cn(note ? "flex items-center gap-2 border-b border-border px-4 py-2 text-meta sm:px-5" : "sr-only")}>
          {note ? (
            <>
              <span className={cn("min-w-0 flex-1", note.tone === "error" ? "text-danger" : "text-text-secondary")}>{note.text}</span>
              {note.undoAt ? (
                <button
                  type="button"
                  onClick={() => undoClear(note.undoAt!)}
                  disabled={busy !== null}
                  className="min-h-9 shrink-0 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
                >
                  {busy === "undo" ? "Restoring…" : "Undo"}
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {/* List */}
        <div
          ref={scroller}
          id={listId}
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${filter}`}
          aria-busy={list.status === "loading"}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {list.status === "loading" ? (
            <ul aria-label="Loading notifications" className="divide-y divide-border">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex gap-3 px-4 py-3.5 sm:px-5">
                  <span className="size-10 shrink-0 animate-pulse rounded-full bg-surface-muted motion-reduce:animate-none" />
                  <span className="flex-1 space-y-2 pt-1">
                    <span className="block h-4 w-3/4 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
                    <span className="block h-3.5 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
                  </span>
                </li>
              ))}
            </ul>
          ) : list.status === "error" ? (
            <div className="space-y-3 px-4 py-6 text-center sm:px-5">
              <p>Notifications couldn&apos;t be loaded right now.</p>
              <button type="button" onClick={retry} className="min-h-11 rounded-full border border-border-strong/60 px-5 font-semibold hover:bg-surface-muted">
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Bell className="size-6" aria-hidden="true" />
              </span>
              <p className="font-semibold">
                {filter === "all" ? "You're all caught up" : filter === "unread" ? "No unread notifications" : `No ${current.label} notifications`}
              </p>
              <p className="text-meta text-text-secondary">
                {filter === "all" ? "New replies, events, and updates will show here." : "Choose All to see everything else."}
              </p>
            </div>
          ) : (
            <>
              {groupByDay(items, timezone, now).map((g) => (
                <section key={g.group} aria-label={DAY_GROUP_LABEL[g.group]}>
                  <h3 className="sticky top-0 z-[1] border-b border-border bg-surface-muted/95 px-4 py-1.5 text-eyebrow font-semibold uppercase tracking-[0.08em] text-text-secondary backdrop-blur-sm sm:px-5">
                    {DAY_GROUP_LABEL[g.group]}
                  </h3>
                  <ul className="divide-y divide-border">
                    {g.items.map((n) => {
                      const CategoryIcon = ICON[n.category] ?? Bell;
                      return (
                        <li key={n.id} data-notification={n.id}>
                          <a
                            href={`/notifications/open/${n.id}`}
                            onClick={() => setOpenOn(null)}
                            className={cn(
                              "flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted sm:px-5",
                              !n.read && "bg-primary-soft/55",
                            )}
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary">
                              <CategoryIcon className="size-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn("line-clamp-2 break-words leading-snug", n.read ? "font-medium text-text" : "font-bold text-text")}>
                                {!n.read ? <span className="sr-only">Unread: </span> : null}
                                {n.title}
                              </span>
                              <span className="mt-0.5 line-clamp-2 break-words text-meta leading-snug text-text-secondary">{n.preview}</span>
                              <span className="mt-1 flex items-center gap-2 text-[0.8125rem] text-text-secondary">
                                <span className="font-semibold uppercase tracking-[0.06em]">{CATEGORY_LABEL[n.category]}</span>
                                <span aria-hidden="true">•</span>
                                <time dateTime={n.created_at}>{panelTime(n.created_at, timezone, now)}</time>
                              </span>
                            </span>
                            {!n.read ? <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-primary" /> : <span className="w-2.5 shrink-0" />}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {list.hasMore ? (
                <div ref={sentinel} className="flex justify-center border-t border-border px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={list.more === "loading"}
                    className="min-h-11 rounded-full px-4 font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
                  >
                    {list.more === "loading" ? "Loading…" : list.more === "error" ? "Couldn't load more. Try again" : "Show older"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
