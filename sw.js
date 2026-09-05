const CACHE_NAME = "shulepoa-cache-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192-v2.png",
  "./icon-512-v2.png"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* HTML/manifest zinatafutwa kwenye mtandao KWANZA (network-first) ili
   mabadiliko mapya (logo, mfumo mpya) yaonekane papo hapo mtumiaji akiwa
   na intaneti. Zikishindikana (hana intaneti), app inatumia cache
   iliyohifadhiwa ili iendelee kufanya kazi offline. */
self.addEventListener("fetch", function (event) {
  const req = event.request;
  const isHTMLorJSON = req.mode === "navigate" ||
    req.url.endsWith(".html") ||
    req.url.endsWith("manifest.json");

  if (isHTMLorJSON) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
          return res;
        })
        .catch(function () { return caches.match(req); })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req);
    })
  );
});
