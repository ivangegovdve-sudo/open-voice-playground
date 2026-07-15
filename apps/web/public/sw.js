/* global self, caches, fetch, URL, Response */

const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__
const SHELL_IDENTITY = 'development'; // __VITE_SHELL_IDENTITY__
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

async function hasExplicitShellIdentity(response) {
  if (!response.headers.get('content-type')?.includes('text/html')) {
    return false;
  }
  const html = await response.clone().text();
  const headStart = /<head(?:\s[^>]*)?>/i.exec(html);
  const headEnd = html.search(/<\/head\s*>/i);
  if (headStart === null || headEnd < headStart.index + headStart[0].length) {
    return false;
  }
  const head = html
    .slice(headStart.index + headStart[0].length, headEnd)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  return head.includes(`<meta name="open-voice-shell" content="${SHELL_IDENTITY}">`);
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
          !(await hasExplicitShellIdentity(response))
        ) {
          throw new Error(`Shell document ${asset} did not match this build identity.`);
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
            (await hasExplicitShellIdentity(response))
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
