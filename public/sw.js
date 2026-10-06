// Offline shell. NETWORK-FIRST so a deploy is never masked by a stale cache; the cache is only an offline fallback.
// (v1 was cache-first for everything, which pinned users to old HTML/CSS/JS after every release.)
const CACHE = "eiden-drive-v2";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never intercept API calls or Next build assets (hashed, already HTTP-cached) — avoids stale data/code.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && request.mode === "navigate") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/drive")))
  );
});
