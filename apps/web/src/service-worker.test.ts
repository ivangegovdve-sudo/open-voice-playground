import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://open-voice.test';
const VERSION = '111111111111';
const CATALOG_URL = '/assets/launch-catalog.public-deadbeef.json';
const SHELL = '<!doctype html><title>Trusted shell</title>';
const CATALOG = new TextEncoder().encode('{"catalog":"trusted"}\n');
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));

type CacheDouble = {
  delete(request: RequestInfo | URL): Promise<boolean>;
  keys(): Promise<Request[]>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
};

function responseAt(url: string, body: BodyInit, init: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperties(response, {
    redirected: { value: false },
    url: { value: new URL(url, ORIGIN).href },
  });
  return response;
}

async function createHarness(
  catalogResponse: () => Promise<Response>,
  initialCaches: readonly string[] = [],
  failPutCacheName?: string,
) {
  const source = await readFile(join(TEST_ROOT, '..', 'public', 'sw.js'), 'utf8');
  for (const marker of [
    '__VITE_CACHE_VERSION__',
    '__VITE_SHELL_DIGEST__',
    '__VITE_BUILD_ASSETS__',
    '__VITE_CATALOG_URL__',
    '__VITE_CATALOG_DIGEST__',
    '__VITE_CATALOG_BYTES__',
  ]) {
    if (!source.includes(marker))
      throw new Error(`Missing service-worker fixture marker ${marker}`);
  }
  const shellDigest = createHash('sha256').update(SHELL).digest('hex');
  const catalogDigest = `sha256:${createHash('sha256').update(CATALOG).digest('hex')}`;
  const script = source
    .replace(
      "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__",
      `const CACHE_VERSION = '${VERSION}';`,
    )
    .replace(
      "const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__",
      `const SHELL_DIGEST = '${shellDigest}';`,
    )
    .replace('const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__', 'const BUILD_ASSETS = [];')
    .replace(
      "const CATALOG_URL = 'development'; // __VITE_CATALOG_URL__",
      `const CATALOG_URL = '${CATALOG_URL}';`,
    )
    .replace(
      "const CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__",
      `const CATALOG_DIGEST = '${catalogDigest}';`,
    )
    .replace(
      'const CATALOG_BYTES = 0; // __VITE_CATALOG_BYTES__',
      `const CATALOG_BYTES = ${CATALOG.byteLength};`,
    );

  const records = new Map<string, Map<string, Response>>(
    initialCaches.map((name) => [name, new Map()]),
  );
  const normalize = (request: RequestInfo | URL) =>
    new URL(
      typeof request === 'string'
        ? request
        : request instanceof Request
          ? request.url
          : request.href,
      ORIGIN,
    ).href;
  const caches = {
    delete: vi.fn(async (name: string) => records.delete(name)),
    keys: vi.fn(async () => [...records.keys()]),
    open: vi.fn(async (name: string): Promise<CacheDouble> => {
      const entries = records.get(name) ?? new Map<string, Response>();
      records.set(name, entries);
      return {
        delete: async (request) => entries.delete(normalize(request)),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        match: async (request) => entries.get(normalize(request))?.clone(),
        put: async (request, response) => {
          if (name === failPutCacheName)
            throw new DOMException('Storage full.', 'QuotaExceededError');
          entries.set(normalize(request), response.clone());
        },
      };
    }),
  };
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = normalize(input);
    if (url === new URL(CATALOG_URL, ORIGIN).href) return catalogResponse();
    const pathname = new URL(url).pathname;
    if (pathname === '/' || pathname === '/index.html') {
      return responseAt(url, SHELL, { headers: { 'content-type': 'text/html' }, status: 200 });
    }
    return responseAt(url, '{}', { status: 200 });
  });
  const workerGlobal = {
    addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(name, listener);
    },
    clients: { claim },
    location: { origin: ORIGIN },
    skipWaiting,
  };
  vm.runInNewContext(script, {
    Array,
    Headers,
    Map,
    Promise,
    Request,
    Response,
    Set,
    TextDecoder,
    Uint8Array,
    URL,
    caches,
    crypto: webcrypto,
    fetch: fetcher,
    self: workerGlobal,
  });

  return { caches, claim, fetcher, listeners, records, skipWaiting };
}

async function dispatchWaitUntil(
  listeners: Map<string, (event: Record<string, unknown>) => void>,
  type: string,
): Promise<void> {
  let work: Promise<unknown> | undefined;
  listeners.get(type)?.({
    waitUntil(value: Promise<unknown>) {
      work = value;
    },
  });
  if (work === undefined) throw new Error(`No ${type} waitUntil work was registered.`);
  await work;
}

async function dispatchFetch(
  listeners: Map<string, (event: Record<string, unknown>) => void>,
  path: string,
): Promise<Response | undefined> {
  let response: Promise<Response> | undefined;
  listeners.get('fetch')?.({
    request: new Request(new URL(path, ORIGIN)),
    respondWith(value: Promise<Response>) {
      response = value;
    },
  });
  return response === undefined ? undefined : await response;
}

describe('service worker catalog/shell install pair', () => {
  it('promotes both exact caches before calling skipWaiting', async () => {
    const harness = await createHarness(async () =>
      responseAt(CATALOG_URL, CATALOG, {
        headers: {
          'content-length': String(CATALOG.byteLength),
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      }),
    );

    await dispatchWaitUntil(harness.listeners, 'install');

    expect(harness.records.has(`open-voice-shell-${VERSION}`)).toBe(true);
    expect(harness.records.has(`open-voice-launch-catalog-${VERSION}`)).toBe(true);
    expect(harness.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each([
    ['unavailable', async () => responseAt(CATALOG_URL, 'missing', { status: 503 })],
    [
      'oversized',
      async () =>
        responseAt(CATALOG_URL, new Uint8Array(CATALOG.byteLength + 1), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ],
    [
      'wrong digest',
      async () =>
        responseAt(CATALOG_URL, new Uint8Array(CATALOG.byteLength), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ],
  ])('rejects a %s catalog without disturbing the incumbent pair', async (_label, response) => {
    const incumbent = ['open-voice-shell-000000000000', 'open-voice-launch-catalog-000000000000'];
    const harness = await createHarness(response, incumbent);

    await expect(dispatchWaitUntil(harness.listeners, 'install')).rejects.toThrow();
    expect([...harness.records.keys()].sort()).toEqual([...incumbent].sort());
    expect(harness.skipWaiting).not.toHaveBeenCalled();
  });

  it('activation removes stale shell/catalog pairs and then claims clients', async () => {
    const harness = await createHarness(
      async () =>
        responseAt(CATALOG_URL, CATALOG, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      [
        `open-voice-shell-${VERSION}`,
        `open-voice-launch-catalog-${VERSION}`,
        'open-voice-shell-stale',
        'open-voice-launch-catalog-stale',
        'unrelated-cache',
      ],
    );

    await dispatchWaitUntil(harness.listeners, 'activate');

    expect([...harness.records.keys()].sort()).toEqual(
      [
        `open-voice-shell-${VERSION}`,
        `open-voice-launch-catalog-${VERSION}`,
        'unrelated-cache',
      ].sort(),
    );
    expect(harness.claim).toHaveBeenCalledOnce();
  });

  it('removes both new caches when catalog storage fails and preserves the incumbent pair', async () => {
    const incumbent = ['open-voice-shell-000000000000', 'open-voice-launch-catalog-000000000000'];
    const harness = await createHarness(
      async () =>
        responseAt(CATALOG_URL, CATALOG, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      incumbent,
      `open-voice-launch-catalog-${VERSION}`,
    );

    await expect(dispatchWaitUntil(harness.listeners, 'install')).rejects.toThrow(/storage full/i);
    expect([...harness.records.keys()].sort()).toEqual([...incumbent].sort());
    expect(harness.skipWaiting).not.toHaveBeenCalled();
  });

  it('never admits Worker, dynamic inference, WASM, or model assets into the shell cache', async () => {
    const harness = await createHarness(async () =>
      responseAt(CATALOG_URL, CATALOG, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    await dispatchWaitUntil(harness.listeners, 'install');

    for (const path of [
      '/assets/runtime.worker-deadbeef.js',
      '/assets/inference-deadbeef.js',
      '/assets/runtime-deadbeef.wasm',
      '/assets/model-deadbeef.bin',
    ]) {
      await expect(dispatchFetch(harness.listeners, path)).resolves.toBeUndefined();
    }
    const shellEntries = harness.records.get(`open-voice-shell-${VERSION}`)!;
    expect([...shellEntries.keys()]).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/worker|inference|\.wasm|\.bin/i)]),
    );
  });

  it('never prefetches or caches Pocket demo, blog, model, embedding, prompt, or audio URLs', async () => {
    const harness = await createHarness(async () =>
      responseAt(CATALOG_URL, CATALOG, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    await dispatchWaitUntil(harness.listeners, 'install');

    const requestedUrls = harness.fetcher.mock.calls.map(
      ([input]) => new URL(String(input), ORIGIN),
    );
    const cachedUrls = [...harness.records.values()].flatMap((entries) =>
      [...entries.keys()].map((url) => new URL(url)),
    );
    const allUrls = [...requestedUrls, ...cachedUrls];
    expect(allUrls.every(({ origin }) => origin === ORIGIN)).toBe(true);
    for (const forbidden of [
      'https://kyutai.org/tts',
      'https://kyutai.org/blog/2026-05-04-pocket-tts-multilingual/',
      'https://huggingface.co/kyutai/pocket-tts',
      'https://huggingface.co/kyutai/tts-voices',
      'prompt',
      '.wav',
      '.mp3',
    ]) {
      expect(allUrls.map(String).join('\n')).not.toContain(forbidden);
    }
  });
});
