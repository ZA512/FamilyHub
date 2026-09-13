const CACHE_PREFIX = 'familyhub-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-v2`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-v2`;
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) &&
                key !== SHELL_CACHE &&
                key !== RUNTIME_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/', { cacheName: SHELL_CACHE })),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches
              .open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_PRIVATE_CACHES') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith(`${CACHE_PREFIX}private-`))
              .map((key) => caches.delete(key)),
          ),
        ),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'FamilyHub', {
      body: payload.body || 'Une nouveauté vous attend dans votre foyer.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag || 'familyhub-notification',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.focus().then(() => existing.navigate(targetUrl));
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
