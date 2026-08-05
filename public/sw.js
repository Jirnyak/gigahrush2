const CACHE_NAME = 'gigahrush-shell-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const IS_DEV_HOST = DEV_HOSTS.has(location.hostname);

self.addEventListener('install', event => {
  if (IS_DEV_HOST) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  if (IS_DEV_HOST) {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.filter(key => key.startsWith('gigahrush-')).map(key => caches.delete(key))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim()),
    );
    return;
  }
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (url.pathname === '/npc-intake' || url.pathname.startsWith('/npc-intake/')) {
    event.respondWith(fetch(request));
    return;
  }
  if (IS_DEV_HOST || url.pathname.startsWith('/src/') || url.pathname.startsWith('/@vite/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('./index.html').then(response => response || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })),
  );
});
