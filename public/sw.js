const CACHE = "eiden-drive-v1";
const CORE = ["/", "/drive", "/activity", "/manifest.json"];

self.addEventListener("install", (e) => {
  // @ts-ignore
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("fetch", (e) => {
  // @ts-ignore
  const { request } = e;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  // @ts-ignore
  e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
    const copy = res.clone();
    // @ts-ignore
    caches.open(CACHE).then((c) => c.put(request, copy));
    return res;
  }).catch(() => caches.match("/drive"))));
});
