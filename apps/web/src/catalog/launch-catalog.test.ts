import { afterEach, describe, expect, it, vi } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import launchRaw from '../../../../packages/catalog/data/launch-catalog.public.json?raw';
import { EMPTY_FILTERS, filterVoices } from './filters';
import { loadLaunchCatalog, mapLaunchCatalog } from './launch-catalog';

const CONTENT_ADDRESSED_URL = new URL(
  '/assets/launch-catalog.public-deadbeef.json',
  window.location.href,
).href;

function launchResponse(body = launchRaw, init: ResponseInit = {}): Response {
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
  const storage = { open: vi.fn(async () => cache) } as unknown as CacheStorage;
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
    const catalog = await loadLaunchCatalog(fetcher, '/launch-catalog.json', {
      testOnlyAllowMutableUrl: true,
    });

    expect(catalog.voices).toHaveLength(426);
    expect(fetcher).toHaveBeenCalledWith('/launch-catalog.json', {
      cache: 'no-store',
      credentials: 'omit',
    });
  });

  it('validates before caching and revalidates a content-addressed offline fallback', async () => {
    const { cache, entries } = installCatalogCache();
    const online = vi.fn(async () => launchResponse());

    await expect(
      loadLaunchCatalog(online, CONTENT_ADDRESSED_URL, { testOnlyAllowMutableUrl: true }),
    ).resolves.toMatchObject({
      kind: 'launch',
    });
    expect(cache.put).toHaveBeenCalledOnce();
    expect(entries.has(CONTENT_ADDRESSED_URL)).toBe(true);

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      loadLaunchCatalog(offline, CONTENT_ADDRESSED_URL, { testOnlyAllowMutableUrl: true }),
    ).resolves.toMatchObject({
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

    await expect(
      loadLaunchCatalog(offline, CONTENT_ADDRESSED_URL, { testOnlyAllowMutableUrl: true }),
    ).rejects.toThrow(/failed to fetch/i);
    expect(cache.delete).toHaveBeenCalledWith(CONTENT_ADDRESSED_URL);
  });

  it('rejects one-byte and same-count semantic network tampering', async () => {
    const oneByteChanged = `${launchRaw.slice(0, -2)} ${launchRaw.slice(-1)}`;
    const sameCountTamper = launchRaw.replace(
      '"displayName": "Edge voice metadata"',
      '"displayName": "Edgf voice metadata"',
    );

    await expect(
      loadLaunchCatalog(
        vi.fn(async () => launchResponse(oneByteChanged)),
        '/launch-catalog-one-byte.json',
        { testOnlyAllowMutableUrl: true },
      ),
    ).rejects.toThrow(/exact-byte integrity/i);
    await expect(
      loadLaunchCatalog(
        vi.fn(async () => launchResponse(sameCountTamper)),
        '/launch-catalog-same-count.json',
        { testOnlyAllowMutableUrl: true },
      ),
    ).rejects.toThrow(/exact-byte integrity/i);
  });

  it('rejects a redirected or mismatched catalog asset URL before cache promotion', async () => {
    const response = launchResponse();
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://example.test/assets/launch-catalog.public-deadbeef.json' },
    });

    await expect(
      loadLaunchCatalog(
        vi.fn(async () => response),
        '/launch-catalog.json',
        {
          testOnlyAllowMutableUrl: true,
        },
      ),
    ).rejects.toThrow(/response URL.*exact requested asset URL/i);
  });

  it('preserves and serves the prior verified cache when a same-URL network body changes', async () => {
    const sameCountTamper = launchRaw.replace(
      '"displayName": "Edge voice metadata"',
      '"displayName": "Edgf voice metadata"',
    );
    const { cache } = installCatalogCache(launchResponse());
    const changedNetwork = vi.fn(async () => launchResponse(sameCountTamper));

    await expect(
      loadLaunchCatalog(changedNetwork, CONTENT_ADDRESSED_URL, {
        testOnlyAllowMutableUrl: true,
      }),
    ).resolves.toMatchObject({ catalogId: 'open-voice-launch', kind: 'launch' });
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and mutable production URLs before any request', async () => {
    const fetcher = vi.fn(async () => launchResponse());

    await expect(loadLaunchCatalog(fetcher, '/launch-catalog.json')).rejects.toThrow(
      /same-origin content-addressed/i,
    );
    await expect(
      loadLaunchCatalog(
        fetcher,
        'https://attacker.example/assets/launch-catalog.public-deadbeef.json',
      ),
    ).rejects.toThrow(/same-origin content-addressed/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects HTML content even when its body is the exact valid catalog bytes', async () => {
    const html = vi.fn(
      async () => new Response(launchRaw, { headers: { 'content-type': 'text/html' } }),
    );

    await expect(
      loadLaunchCatalog(html, '/launch-catalog.json', { testOnlyAllowMutableUrl: true }),
    ).rejects.toThrow(/application\/json content type/i);
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
