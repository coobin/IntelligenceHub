const CACHE_NAME = "intelligence-hub-v30";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/maskable.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/admin" ||
    url.pathname === "/admin.js" ||
    url.pathname === "/data/catalog.json" ||
    url.pathname === "/config.local.js"
  )) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => {
      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }
      return caches.match(event.request).then((cached) => cached || Response.error());
    })
  );
});
