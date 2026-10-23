"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { hasUnsavedWork } from "./unsaved";

/**
 * Links in rendered content (announcements, devotionals, lessons and
 * workbooks, posts, comments, prayer requests: anything in .prose-gathering)
 * are plain HTML from the Markdown renderers. This makes the ones to pages
 * in The Gathering use the app's own navigation, like any other link.
 *
 * When something on the page is unsaved (a comment being written, an edited
 * lesson block) or the link is in an editor's preview (`data-links-new-tab`),
 * the page opens in a new tab instead, so nothing being written is lost.
 * Web links already open in a new tab; email and phone links are left to
 * the device. Modified clicks (new tab, download, …) behave as usual.
 */
export function ProseLinkNavigation() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || !a.closest(".prose-gathering")) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      e.preventDefault();
      if (hasUnsavedWork() || a.closest("[data-links-new-tab]")) {
        window.open(url.href, "_blank", "noopener");
        return;
      }
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
