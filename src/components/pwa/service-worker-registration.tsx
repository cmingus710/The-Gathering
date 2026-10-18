"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production. The worker caches only public, versioned
 * static assets and an offline notice — never pages, API responses, or
 * anything behind sign-in (see public/sw.js).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installation still works without the worker; nothing to surface to members.
    });
  }, []);
  return null;
}
