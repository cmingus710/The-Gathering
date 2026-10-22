"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UnreadCounts } from "@/lib/community/types";

/**
 * Live community updates for the signed-in member.
 *
 * - Subscribes to ONE private Realtime channel, `member:<id>`. The database
 *   authorizes the subscription (RLS on realtime.messages: only that member,
 *   only while approved) and sends only content-free "refresh" signals.
 * - The database stays the source of truth: every signal, reconnect, tab
 *   focus, and a 60-second fallback poll refetch badge counts through the
 *   normal access-checked functions, so duplicate or missed signals are
 *   harmless and multiple tabs/devices converge.
 * - If the session has expired (401) or the member is no longer approved
 *   (403), the page is reloaded so the server can send them to sign-in or
 *   the account status page, and restricted content leaves the screen.
 */
type Ctx = {
  counts: UnreadCounts;
  /** Increments on every signal or reconnect; subscribe to refetch your own data. */
  version: number;
  live: boolean;
  refresh: () => void;
};

const CommunityRealtime = createContext<Ctx>({ counts: { notifications: 0, messages: 0 }, version: 0, live: false, refresh: () => {} });

export function useCommunityRealtime() {
  return useContext(CommunityRealtime);
}

export function CommunityRealtimeProvider({
  memberId,
  supabaseUrl,
  supabaseKey,
  initialCounts,
  children,
}: {
  memberId: string;
  supabaseUrl: string | null;
  supabaseKey: string | null;
  initialCounts: UnreadCounts;
  children: ReactNode;
}) {
  const [counts, setCounts] = useState(initialCounts);
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(false);
  // One refetch at a time; signals that arrive meanwhile trigger one more.
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let inflight = false;
    let queued = false;
    const run = async (): Promise<void> => {
      if (inflight) {
        queued = true;
        return;
      }
      inflight = true;
      try {
        const res = await fetch("/api/community/unread", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401 || res.status === 403) {
          window.location.reload();
          return;
        }
        if (res.ok) setCounts((await res.json()) as UnreadCounts);
      } catch {
        // Offline: the next poll or reconnect tries again.
      } finally {
        inflight = false;
        setVersion((v) => v + 1);
        if (queued) {
          queued = false;
          void run();
        }
      }
    };
    refreshRef.current = () => void run();
  }, []);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;
    let channel: RealtimeChannel | null = null;
    let client: SupabaseClient | null = null;
    let cancelled = false;
    let wasLive = false;
    (async () => {
      // Loaded after the page is interactive: the Supabase client is the
      // largest script in the shell and nothing on screen needs it.
      const { createBrowserClient } = await import("@supabase/ssr");
      if (cancelled) return;
      client = createBrowserClient(supabaseUrl, supabaseKey);
      await client.realtime.setAuth();
      if (cancelled) return;
      channel = client
        .channel(`member:${memberId}`, { config: { private: true } })
        .on("broadcast", { event: "refresh" }, () => refresh())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setLive(true);
            // Catch up on anything missed while disconnected.
            if (wasLive) refresh();
            wasLive = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setLive(false);
            // Authorization can fail when the session expired or access
            // changed; the count check decides what to do.
            refresh();
          }
        });
    })().catch(() => setLive(false));
    // supabase-js passes refreshed session tokens to the socket itself.
    return () => {
      cancelled = true;
      if (channel && client) void client.removeChannel(channel);
    };
  }, [memberId, supabaseUrl, supabaseKey, refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const value = useMemo(() => ({ counts, version, live, refresh }), [counts, version, live, refresh]);
  return <CommunityRealtime.Provider value={value}>{children}</CommunityRealtime.Provider>;
}
