/* global self, caches, crypto, fetch, URL, Response */

const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__
const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__
const CATALOG_URL = 'development'; // __VITE_CATALOG_URL__
const CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__
const CATALOG_BYTES = 0; // __VITE_CATALOG_BYTES__
const SHELL_CACHE_NAME = `open-voice-shell-${CACHE_VERSION}`;
const CATALOG_CACHE_NAME = `open-voice-launch-catalog-${CACHE_VERSION}`;
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__
const SHELL_ASSETS = [...new Set([...CORE_ASSETS, ...BUILD_ASSETS])];
const SHELL_ASSET_URLS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset, self.location.origin).href),
);
const SPA_APP_ROUTES = new Set([
  '/',
  '/galleries',
  '/voices',
  '/play',
  '/compare',
  '/companion',
  '/about/sources',
]);

function isRuntimeCacheableStaticAsset(url) {
  return SHELL_ASSET_URLS.has(url.href);
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

async function cancelBody(response, reason) {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Preserve the validation error that caused cancellation.
  }
}

async function readExactBytes(response, expectedBytes) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) !== expectedBytes)
  ) {
    await cancelBody(response, 'Unexpected Content-Length.');
    throw new Error(
      `Expected exactly ${expectedBytes} bytes; Content-Length was ${contentLength}.`,
    );
  }
  if (response.body === null) {
    throw new Error('Response has no readable body.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > expectedBytes) {
        await reader.cancel('Response exceeded the exact byte limit.');
        throw new Error(`Expected exactly ${expectedBytes} bytes; response overflowed.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the read or validation error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (totalBytes !== expectedBytes) {
    throw new Error(`Expected exactly ${expectedBytes} bytes; received ${totalBytes}.`);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function exactSha256(bytes) {
  const digestBytes = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digestBytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
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

async function fetchShellEntries() {
  return Promise.all(
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
}

async function fetchExactCatalog() {
  const requestUrl = new URL(CATALOG_URL, self.location.origin);
  if (requestUrl.origin !== self.location.origin) {
    throw new Error('The built launch catalog URL must be same-origin.');
  }
  const response = await fetch(requestUrl.href, {
    cache: 'reload',
    credentials: 'omit',
  });
  if (!response.ok || !isExactResponseForRequest(response, requestUrl)) {
    await cancelBody(response, 'Catalog URL or status mismatch.');
    throw new Error('Launch catalog did not return an exact successful response.');
  }
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      response.headers.get('content-type') ?? '',
    )
  ) {
    await cancelBody(response, 'Catalog MIME mismatch.');
    throw new Error('Launch catalog did not return strict application/json content.');
  }
  const bytes = await readExactBytes(response, CATALOG_BYTES);
  if ((await exactSha256(bytes)) !== CATALOG_DIGEST) {
    throw new Error('Launch catalog digest did not match the exact build bytes.');
  }
  return new Response(bytes, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function precacheVersionPair() {
  try {
    const [entries, catalogResponse, shellCache, catalogCache] = await Promise.all([
      fetchShellEntries(),
      fetchExactCatalog(),
      caches.open(SHELL_CACHE_NAME),
      caches.open(CATALOG_CACHE_NAME),
    ]);
    await Promise.all([
      ...entries.map(([asset, response]) => shellCache.put(asset, response)),
      catalogCache.put(CATALOG_URL, catalogResponse),
    ]);
    await self.skipWaiting();
  } catch (error) {
    await Promise.all([caches.delete(SHELL_CACHE_NAME), caches.delete(CATALOG_CACHE_NAME)]);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheVersionPair());
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
                (key.startsWith('open-voice-shell-') && key !== SHELL_CACHE_NAME) ||
                (key.startsWith('open-voice-launch-catalog-') && key !== CATALOG_CACHE_NAME),
            )
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

  const catalogUrl = new URL(CATALOG_URL, self.location.origin);
  if (url.pathname === catalogUrl.pathname && url.search === catalogUrl.search) {
    event.respondWith(
      caches.open(CATALOG_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(CATALOG_URL, { ignoreVary: true });
        return cached ?? fetch(request);
      }),
    );
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
            const cache = await caches.open(SHELL_CACHE_NAME);
            await cache.put('/index.html', response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE_NAME);
          return (await cache.match('/index.html', { ignoreVary: true })) ?? Response.error();
        }),
    );
    return;
  }
  if (!isRuntimeCacheableStaticAsset(url)) {
    return;
  }

  event.respondWith(
    caches.open(SHELL_CACHE_NAME).then(async (cache) => {
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
