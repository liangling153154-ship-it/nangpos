const CACHE_NAME = 'nang-cafe-v1.4.0';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/fonts/fonts.css',
  '/fonts/display.css',
  '/images/brand/logo-nang-cafe.png',
  '/images/brand/logo-nang-cafe-reverse.png',
  '/images/brand/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept API or WebSocket requests
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Cache-first for static fonts and images
  if (
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/audio/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for HTML/JS/CSS app shell
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
