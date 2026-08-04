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

  // Navigations & everything else: network first, offline shell fallback.
  // cache: no-store bypasses the HTTP cache so a new deploy is always seen.
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        // Cache successful navigations so the shell is fresh next offline load.
        if (req.mode === "navigate" && res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("/index.html") || caches.match("/")),
      ),
  );
});
