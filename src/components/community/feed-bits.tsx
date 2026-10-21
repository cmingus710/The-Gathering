"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/components/ui/cn";
import { initials } from "@/lib/directory/format";

/**
 * Initials avatar for feed posts and comments. Member photos are governed by
 * directory privacy settings, so the feed shows initials only and never
 * widens who can see a photo.
 */
export function InitialsAvatar({ name, size = "md", className }: { name: string | null; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary ring-1 ring-primary/30",
        size === "sm" ? "size-8 text-[0.75rem]" : "size-10 text-[0.875rem]",
        className,
      )}
    >
      {name ? initials(name) : "?"}
    </span>
  );
}

/** A textarea that grows with its text (from `minRows`), so empty boxes stay small. */
export function AutoGrowTextarea({ minRows = 1, className, value, ref: outerRef, ...rest }: ComponentProps<"textarea"> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    ref.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) outerRef.current = el;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={setRef}
      rows={minRows}
      value={value}
      className={cn(
        "block max-h-[50vh] w-full resize-none rounded-control border border-border-strong/70 bg-surface px-3.5 py-2.5 text-base text-text placeholder:text-text-secondary focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary",
        className,
      )}
      {...rest}
    />
  );
}

const drafts = new Set<string>();

/**
 * Registers an unsent draft (text or chosen files) so leaving or reloading
 * the page asks first. Collapsing comments keeps drafts, so only a real
 * page exit can lose one.
 */
export function useDraftGuard(key: string, dirty: boolean) {
  useEffect(() => {
    if (dirty) drafts.add(key);
    else drafts.delete(key);
    return () => {
      drafts.delete(key);
    };
  }, [key, dirty]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (drafts.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}

/** Moves a just-revealed element into view and focus without a jump for reduced-motion users. */
export function reveal(el: HTMLElement | null) {
  if (!el) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  el.focus({ preventScroll: true });
}
