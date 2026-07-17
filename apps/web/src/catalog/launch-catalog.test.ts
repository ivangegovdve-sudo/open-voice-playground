import { afterEach, describe, expect, it, vi } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import launchIntegrity from '../../../../packages/catalog/data/launch-catalog.integrity.json';
import launchRaw from '../../../../packages/catalog/data/launch-catalog.public.json?raw';
import { seedCatalog } from './catalog';
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
    expect(catalog.runtimeArtifacts.map(({ id }) => id)).toEqual([
      'onnxruntime-web-wasm-runtime',
      'onnxruntime-web-webgpu-jsep-wasm',
    ]);
    expect(catalog.runtimeSelections.map(({ id }) => id)).toEqual([
      'supertonic-wasm',
      'supertonic-webgpu',
    ]);
    expect(catalog.runtimeSelections[1]).toMatchObject({
      backend: 'webgpu',
      assetSetId: 'supertonic-browser-assets',
      runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm',
    });
    expect(catalog.pocketCoverage).toEqual(launchJson.pocketCoverage);
    expect(catalog.pocketCoverage).not.toBe(launchJson.pocketCoverage);
    expect(catalog.pocketCoverage?.variants).not.toBe(launchJson.pocketCoverage.variants);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('requires schema v4 coverage and the accepted S1 runtime arrays', () => {
    const missingArtifacts = structuredClone(launchJson) as Record<string, unknown>;
    delete missingArtifacts.runtimeArtifacts;
    expect(() => mapLaunchCatalog(missingArtifacts)).toThrow(/required public fields/i);

    const missingSelections = structuredClone(launchJson) as Record<string, unknown>;
    delete missingSelections.runtimeSelections;
    expect(() => mapLaunchCatalog(missingSelections)).toThrow(/required public fields/i);

    const missingCoverage = structuredClone(launchJson) as Record<string, unknown>;
    delete missingCoverage.pocketCoverage;
    expect(() => mapLaunchCatalog(missingCoverage)).toThrow(/required public fields/i);

    expect(() => mapLaunchCatalog({ ...launchJson, schemaVersion: 3 })).toThrow(
      /required public fields/i,
    );

    expect(() => mapLaunchCatalog({ ...launchJson, unexpected: true })).toThrow(
      /required public fields/i,
    );
  });

  it('retains strict S1 runtime artifact and selection identities', () => {
    const duplicateArtifacts = structuredClone(launchJson);
    duplicateArtifacts.runtimeArtifacts[1] = structuredClone(
      duplicateArtifacts.runtimeArtifacts[0]!,
    );
    expect(() => mapLaunchCatalog(duplicateArtifacts)).toThrow(/duplicate runtime artifact/i);

    const malformedSelection = structuredClone(launchJson);
    malformedSelection.runtimeSelections[0]!.runtimeArtifactId = '';
    expect(() => mapLaunchCatalog(malformedSelection)).toThrow(/malformed runtime selection/i);
  });

  it('rejects Pocket coverage count, summary, identity, and runtime collisions', () => {
    const missingVariant = structuredClone(launchJson);
    missingVariant.pocketCoverage.variants.pop();
    expect(() => mapLaunchCatalog(missingVariant)).toThrow(/312|coverage/i);

    const wrongLanguageSummary = structuredClone(launchJson);
    wrongLanguageSummary.pocketCoverage.languageCounts.de = 51 as 52;
    expect(() => mapLaunchCatalog(wrongLanguageSummary)).toThrow(/coverage|language/i);

    const wrongRightsSummary = structuredClone(launchJson);
    wrongRightsSummary.pocketCoverage.rightsCounts.catalogOnlyRuntimeCandidate = 239 as 240;
    expect(() => mapLaunchCatalog(wrongRightsSummary)).toThrow(/coverage|rights/i);

    const duplicateVariant = structuredClone(launchJson);
    duplicateVariant.pocketCoverage.variants[1] = structuredClone(
      duplicateVariant.pocketCoverage.variants[0]!,
    );
    expect(() => mapLaunchCatalog(duplicateVariant)).toThrow(/duplicate.*Pocket|coverage/i);

    const runtimeCollision = structuredClone(launchJson);
    runtimeCollision.voices.find(({ engineId }) => engineId === 'pocket')!.id =
      runtimeCollision.pocketCoverage.variants[0]!.id;
    expect(() => mapLaunchCatalog(runtimeCollision)).toThrow(
      /Pocket coverage runtime ID collision/i,
    );
  });

  it.each([
    ['selectorCount', 11],
    ['labelCount', 25],
    ['totalEmbeddings', 311],
    ['publishedOutputClipCount', 1],
  ])('rejects a wrong Pocket %s summary', (field, value) => {
    const wrongSummary = structuredClone(launchJson);
    (wrongSummary.pocketCoverage as unknown as Record<string, unknown>)[field] = value;

    expect(() => mapLaunchCatalog(wrongSummary)).toThrow(/coverage|summary/i);
  });

  it('keeps fixture carriage explicitly empty and rejects Pocket audit-source drift', () => {
    expect(seedCatalog.pocketCoverage).toBeNull();

    const missingAuditSource = structuredClone(launchJson);
    missingAuditSource.pocketCoverage.auditSourceIds.pop();
    expect(() => mapLaunchCatalog(missingAuditSource)).toThrow(/coverage|audit/i);
  });

  it.each(['2026-02-31T00:00:00Z', '2026-01-01T24:00:00Z'])(
    'rejects impossible Pocket official-demo datetime %s',
    (reviewedAt) => {
      const impossibleDatetime = structuredClone(launchJson);
      impossibleDatetime.pocketCoverage.officialDemo.reviewedAt = reviewedAt;

      expect(() => mapLaunchCatalog(impossibleDatetime)).toThrow(/official demo/i);
    },
  );

  it('accepts the canonical Pocket official-demo datetime', () => {
    const catalog = mapLaunchCatalog(launchJson);

    expect(catalog.pocketCoverage?.officialDemo.reviewedAt).toBe('2026-07-16T00:00:00.000Z');
  });

  it('rejects runtime closure records whose exact frozen identity drifts', () => {
    const wrongTarball = structuredClone(launchJson);
    wrongTarball.runtimeArtifacts[0]!.tarballUrl =
      'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.1.tgz';
    expect(() => mapLaunchCatalog(wrongTarball)).toThrow(/runtime artifact closure drift/i);

    const wrongTarballSha1 = structuredClone(launchJson);
    wrongTarballSha1.runtimeArtifacts[0]!.tarballSha1 = `sha1:${'0'.repeat(40)}`;
    expect(() => mapLaunchCatalog(wrongTarballSha1)).toThrow(/runtime artifact closure drift/i);

    const unsafePackagePath = structuredClone(launchJson);
    unsafePackagePath.runtimeArtifacts[0]!.packagePath = '../evil.wasm';
    expect(() => mapLaunchCatalog(unsafePackagePath)).toThrow(/runtime artifact closure drift/i);

    const wrongSelectionDigest = structuredClone(launchJson);
    wrongSelectionDigest.runtimeSelections[0]!.selectionDigest = `sha256:${'0'.repeat(64)}`;
    expect(() => mapLaunchCatalog(wrongSelectionDigest)).toThrow(
      /runtime selection closure drift/i,
    );

    const wrongAssetSetAnchor = structuredClone(launchJson);
    wrongAssetSetAnchor.assetSets.find(
      ({ id }) => id === 'supertonic-browser-assets',
    )!.manifestDigest = `sha256:${'0'.repeat(64)}`;
    expect(() => mapLaunchCatalog(wrongAssetSetAnchor)).toThrow(/runtime selection closure drift/i);

    const swappedSelectionIds = structuredClone(launchJson);
    const firstSelectionId = swappedSelectionIds.runtimeSelections[0]!.id;
    swappedSelectionIds.runtimeSelections[0]!.id = swappedSelectionIds.runtimeSelections[1]!.id;
    swappedSelectionIds.runtimeSelections[1]!.id = firstSelectionId;
    expect(() => mapLaunchCatalog(swappedSelectionIds)).toThrow(/runtime selection closure drift/i);
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
    expect(() => mapLaunchCatalog({ schemaVersion: 4, catalogId: 'open-voice-launch' })).toThrow(
      /invalid launch catalog/i,
    );
    expect(() => mapLaunchCatalog({ ...launchJson, voices: launchJson.voices.slice(1) })).toThrow(
      /426/i,
    );
    const countDrift = structuredClone(launchJson);
    countDrift.voices.find(({ engineId }) => engineId === 'edge')!.engineId = 'kokoro';
    expect(() => mapLaunchCatalog(countDrift)).toThrow(/per-engine preset count drift/i);
  });
});
