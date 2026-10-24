"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveActivityProgress } from "@/app/(app)/(member)/youth/play/actions";

/**
 * Saves a game's progress for one child on one version through the same
 * server action (and database checks) as "Mark finished". One save at a time,
 * always the latest state: moves are batched for a moment, a check or a
 * finished game is saved at once. A conflict (a newer version, or a save
 * from another tab or device) stops saving and asks to reload, so nothing is
 * overwritten. In the editor's preview nothing is saved.
 */
export type SaveTarget = { activity: string; child: string | null; version: string; revision: number } | null;

export type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string; reload?: boolean };

const DELAY_MS = 900;

export function useProgressSaver(target: SaveTarget) {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const revision = useRef(target?.revision ?? 0);
  const pending = useRef<{ data: Record<string, unknown>; completed: boolean } | null>(null);
  const busy = useRef(false);
  const blocked = useRef(false);
  // The status members see on cards: refresh the pages only when it may change.
  const reported = useRef<boolean | null>(target && target.revision > 0 ? null : false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const t = targetRef.current;
    if (!t || busy.current) return;
    busy.current = true;
    // Whatever arrived while a save was in flight goes next; a failure waits for the next move.
    while (pending.current && !blocked.current) {
      const next = pending.current;
      pending.current = null;
      setStatus({ state: "saving" });
      let ok = false;
      try {
        const revalidate = revision.current === 0 || (reported.current === null ? next.completed : reported.current !== next.completed);
        const r = await saveActivityProgress({
          activity: t.activity,
          child: t.child,
          version: t.version,
          revision: revision.current,
          completed: next.completed,
          data: next.data,
          revalidate,
        });
        if (r.ok) {
          ok = true;
          revision.current = r.revision;
          reported.current = r.status === "completed";
          setStatus({ state: "saved" });
        } else {
          if (r.conflict) blocked.current = true;
          else pending.current ??= next;
          setStatus({ state: "error", message: r.message, reload: Boolean(r.conflict) });
        }
      } catch {
        pending.current ??= next;
        setStatus({ state: "error", message: "Progress couldn't be saved just now. It will try again with your next move." });
      }
      if (!ok) break;
    }
    busy.current = false;
  }, []);

  const save = useCallback(
    (data: Record<string, unknown>, completed: boolean, now = false) => {
      if (!targetRef.current || blocked.current) return;
      pending.current = { data, completed };
      if (now) void flush();
      else {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), DELAY_MS);
      }
    },
    [flush],
  );

  // Leaving the page or switching apps: send what's waiting.
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", away);
    return () => {
      document.removeEventListener("visibilitychange", away);
      void flush();
    };
  }, [flush]);

  return { save, status, preview: !target };
}
