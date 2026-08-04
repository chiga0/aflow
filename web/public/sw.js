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
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
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
