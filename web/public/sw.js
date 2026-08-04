/* AFlow service worker — offline app shell.
 *
 * Strategy:
 *   - /api/* and /daemon/*  → network only (live data, never cached)
 *   - navigations           → network first, fall back to cached shell offline
 *   - hashed assets & icons → cache first (immutable), populate on miss
 *
 * The shell stays available offline so the branded UI loads; the WebShell
 * itself will surface its own "disconnected" state when qwen is unreachable.
 */
const VERSION = "__BUILD_ID__";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  // versioned: busts browser HTTP cache so reinstalls pick fresh bytes
  "/icon-192.png?v=4",
  "/icon-512.png?v=4",
  "/icon-maskable-512.png?v=4",
  "/apple-touch-icon.png?v=4",
  "/favicon.ico?v=4",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined) // partial shell is fine; navigation fallback still works
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isLive(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/daemon/");
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/apple-touch-icon") ||
    pathname.startsWith("/favicon") ||
    pathname === "/manifest.json"
  );
}

// ── Web Push: wake-up ping; render text from /api/push/peek ──
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let notice = {};
      try {
        const res = await fetch("/api/push/peek", { credentials: "same-origin" });
        if (res.ok) notice = await res.json();
      } catch {
        /* offline or auth lapsed: fall back to a generic nudge */
      }
      const title = notice.title || "AFlow";
      const body = notice.body || "有新动态，点开查看";
      return self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: notice.tag || "aflow",
        renotify: true,
        data: { url: notice.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live endpoints: never serve stale data.
  if (isLive(url.pathname)) return;

  // Static, immutable assets: cache first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
          return res;
        });
      }),
    );
    return;
  }

  // Navigations: cache-first so the opaque dark shell paints instantly on
  // launch (network-first left the webview transparent while the round trip
  // ran, flashing the Android launcher / iOS homescreen through). The copy
  // revalidates in the background; new deploys surface via the update toast
  // or pull-to-refresh on the next foreground.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match("/");
      const refresh = fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res && res.status === 200) cache.put("/", res.clone());
          return res;
        })
        .catch(() => undefined);
      if (hit) {
        event.waitUntil(refresh);
        return hit;
      }
      const res = await refresh;
      if (res) return res;
      return (
        (await caches.match("/index.html")) ||
        Response.error()
      );
    })(),
  );
});
