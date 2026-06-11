// Service worker: cache-first per i file statici, network-first per le API.
const CACHE = 'daily-dashboard-v19';
const STATIC_ASSETS = [
  '.', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg',
  'vendor/fontawesome/css/all.min.css',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'vendor/fontawesome/webfonts/fa-regular-400.woff2',
  'vendor/fonts/fonts.css',
  'vendor/fonts/jakarta-latin.woff2',
  'vendor/fonts/jakarta-latin-ext.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Un tap su una notifica porta in primo piano l'app (o la apre).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) =>
      wins.length ? wins[0].focus() : clients.openWindow('.')),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Dati treni in tempo reale: sempre dalla rete, mai dalla cache.
  if (url.pathname.startsWith('/api/')) return;

  // API meteo: rete prima, cache come fallback offline.
  if (url.hostname.endsWith('open-meteo.com')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request)),
    );
    return;
  }

  // File statici: cache prima, rete come fallback.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request)),
    );
  }
});
