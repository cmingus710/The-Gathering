"use client";

import { ArrowUp, ChevronDown, Pin } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { feedNewerAction, loadFeedAction } from "@/app/(member)/community/feed-actions";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/community/format";
import type { FeedCursor, FeedPage, RenderedPost } from "@/lib/community/types";
import { FeedPostCard } from "./feed-post";
import { useCommunityRealtime } from "./realtime-provider";

type Place = { category: string | null; group: string | null };
type Saved = { posts: RenderedPost[]; cursor: FeedCursor | null; scrollY: number; at: number };

/**
 * Feed state kept across a visit to a post and back (browser Back), so the
 * reader returns to the same place with the same posts loaded. Restored only
 * after a Back/Forward navigation, never when Community is opened afresh.
 */
const saved = new Map<string, Saved>();
let lastPopAt = 0;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (lastPopAt = Date.now()));

/**
 * The Community feed: original posts only, newest first by when they were
 * posted (the database orders and pages them; nothing is re-sorted here).
 * Comments stay closed until asked for. New posts never push the page
 * around: a "New posts" button appears instead and loads them on request.
 */
export function Feed({
  initial,
  place,
  timeZone,
  postedId,
}: {
  initial: Pick<FeedPage, "next_cursor"> & { items: RenderedPost[] };
  place: Place;
  timeZone: string;
  /** Just posted from the composer: move focus to it. */
  postedId?: string | null;
}) {
  const key = `${place.category ?? ""}:${place.group ?? ""}`;
  const [restored] = useState(() => {
    const s = saved.get(key);
    saved.delete(key);
    return s && lastPopAt > s.at && Date.now() - s.at < 30 * 60_000 ? s : null;
  });
  const [posts, setPosts] = useState<RenderedPost[]>(restored?.posts ?? initial.items);
  const [cursor, setCursor] = useState<FeedCursor | null>(restored ? restored.cursor : initial.next_cursor);
  const [error, setError] = useState<string | null>(null);
  const [newer, setNewer] = useState(0);
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);
  const state = useRef({ posts, cursor });
  useEffect(() => {
    state.current = { posts, cursor };
  }, [posts, cursor]);

  // Remember where the reader was when they leave for a post.
  useEffect(
    () => () => {
      saved.set(key, { ...state.current, scrollY: window.scrollY, at: Date.now() });
    },
    [key],
  );
  useLayoutEffect(() => {
    if (restored) requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
    try {
      sessionStorage.removeItem("community:from-feed");
    } catch {}
  }, [restored]);

  useEffect(() => {
    if (postedId) document.getElementById(`post-${postedId}`)?.querySelector<HTMLElement>("h2 a")?.focus();
  }, [postedId]);

  // On each community signal (and the regular check), ask whether anything newer exists.
  const { version } = useCommunityRealtime();
  const top = posts[0];
  useEffect(() => {
    if (!top || version === 0) return;
    let cancelled = false;
    void feedNewerAction({ ...place, at: top.created_at, id: top.id }).then((n) => {
      if (!cancelled) setNewer(n);
    });
    return () => {
      cancelled = true;
    };
    // place is stable for the life of this feed (the page keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, top?.id]);

  const loadMore = () =>
    start(async () => {
      setError(null);
      const res = await loadFeedAction({ ...place, cursor });
      if (!res.ok) return setError(res.message);
      setPosts((list) => {
        const ids = new Set(list.map((p) => p.id));
        return [...list, ...res.data.items.filter((p) => !ids.has(p.id))];
      });
      setCursor(res.data.next_cursor);
    });

  const showNewest = () =>
    start(async () => {
      setError(null);
      const res = await loadFeedAction({ ...place, cursor: null });
      if (!res.ok) return setError(res.message);
      setPosts(res.data.items);
      setCursor(res.data.next_cursor);
      setNewer(0);
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      listRef.current?.querySelector<HTMLElement>("h2 a")?.focus({ preventScroll: true });
    });

  const remove = useCallback((id: string) => setPosts((list) => list.filter((p) => p.id !== id)), []);

  return (
    // A post opened from here can send the reader Back to this spot (see BackToFeed).
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a[href^="/community/t/"]')) {
          try {
            sessionStorage.setItem("community:from-feed", "1");
          } catch {}
        }
      }}
    >
      {newer > 0 ? (
        <div className="sticky top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 flex justify-center lg:top-4">
          <Button size="sm" onClick={showNewest} icon={<ArrowUp className="size-4" aria-hidden="true" />} className="shadow-(--elev-lift)">
            {newer === 1 ? "1 new post" : `${newer >= 99 ? "99+" : newer} new posts`}
          </Button>
        </div>
      ) : null}
      {posts.length ? (
        <ol ref={listRef} className="space-y-4" aria-label="Posts, newest first">
          {posts.map((p) => (
            <li key={p.id}>
              <FeedPostCard post={p} timeZone={timeZone} onGone={remove} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-card border border-border bg-surface px-5 py-8 text-center text-text-secondary">No posts here yet. Share the first one.</p>
      )}
      {error ? (
        <p role="alert" className="mt-4 text-meta text-danger">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" size="sm" loading={pending} loadingText="Loading…" onClick={loadMore} icon={<ChevronDown className="size-4" aria-hidden="true" />}>
            Load more posts
          </Button>
        </div>
      ) : posts.length ? (
        <p className="mt-6 text-center text-meta text-text-secondary">You&apos;re all caught up.</p>
      ) : null}
    </div>
  );
}

/** Pinned posts, listed apart in a small collapsible section (they keep their place in the feed too). */
export function PinnedPosts({ items }: { items: FeedPage["pinned"] }) {
  if (!items.length) return null;
  return (
    <details className="group rounded-card border border-border bg-surface px-4 sm:px-5">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <Pin className="size-4 text-primary" aria-hidden="true" />
        Pinned ({items.length})
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="-mt-1 pb-2">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/community/t/${p.id}`} className="flex min-h-11 items-baseline gap-2 rounded-control py-1.5 hover:underline">
              <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
              <span className="shrink-0 text-[0.8125rem] text-text-secondary">
                {p.author ?? "Former member"} · {relativeTime(p.created_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
