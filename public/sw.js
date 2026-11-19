/* Chrono Calculator service worker.
   - Precaches the app shell so it opens offline.
   - Navigations: network first, cached shell when offline.
   - Same-origin assets (Vite's hashed files, icons): cache first.
   - Google Fonts: stale-while-revalidate.
   - Videos and byte-range requests are left to the network: browsers fetch video in
     ranges, which a cache-first worker would break (notably in Safari). Offline, the
     splash simply skips itself. */
const VERSION = 'chrono-calculator-v4';
const SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/splash-poster.jpg', '/splash-end.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.headers.has('range') || url.pathname.endsWith('.mp4')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.status === 200 || res.type === 'opaque') c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.status === 200) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
