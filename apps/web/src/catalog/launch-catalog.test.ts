import { afterEach, describe, expect, it, vi } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import launchIntegrity from '../../../../packages/catalog/data/launch-catalog.integrity.json';
import launchRaw from '../../../../packages/catalog/data/launch-catalog.public.json?raw';
import { EMPTY_FILTERS, filterVoices } from './filters';
import {
  createTestOnlyLaunchCatalogLoader,
  loadLaunchCatalog,
  mapLaunchCatalog,
} from './launch-catalog';

const CONTENT_ADDRESSED_URL = new URL(
  '/assets/launch-catalog.public-deadbeef.json',
  window.location.href,
).href;
const CATALOG_CACHE = 'open-voice-launch-catalog-deadbeef';

function testLoader(url = '/launch-catalog.json') {
  return createTestOnlyLaunchCatalogLoader(url);
}

function launchResponse(body: BodyInit = launchRaw, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(body, { ...init, headers });
}

function installCatalogCache(initial?: Response) {
  const entries = new Map<string, Response>();
  const normalize = (request: RequestInfo | URL) =>
    new URL(
      typeof request === 'string'
        ? request
        : request instanceof Request
          ? request.url
          : request.href,
      window.location.href,
    ).href;
  if (initial !== undefined) entries.set(CONTENT_ADDRESSED_URL, initial.clone());
  const cache = {
    match: vi.fn(async (request: RequestInfo | URL) => entries.get(normalize(request))?.clone()),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
      entries.set(normalize(request), response.clone());
    }),
    delete: vi.fn(async (request: RequestInfo | URL) => entries.delete(normalize(request))),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
  } as unknown as Cache;
  const storage = {
    keys: vi.fn(async () => [CATALOG_CACHE]),
    open: vi.fn(async () => cache),
  } as unknown as CacheStorage;
  vi.stubGlobal('caches', storage);
  return { cache, entries, storage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('launch catalog web adapter', () => {
  it('maps the checked-in 426-preset catalog without network or runtime I/O', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const catalog = mapLaunchCatalog(launchJson);

    expect(catalog.kind).toBe('launch');
    expect(catalog.voices).toHaveLength(426);
    expect(catalog.engines).toHaveLength(6);
    expect(catalog.galleries).toHaveLength(12);
    expect(catalog.generatedMedia).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('matches multilingual voices by any published language tag, name, or region', () => {
    const catalog = mapLaunchCatalog(launchJson);
    const supertonic = catalog.voices.find(({ id }) => id === 'supertonic:F1')!;

    expect(supertonic.languageTags).toContain('bg');
    expect(supertonic.languages).toContain('Bulgarian');
    expect(
      filterVoices(catalog.voices, { ...EMPTY_FILTERS, locale: ['bg'] }).map(({ id }) => id),
    ).toContain('supertonic:F1');
    expect(
      filterVoices(catalog.voices, { ...EMPTY_FILTERS, lang: ['Bulgarian'] }).map(({ id }) => id),
    ).toContain('supertonic:F1');
  });

  it('fetches the external catalog only on explicit load and omits credentials', async () => {
    const fetcher = vi.fn(async () => launchResponse());

    expect(fetcher).not.toHaveBeenCalled();
    const catalog = await testLoader()(fetcher);

    expect(catalog.voices).toHaveLength(426);
    expect(fetcher).toHaveBeenCalledWith('/launch-catalog.json', {
      cache: 'no-store',
      credentials: 'omit',
    });
  });

  it('revalidates a versioned content-addressed offline fallback', async () => {
    const { entries } = installCatalogCache(launchResponse());
    const online = vi.fn(async () => launchResponse());

    await expect(testLoader(CONTENT_ADDRESSED_URL)(online)).resolves.toMatchObject({
      kind: 'launch',
    });
    expect(entries.has(CONTENT_ADDRESSED_URL)).toBe(true);

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(testLoader(CONTENT_ADDRESSED_URL)(offline)).resolves.toMatchObject({
      kind: 'launch',
      catalogId: 'open-voice-launch',
    });
    expect(offline).toHaveBeenCalledOnce();
  });

  it('deletes a malformed cached catalog and fails closed without fixture data', async () => {
    const poisonedBytes = launchRaw.replace(
      '"displayName": "Edge voice metadata"',
      '"displayName": "Edgf voice metadata"',
    );
    const { cache } = installCatalogCache(launchResponse(poisonedBytes));
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(testLoader(CONTENT_ADDRESSED_URL)(offline)).rejects.toThrow(/failed to fetch/i);
    expect(cache.delete).toHaveBeenCalledWith(CONTENT_ADDRESSED_URL);
  });

  it('rejects one-byte and same-count semantic network tampering', async () => {
    const oneByteChanged = `${launchRaw.slice(0, -2)} ${launchRaw.slice(-1)}`;
    const sameCountTamper = launchRaw.replace(
      '"displayName": "Edge voice metadata"',
      '"displayName": "Edgf voice metadata"',
    );

    await expect(
      testLoader('/launch-catalog-one-byte.json')(
        vi.fn(async () => launchResponse(oneByteChanged)),
      ),
    ).rejects.toThrow(/exact-byte integrity/i);
    await expect(
      testLoader('/launch-catalog-same-count.json')(
        vi.fn(async () => launchResponse(sameCountTamper)),
      ),
    ).rejects.toThrow(/exact-byte integrity/i);
  });

  it('rejects a redirected or mismatched catalog asset URL before cache promotion', async () => {
    const response = launchResponse();
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://example.test/assets/launch-catalog.public-deadbeef.json' },
    });

    await expect(testLoader()(vi.fn(async () => response))).rejects.toThrow(
      /response URL.*exact requested asset URL/i,
    );
  });

  it('preserves and serves the prior verified cache when a same-URL network body changes', async () => {
    const sameCountTamper = launchRaw.replace(
      '"displayName": "Edge voice metadata"',
      '"displayName": "Edgf voice metadata"',
    );
    const { cache } = installCatalogCache(launchResponse());
    const changedNetwork = vi.fn(async () => launchResponse(sameCountTamper));

    await expect(testLoader(CONTENT_ADDRESSED_URL)(changedNetwork)).resolves.toMatchObject({
      catalogId: 'open-voice-launch',
      kind: 'launch',
    });
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('rejects any production custom URL argument before a request', async () => {
    const fetcher = vi.fn(async () => launchResponse());
    const productionLoader = loadLaunchCatalog as unknown as (
      fetcher: typeof fetch,
      forbiddenUrl: string,
    ) => Promise<unknown>;

    await expect(productionLoader(fetcher, '/launch-catalog.json')).rejects.toThrow(/fixed.*url/i);
    await expect(
      productionLoader(fetcher, 'https://attacker.example/catalog.json'),
    ).rejects.toThrow(/fixed.*url/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects HTML content even when its body is the exact valid catalog bytes', async () => {
    const html = vi.fn(
      async () => new Response(launchRaw, { headers: { 'content-type': 'text/html' } }),
    );

    await expect(testLoader()(html)).rejects.toThrow(/application\/json content type/i);
  });

  it.each([
    'application/javascript',
    'application/jsonp',
    'application/json; charset=utf-8; profile=evil',
    'text/html; application/json',
  ])('rejects non-exact JSON MIME type %s', async (contentType) => {
    await expect(
      testLoader()(
        vi.fn(async () => launchResponse(launchRaw, { headers: { 'content-type': contentType } })),
      ),
    ).rejects.toThrow(/application\/json content type/i);
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/JSON;CHARSET="UTF-8"',
  ])('accepts strict JSON MIME type %s', async (contentType) => {
    await expect(
      testLoader()(
        vi.fn(async () => launchResponse(launchRaw, { headers: { 'content-type': contentType } })),
      ),
    ).resolves.toMatchObject({ catalogId: 'open-voice-launch' });
  });

  it.each([
    ['missing bytes', launchIntegrity.bytes - 1],
    ['extra bytes', launchIntegrity.bytes + 1],
  ])('rejects a declared Content-Length with %s before parsing', async (_label, bytes) => {
    const reader = { cancel: vi.fn(async () => undefined) };
    const response = launchResponse(launchRaw, {
      headers: {
        'content-length': String(bytes),
        'content-type': 'application/json',
      },
    });
    Object.defineProperty(response, 'body', { value: reader });

    await expect(testLoader()(vi.fn(async () => response))).rejects.toThrow(/exact.*byte|length/i);
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it('rejects truncated and overflowing streams when Content-Length is absent', async () => {
    const valid = new TextEncoder().encode(launchRaw);
    for (const bytes of [valid.subarray(0, -1), new Uint8Array([...valid, 0x20])]) {
      const response = launchResponse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }) as unknown as BodyInit,
      );

      await expect(testLoader()(vi.fn(async () => response))).rejects.toThrow(
        /exact.*byte|length/i,
      );
    }
  });

  it('cancels the reader as soon as a catalog stream exceeds the exact byte cap', async () => {
    const overflow = new Uint8Array(launchIntegrity.bytes + 1);
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: overflow })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel,
      releaseLock: vi.fn(),
    };
    const response = launchResponse();
    Object.defineProperty(response, 'body', {
      value: { getReader: () => reader, cancel },
    });

    await expect(testLoader()(vi.fn(async () => response))).rejects.toThrow(
      /overflow|exact.*byte/i,
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels and rejects a failing catalog reader', async () => {
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi.fn(async () => {
        throw new Error('reader failed');
      }),
      cancel,
      releaseLock: vi.fn(),
    };
    const response = launchResponse();
    Object.defineProperty(response, 'body', {
      value: { getReader: () => reader, cancel },
    });

    await expect(testLoader()(vi.fn(async () => response))).rejects.toThrow(/integrity|schema/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an incomplete or unexpected public payload', () => {
    expect(() => mapLaunchCatalog({ schemaVersion: 2, catalogId: 'open-voice-launch' })).toThrow(
      /invalid launch catalog/i,
    );
    expect(() => mapLaunchCatalog({ ...launchJson, voices: launchJson.voices.slice(1) })).toThrow(
      /426/i,
    );
    expect(() => mapLaunchCatalog({ ...launchJson, unexpected: true })).toThrow(
      /invalid launch catalog/i,
    );
    const countDrift = structuredClone(launchJson);
    countDrift.voices.find(({ engineId }) => engineId === 'edge')!.engineId = 'kokoro';
    expect(() => mapLaunchCatalog(countDrift)).toThrow(/per-engine preset count drift/i);
  });
});
