/* SHULESMART Service Worker
   Kusudi kuu: kuruhusu "Install App" kwenye Chrome (Android/Desktop).
   Haihifadhi (cache) chochote kwa makusudi, ili mtumiaji apate toleo
   jipya kila mara anapofungua app akiwa na internet (auto-update). */

self.addEventListener("install", function(event) {
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(self.clients.claim());
});

/* Fetch handler tupu ni wa lazima kwa Chrome kuruhusu 'Install' -
   tunapeleka kila ombi moja kwa moja kwenye mtandao (hakuna caching),
   ili data na code zibaki mpya kila wakati. */
self.addEventListener("fetch", function(event) {
  event.respondWith(fetch(event.request));
});
