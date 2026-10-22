"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { backTarget, isReturnView, validReturnView, type BackRoute } from "@/lib/back-links";
import { cn } from "./cn";

const KEY = "return-view:";

/** When a back link was last followed; lists that restore their place on Back (the Community feed) also restore it then. */
let returnedAt = 0;
export function lastReturnAt(): number {
  return returnedAt;
}

const noSubscribe = () => () => {};
function readView(parentHref: string): string | null {
  try {
    return sessionStorage.getItem(KEY + parentHref.split("?")[0]);
  } catch {
    return null;
  }
}

/**
 * "Back to …" at the top of a detail or nested page: up one level to the
 * page's parent list or overview (src/lib/back-links.ts), never back in
 * browser history. When the reader was on that list earlier in this tab,
 * its approved filters come along (Events by category, Prayer's tab).
 * Browser Back is untouched, and in-app unsaved-change prompts still run
 * first because they cancel the click before it gets here.
 */
export function BackLink({
  route,
  params,
  query,
  label,
  inRow = false,
  className,
}: {
  route: BackRoute;
  params?: Record<string, string | null | undefined>;
  query?: Record<string, string | null | undefined>;
  /** A real name for the parent ("Morning Psalms") instead of the generic one ("the plan"). */
  label?: string | null;
  /** Shares a row with something else (a status badge); the row owns the spacing. */
  inRow?: boolean;
  className?: string;
}) {
  const target = backTarget(route, { params, query, label });
  const stored = useSyncExternalStore(noSubscribe, () => readView(target.href), () => null);
  const href = validReturnView(target.href, stored) ?? target.href;

  return (
    <div className={cn(!inRow && "-mt-1 mb-3 sm:mb-4", "min-w-0", className)}>
      <Link
        href={href}
        onClick={(e) => {
          if (!e.defaultPrevented) returnedAt = Date.now();
        }}
        className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1 rounded-tile px-2 text-meta font-semibold text-text-secondary transition-colors hover:text-text hover:underline"
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">Back to {target.label}</span>
      </Link>
    </div>
  );
}

/**
 * Lives in the app shells: remembers the reader's current view of each list
 * a back link can return to (path and query, for this tab only). BackLink
 * validates it again before using it.
 */
export function ReturnViewRecorder() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!isReturnView(pathname)) return;
    const query = search.toString();
    try {
      sessionStorage.setItem(KEY + pathname, query ? `${pathname}?${query}` : pathname);
    } catch {}
  }, [pathname, search]);
  return null;
}
