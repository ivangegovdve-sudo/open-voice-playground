/* global self, caches, fetch, URL, Response */

const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__
const CACHE_NAME = `open-voice-shell-${CACHE_VERSION}`;
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__
const SHELL_ASSETS = [...new Set([...CORE_ASSETS, ...BUILD_ASSETS])];
const ROOT_STATIC_ASSETS = new Set(['/manifest.webmanifest', '/icon.svg']);
const BUILT_STATIC_ASSET_PATTERN =
  /^\/assets\/[^?#]+\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;

function isRuntimeCacheableStaticAsset(url) {
  return ROOT_STATIC_ASSETS.has(url.pathname) || BUILT_STATIC_ASSET_PATTERN.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/index.html', response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('/index.html', { ignoreVary: true })) ?? Response.error();
        }),
    );
    return;
  }
  if (!isRuntimeCacheableStaticAsset(url)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached !== undefined) {
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
