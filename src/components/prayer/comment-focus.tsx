"use client";

import { useEffect } from "react";

/**
 * Brings the comment a link points to (`?comment=<id>`, e.g. from a mention
 * notification) into view and moves focus to it, once. The page has already
 * opened enough of the conversation to include it.
 */
export function CommentFocus({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(`comment-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
    el.classList.add("ring-2", "ring-primary");
    const t = window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2400);
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
