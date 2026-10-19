/*
 * The Gathering service worker.
 *
 * Safety rules:
 * - Only public, content-hashed build assets (/_next/static/), approved brand
 *   art (/brand/, /icons/), and the static offline page are ever cached.
 * - Page navigations are network-only. If the network is down the member sees
 *   the generic offline page, never a stored copy of a private page.
 * - API routes, auth routes, Supabase requests, and other origins are not
 *   intercepted at all.
 * - Push messages (Phase 5) carry only generic text and an
 *   /notifications/open/<id> link; the app rechecks access on click.
 */
const VERSION = "v2";
const STATIC_CACHE = `gathering-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/brand/gathering-icon.webp", "/brand/gathering-icon.png", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!isCacheableStatic(url)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-caches") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

// Web push: show the generic message; never store it.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "The Gathering";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "You have a new notification.";
  const url = typeof data.url === "string" && /^\/notifications\/open\/[0-9a-f-]{36}$/.test(data.url) ? data.url : "/notifications";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/notifications", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "navigate" in w) {
          return w.focus().then(() => w.navigate(target.href));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// The browser rotated or expired the subscription; the server removes dead
// endpoints after delivery failures, and the member can turn push on again.
self.addEventListener("pushsubscriptionchange", () => {});
