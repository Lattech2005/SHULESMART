/* SHULESMART Service Worker
   Lengo: (1) app ifanye kazi offline (ionekane, uweze kufungua),
          (2) mtumiaji apate toleo JIPYA kila akiwa na internet - si kubaki na cache ya zamani.
   Kanuni: HTML kuu = network-first (jaribu internet kwanza, cache ni backup pekee).
           Faili tuli (icons/manifest) = cache-first (haraka, hazibadiliki mara kwa mara). */

const CACHE_NAME = "shulesmart-shell-v1";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL).catch(function(err) {
        console.log("SW install cache error:", err);
      });
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function(event) {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests. Firebase/WhatsApp/CDN calls pass straight through to network.
  if (url.origin !== self.location.origin) return;

  // HTML navigation: NETWORK-FIRST. Ensures the newest version loads whenever online;
  // falls back to cached shell only when fully offline.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req).then(function(response) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        return response;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Static assets (icons, manifest, fonts): CACHE-FIRST for speed, network fallback.
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(response) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        return response;
      }).catch(function() {
        return cached;
      });
    })
  );
});
