const CACHE = "sonora-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/sonora.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const protectedPath = url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/ws/")
    || url.pathname.startsWith("/media/")
    || url.pathname.includes("/streams/")
    || url.pathname.includes("/downloads/");
  if (event.request.method !== "GET" || protectedPath) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
