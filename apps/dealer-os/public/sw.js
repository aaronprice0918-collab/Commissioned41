const CACHE_NAME = "mission-os-v7";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico?v=5",
  "/mission-icon-192.png?v=5",
  "/mission-icon-512.png?v=5",
  "/apple-touch-icon.png?v=5",
  "/brand/mission-mark.png",
  "/brand/mission-logo.png",
  "/brand/kennesaw-mazda-premium.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      // When a new worker version takes over, force every open tab to reload so
      // the freshly deployed app is shown without any manual cache clearing.
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => {
        if ("navigate" in client) client.navigate(client.url).catch(() => {});
      }))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations and application code (Next.js build output) are always
  // fetched from the network so the latest deploy is shown immediately; we only
  // fall back to a cached copy when the device is actually offline. Caching app
  // HTML/JS was causing stale screens that survived hard refreshes.
  const isAppCode = request.mode === "navigate" || url.pathname.startsWith("/_next/");
  if (isAppCode) {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
    return;
  }

  // Static assets (icons, brand images) use cache-first for offline speed.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
