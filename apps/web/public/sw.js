/* global self, caches, crypto, fetch, URL, Response */

const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__
const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__
const CACHE_NAME = `open-voice-shell-${CACHE_VERSION}`;
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__
const SHELL_ASSETS = [...new Set([...CORE_ASSETS, ...BUILD_ASSETS])];
const ROOT_STATIC_ASSETS = new Set(['/manifest.webmanifest', '/icon.svg']);
const BUILT_STATIC_ASSET_PATTERN =
  /^\/assets\/[^?#]+\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;
const SPA_APP_ROUTES = new Set([
  '/',
  '/voices',
  '/play',
  '/compare',
  '/companion',
  '/about/sources',
]);

function isRuntimeCacheableStaticAsset(url) {
  return ROOT_STATIC_ASSETS.has(url.pathname) || BUILT_STATIC_ASSET_PATTERN.test(url.pathname);
}

function isSpaAppRoute(pathname) {
  return SPA_APP_ROUTES.has(pathname) || /^\/engines\/[^/]+$/.test(pathname);
}

async function hasExactShellDigest(response) {
  if (!response.headers.get('content-type')?.includes('text/html')) {
    return false;
  }
  const shellBytes = await response.clone().arrayBuffer();
  const digestBytes = await crypto.subtle.digest('SHA-256', shellBytes);
  const digest = Array.from(new Uint8Array(digestBytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return digest === SHELL_DIGEST;
}

function isExactResponseForRequest(response, requestUrl) {
  if (response.redirected) {
    return false;
  }
  const responseUrl = new URL(response.url);
  return (
    responseUrl.origin === self.location.origin &&
    responseUrl.pathname === requestUrl.pathname &&
    responseUrl.search === requestUrl.search
  );
}

async function precacheShell() {
  try {
    const entries = await Promise.all(
      SHELL_ASSETS.map(async (asset) => {
        const requestUrl = new URL(asset, self.location.origin);
        const response = await fetch(requestUrl.href, { cache: 'reload' });
        if (!response.ok || !isExactResponseForRequest(response, requestUrl)) {
          throw new Error(`Shell asset ${asset} did not return an exact successful response.`);
        }
        if (
          (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') &&
          !(await hasExactShellDigest(response))
        ) {
          throw new Error(`Shell document ${asset} did not match the exact build bytes.`);
        }
        return [asset, response];
      }),
    );
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(entries.map(([asset, response]) => cache.put(asset, response)));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('open-voice-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
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
          if (
            isSpaAppRoute(url.pathname) &&
            response.ok &&
            isExactResponseForRequest(response, url) &&
            (await hasExactShellDigest(response))
          ) {
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
