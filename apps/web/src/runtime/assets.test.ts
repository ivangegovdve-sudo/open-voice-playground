import { describe, expect, it, vi } from 'vitest';

import type { AssetSetManifest } from '@open-voice/contracts';

import {
  AssetPreparationManager,
  AssetPreparationError,
  createBrowserStorageManagerPort,
  createConsentReceipt,
  createSha256Digest,
  type AssetStorePort,
  type AssetTemporarySink,
  type StreamingDigest,
} from './assets';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const HASH = 'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';

function manifest(overrides: Partial<AssetSetManifest> = {}): AssetSetManifest {
  return {
    id: 'test-browser-assets',
    engineId: 'test-engine',
    manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
    assets: [
      {
        id: 'test-model',
        url: 'https://example.com/model/0123456789abcdef0123456789abcdef01234567/model.onnx',
        approvedFinalOrigins: ['https://assets.example.com'],
        revision: '0123456789abcdef0123456789abcdef01234567',
        sha256: HASH,
        bytes: BYTES.byteLength,
        cacheKey: 'test/model/0123456789ab',
        mediaType: 'application/onnx',
        sourceIds: ['test-source'],
        licenseIds: ['test-license'],
        requiredAcceptance: null,
      },
    ],
    totalBytes: BYTES.byteLength,
    requiredAcceptanceLicenseIds: ['test-license'],
    releaseGate: { status: 'enabled', reason: null, detail: 'Test asset gate.' },
    ...overrides,
  };
}

class MemoryAssetStore implements AssetStorePort {
  readonly final = new Map<string, Uint8Array>();
  readonly temporary = new Map<string, Uint8Array>();
  readonly events: string[] = [];
  failPutWith: Error | null = null;

  async has(cacheKey: string, sha256: string, bytes: number) {
    this.events.push(`has:${cacheKey}`);
    const value = this.final.get(cacheKey);
    return value?.byteLength === bytes && sha256 === HASH;
  }

  async createTemporary(key: string): Promise<AssetTemporarySink> {
    this.events.push(`create:${key}`);
    const chunks: Uint8Array[] = [];
    return {
      write: async (bytes) => {
        this.events.push(`write:${key}:${bytes.byteLength}`);
        if (this.failPutWith !== null) throw this.failPutWith;
        chunks.push(bytes.slice());
      },
      close: async () => {
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this.temporary.set(key, bytes);
      },
      abort: async () => {
        this.events.push(`abort:${key}`);
        chunks.length = 0;
        this.temporary.delete(key);
      },
    };
  }

  async promote(key: string, cacheKey: string, _identity: { sha256: string; bytes: number }) {
    this.events.push(`promote:${key}:${cacheKey}`);
    const value = this.temporary.get(key);
    if (value === undefined) throw new Error('missing temporary asset');
    this.final.set(cacheKey, value);
    this.temporary.delete(key);
  }

  async deleteTemporary(key: string) {
    this.events.push(`delete:${key}`);
    this.temporary.delete(key);
  }

  async readVerified(cacheKey: string, sha256: string, bytes: number): Promise<ArrayBuffer | null> {
    this.events.push(`read:${cacheKey}`);
    const value = this.final.get(cacheKey);
    if (value === undefined || value.byteLength !== bytes || sha256 !== HASH) return null;
    return value.slice().buffer;
  }
}

function withResponseMetadata(
  response: Response,
  url = 'https://assets.example.com/model.onnx',
  type: ResponseType = 'cors',
): Response {
  Object.defineProperties(response, {
    type: { configurable: true, value: type },
    url: { configurable: true, value: url },
  });
  return response;
}

function response(
  bytes: Uint8Array<ArrayBuffer>,
  contentLength = bytes.byteLength,
  metadata: { url?: string; type?: ResponseType; status?: number } = {},
): Response {
  return withResponseMetadata(
    new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      headers: { 'content-length': String(contentLength) },
      status: metadata.status ?? 200,
    }),
    metadata.url,
    metadata.type,
  );
}

function streamedResponse(
  chunks: readonly Uint8Array<ArrayBuffer>[],
  contentLength?: number,
  onCancel?: (reason: unknown) => void,
): Response {
  let index = 0;
  const source: UnderlyingDefaultSource<Uint8Array<ArrayBuffer>> = {
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    ...(onCancel === undefined ? {} : { cancel: onCancel }),
  };
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(source);
  return withResponseMetadata(
    new Response(stream, {
      status: 200,
      ...(contentLength === undefined
        ? {}
        : { headers: { 'content-length': String(contentLength) } }),
    }),
  );
}

function fixedDigest(value: string): () => StreamingDigest {
  return () => ({ update() {}, digest: async () => value });
}

function manager(
  store: MemoryAssetStore,
  fetcher: typeof fetch = vi.fn(async () => response(BYTES)),
  createDigest: () => StreamingDigest = vi.fn(fixedDigest(HASH)),
) {
  return {
    fetcher,
    createDigest,
    instance: new AssetPreparationManager({ store, fetcher, createDigest }),
  };
}

describe('consent-gated immutable asset preparation', () => {
  it('hashes arbitrarily split chunks without retaining a whole asset buffer', async () => {
    const digest = createSha256Digest();
    digest.update(new Uint8Array([1]));
    digest.update(new Uint8Array([2, 3]));
    digest.update(new Uint8Array([4]));

    await expect(digest.digest()).resolves.toBe(HASH);
  });

  it('performs zero fetch or storage I/O during construction and inspection', () => {
    const store = new MemoryAssetStore();
    const ports = manager(store);

    expect(ports.fetcher).not.toHaveBeenCalled();
    expect(ports.createDigest).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);
    expect(ports.instance.describe(manifest())).toEqual({
      assetSetId: 'test-browser-assets',
      downloadBytes: 4,
      consentRequired: true,
      requiredLicenseIds: ['test-license'],
    });
    expect(store.events).toEqual([]);
  });

  it('describes a bounded worst-case storage requirement without touching browser storage', () => {
    const store = new MemoryAssetStore();
    const ports = manager(store);

    expect(
      (
        ports.instance as AssetPreparationManager & {
          describeStorage(assetSet: AssetSetManifest): unknown;
        }
      ).describeStorage(manifest()),
    ).toEqual({
      selectedBytes: 4,
      largestAssetBytes: 4,
      safetyMarginBytes: 8 * 1024 * 1024,
      upperBoundBytes: 8 * 1024 * 1024 + 8,
    });
    expect(ports.fetcher).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);
  });

  it('requires an explicit download confirmation even when no license click-through applies', async () => {
    const store = new MemoryAssetStore();
    const ports = manager(store);
    const set = manifest({ requiredAcceptanceLicenseIds: [] });

    expect(ports.instance.describe(set).consentRequired).toBe(true);
    await expect(ports.instance.prepare(set, null)).rejects.toMatchObject({
      code: 'consent-required',
    });
    expect(ports.fetcher).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);
  });

  it('rejects absent or stale consent before any fetch or storage call', async () => {
    const store = new MemoryAssetStore();
    const ports = manager(store);
    const set = manifest();

    await expect(ports.instance.prepare(set, null)).rejects.toThrow(/consent/i);
    await expect(
      ports.instance.prepare(set, {
        ...createConsentReceipt(set, ['test-license']),
        manifestDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).rejects.toThrow(/changed|stale/i);
    expect(ports.fetcher).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);
  });

  it('fetches only the manifest URL with omitted credentials and promotes verified bytes', async () => {
    const store = new MemoryAssetStore();
    const ports = manager(store);
    const set = manifest();
    const progress: number[] = [];

    await ports.instance.prepare(set, createConsentReceipt(set, ['test-license']), {
      onProgress: ({ percent }) => progress.push(percent),
    });

    expect(ports.fetcher).toHaveBeenCalledWith(set.assets[0]!.url, {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    });
    expect(ports.createDigest).toHaveBeenCalledOnce();
    expect(store.final.get('test/model/0123456789ab')).toEqual(BYTES);
    expect(store.temporary.size).toBe(0);
    expect(progress.at(-1)).toBe(100);
  });

  it.each([
    [
      'an unapproved redirect origin',
      response(BYTES, BYTES.byteLength, { url: 'https://unapproved.example/model.onnx' }),
      /origin|redirect|approved/i,
    ],
    [
      'an opaque response',
      response(BYTES, BYTES.byteLength, { type: 'opaque' }),
      /cors|response type/i,
    ],
    ['a response without a final URL', response(BYTES, BYTES.byteLength, { url: '' }), /url/i],
    [
      'a non-200 final status',
      response(BYTES, BYTES.byteLength, { status: 206 }),
      /status|http 206/i,
    ],
  ])('rejects %s before reading or creating temporary storage', async (_name, network, error) => {
    const store = new MemoryAssetStore();
    const getReader = vi.spyOn(network.body!, 'getReader');
    const ports = manager(
      store,
      vi.fn(async () => network),
    );
    const set = manifest();

    await expect(
      ports.instance.prepare(set, createConsentReceipt(set, ['test-license'])),
    ).rejects.toThrow(error);
    expect(getReader).not.toHaveBeenCalled();
    expect(store.events).toEqual([`has:${set.assets[0]!.cacheKey}`]);
    expect(store.temporary.size).toBe(0);
  });

  it.each(['status', 'type', 'url', 'headers'] as const)(
    'converts a throwing Response.%s getter into an owned fail-closed error',
    async (property) => {
      const store = new MemoryAssetStore();
      const network = response(BYTES);
      Object.defineProperty(network, property, {
        configurable: true,
        get() {
          throw new Error(`hostile ${property} getter`);
        },
      });
      const ports = manager(
        store,
        vi.fn(async () => network),
      );
      const set = manifest();

      await expect(
        ports.instance.prepare(set, createConsentReceipt(set, ['test-license'])),
      ).rejects.toMatchObject({
        name: 'AssetPreparationError',
        code: 'unapproved-response',
      });
      expect(store.events).toEqual([`has:${set.assets[0]!.cacheKey}`]);
      expect(store.temporary.size).toBe(0);
    },
  );

  it.each(['body-getter', 'cancel'] as const)(
    'does not let a hostile Response %s mask an owned rejection',
    async (failure) => {
      const store = new MemoryAssetStore();
      const network = response(BYTES, BYTES.byteLength, {
        url: 'https://unapproved.example/model.onnx',
      });
      if (failure === 'body-getter') {
        Object.defineProperty(network, 'body', {
          configurable: true,
          get() {
            throw new Error('hostile body getter');
          },
        });
      } else {
        Object.defineProperty(network.body!, 'cancel', {
          configurable: true,
          value() {
            throw new Error('hostile synchronous cancel');
          },
        });
      }
      const ports = manager(
        store,
        vi.fn(async () => network),
      );
      const set = manifest();

      await expect(
        ports.instance.prepare(set, createConsentReceipt(set, ['test-license'])),
      ).rejects.toMatchObject({
        name: 'AssetPreparationError',
        code: 'unapproved-response',
      });
      expect(store.events).toEqual([`has:${set.assets[0]!.cacheKey}`]);
      expect(store.temporary.size).toBe(0);
    },
  );

  it('converts a throwing approved-response body getter into an owned fail-closed error', async () => {
    const store = new MemoryAssetStore();
    const network = response(BYTES);
    Object.defineProperty(network, 'body', {
      configurable: true,
      get() {
        throw new Error('hostile body getter');
      },
    });
    const ports = manager(
      store,
      vi.fn(async () => network),
    );
    const set = manifest();

    await expect(
      ports.instance.prepare(set, createConsentReceipt(set, ['test-license'])),
    ).rejects.toMatchObject({
      name: 'AssetPreparationError',
      code: 'unapproved-response',
    });
    expect(store.events).toEqual([`has:${set.assets[0]!.cacheKey}`]);
    expect(store.temporary.size).toBe(0);
  });

  it('uses collision-resistant temporary keys across manager instances', async () => {
    const store = new MemoryAssetStore();
    const first = manager(store);
    const second = manager(store);
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);

    await Promise.all([
      first.instance.prepare(set, receipt),
      second.instance.prepare(set, receipt),
    ]);

    const temporaryKeys = store.events
      .filter((event) => event.startsWith('create:'))
      .map((event) => event.slice('create:'.length));
    expect(temporaryKeys).toHaveLength(2);
    expect(new Set(temporaryKeys)).toHaveProperty('size', 2);
  });

  it.each([
    ['truncated', response(new Uint8Array([1, 2]), 2), /truncated|size/i],
    ['oversized header', response(BYTES, 5), /large|size/i],
    ['oversized body', response(new Uint8Array([1, 2, 3, 4, 5]), 5), /large|size/i],
  ])('rejects %s downloads and leaves no partial asset', async (_name, network, error) => {
    const store = new MemoryAssetStore();
    const ports = manager(
      store,
      vi.fn(async () => network),
    );
    const set = manifest();

    await expect(
      ports.instance.prepare(set, createConsentReceipt(set, ['test-license'])),
    ).rejects.toThrow(error);
    expect(store.final.size).toBe(0);
    expect(store.temporary.size).toBe(0);
  });

  it('deletes a temporary asset after hash mismatch or quota failure', async () => {
    const hashStore = new MemoryAssetStore();
    const badHash = manager(
      hashStore,
      vi.fn(async () => response(BYTES)),
      vi.fn(fixedDigest('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    );
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);

    await expect(badHash.instance.prepare(set, receipt)).rejects.toThrow(/hash/i);
    expect(hashStore.temporary.size).toBe(0);

    const quotaStore = new MemoryAssetStore();
    quotaStore.failPutWith = new DOMException('Quota full', 'QuotaExceededError');
    const quota = manager(quotaStore);
    await expect(quota.instance.prepare(set, receipt)).rejects.toThrow(/storage quota/i);
    expect(quotaStore.temporary.size).toBe(0);
  });

  it('estimates and requests persistent storage only after consent, before network I/O', async () => {
    const store = new MemoryAssetStore();
    const storageEvents: string[] = [];
    const storage = {
      estimate: vi.fn(async () => {
        storageEvents.push('estimate');
        return { quota: 64 * 1024 * 1024, usage: 1024 };
      }),
      persist: vi.fn(async () => {
        storageEvents.push('persist');
        return true;
      }),
    };
    const fetcher = vi.fn(async () => {
      storageEvents.push('fetch');
      return response(BYTES);
    });
    const instance = new AssetPreparationManager({
      store,
      fetcher,
      createDigest: fixedDigest(HASH),
      storage,
    } as ConstructorParameters<typeof AssetPreparationManager>[0]);
    const set = manifest();

    await expect(instance.prepare(set, null)).rejects.toMatchObject({ code: 'consent-required' });
    expect(storage.estimate).not.toHaveBeenCalled();
    expect(storage.persist).not.toHaveBeenCalled();
    expect(store.events).toEqual([]);

    const evidence = await instance.prepare(set, createConsentReceipt(set, ['test-license']));
    expect(storageEvents).toEqual(['persist', 'estimate', 'fetch']);
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      kind: 'open-voice-browser-runtime-s0',
      assetSetId: set.id,
      manifestDigest: set.manifestDigest,
      storage: {
        persisted: true,
        quotaBytes: 64 * 1024 * 1024,
        usageBytes: 1024,
        retainedBytes: 0,
        candidateBytes: 4,
        largestTemporaryBytes: 4,
      },
    });
  });

  it('keeps the browser storage-manager lookup lazy until exact consent passes', async () => {
    const browserStorage = {
      estimate: vi.fn(async () => ({ quota: 64 * 1024 * 1024, usage: 0 })),
      persist: vi.fn(async () => true),
    };
    const getStorage = vi.fn(() => browserStorage);
    const storage = createBrowserStorageManagerPort(getStorage);
    const store = new MemoryAssetStore();
    const set = manifest();
    const instance = new AssetPreparationManager({
      store,
      fetcher: vi.fn(async () => response(BYTES)),
      createDigest: fixedDigest(HASH),
      storage,
    });

    expect(getStorage).not.toHaveBeenCalled();
    await expect(instance.prepare(set, null)).rejects.toMatchObject({ code: 'consent-required' });
    expect(getStorage).not.toHaveBeenCalled();

    await instance.prepare(set, createConsentReceipt(set, ['test-license']));
    expect(getStorage).toHaveBeenCalledOnce();
    expect(browserStorage.persist).toHaveBeenCalledOnce();
    expect(browserStorage.estimate).toHaveBeenCalledOnce();
  });

  it('rejects a known insufficient quota before fetching and treats storage API failures as best effort', async () => {
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);
    const store = new MemoryAssetStore();
    const fetcher = vi.fn(async () => response(BYTES));
    const insufficient = new AssetPreparationManager({
      store,
      fetcher,
      createDigest: fixedDigest(HASH),
      storage: {
        persist: vi.fn(async () => false),
        estimate: vi.fn(async () => ({ quota: 100, usage: 99 })),
      },
    } as ConstructorParameters<typeof AssetPreparationManager>[0]);

    await expect(insufficient.prepare(set, receipt)).rejects.toMatchObject({
      code: 'quota-exceeded',
    });
    expect(fetcher).not.toHaveBeenCalled();

    const bestEffortStore = new MemoryAssetStore();
    const bestEffort = new AssetPreparationManager({
      store: bestEffortStore,
      fetcher,
      createDigest: fixedDigest(HASH),
      storage: {
        persist: vi.fn(async () => {
          throw new Error('persist unavailable');
        }),
        estimate: vi.fn(async () => {
          throw new Error('estimate unavailable');
        }),
      },
    } as ConstructorParameters<typeof AssetPreparationManager>[0]);
    const evidence = await bestEffort.prepare(set, receipt);
    expect(evidence).toMatchObject({
      storage: { persisted: null, quotaBytes: null, usageBytes: null },
    });
  });

  it('returns deterministic per-asset provenance and replays a verified cache fully offline', async () => {
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);
    const store = new MemoryAssetStore();
    const first = manager(store);

    const downloaded = await first.instance.prepare(set, receipt);
    expect(downloaded).toMatchObject({
      consent: {
        assetSetId: set.id,
        manifestDigest: set.manifestDigest,
        acceptedLicenseIds: ['test-license'],
      },
      assets: [
        {
          assetId: 'test-model',
          cacheKey: 'test/model/0123456789ab',
          disposition: 'downloaded',
          requestUrl: set.assets[0]!.url,
          finalUrl: 'https://assets.example.com/model.onnx',
          finalOrigin: 'https://assets.example.com',
          responseType: 'cors',
          status: 200,
          expectedBytes: 4,
          observedBytes: 4,
          expectedSha256: HASH,
          observedSha256: HASH,
        },
      ],
    });

    const offlineFetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const replay = manager(store, offlineFetcher);
    const cached = await replay.instance.prepare(set, receipt);
    expect(offlineFetcher).not.toHaveBeenCalled();
    expect(replay.createDigest).not.toHaveBeenCalled();
    expect(cached).toMatchObject({
      assets: [
        {
          assetId: 'test-model',
          disposition: 'cache-hit',
          requestUrl: null,
          finalUrl: null,
          finalOrigin: null,
          responseType: null,
          status: null,
          observedBytes: 4,
          observedSha256: HASH,
        },
      ],
    });
  });

  it('requires exact consent before reading fresh verified bytes for transfer to a Worker', async () => {
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);
    const store = new MemoryAssetStore();
    const ports = manager(store);
    await ports.instance.prepare(set, receipt);
    store.events.length = 0;

    await expect(
      (
        ports.instance as AssetPreparationManager & {
          readPreparedAssets(
            assetSet: AssetSetManifest,
            receipt: ReturnType<typeof createConsentReceipt> | null,
          ): Promise<Array<{ assetId: string; cacheKey: string; bytes: ArrayBuffer }>>;
        }
      ).readPreparedAssets(set, null),
    ).rejects.toMatchObject({ code: 'consent-required' });
    expect(store.events).toEqual([]);

    const prepared = await (
      ports.instance as AssetPreparationManager & {
        readPreparedAssets(
          assetSet: AssetSetManifest,
          receipt: ReturnType<typeof createConsentReceipt> | null,
        ): Promise<Array<{ assetId: string; cacheKey: string; bytes: ArrayBuffer }>>;
      }
    ).readPreparedAssets(set, receipt);
    expect(prepared).toMatchObject([
      {
        assetId: 'test-model',
        cacheKey: 'test/model/0123456789ab',
        sha256: HASH,
        byteLength: 4,
      },
    ]);
    expect(new Uint8Array(prepared[0]!.bytes)).toEqual(BYTES);
    expect(store.events).toEqual(['read:test/model/0123456789ab']);
  });

  it('recovers a corrupt cache entry, refetches after eviction, and leaves no partials', async () => {
    const set = manifest();
    const receipt = createConsentReceipt(set, ['test-license']);
    const store = new MemoryAssetStore();
    store.final.set(set.assets[0]!.cacheKey, new Uint8Array([9]));
    const ports = manager(store);

    await ports.instance.prepare(set, receipt);
    expect(ports.fetcher).toHaveBeenCalledOnce();
    expect(store.final.get(set.assets[0]!.cacheKey)).toEqual(BYTES);
    expect(store.temporary.size).toBe(0);

    store.final.delete(set.assets[0]!.cacheKey);
    await ports.instance.prepare(set, receipt);
    expect(ports.fetcher).toHaveBeenCalledTimes(2);
    expect(store.final.get(set.assets[0]!.cacheKey)).toEqual(BYTES);
    expect(store.temporary.size).toBe(0);
  });

  it('touches only the selected asset set and preserves canonical asset order', async () => {
    const first = manifest();
    const secondAsset = {
      ...first.assets[0]!,
      id: 'second-model',
      url: 'https://example.com/model/0123456789abcdef0123456789abcdef01234567/second.onnx',
      cacheKey: 'test/second/0123456789ab',
    };
    const selected = manifest({
      id: 'selected-assets',
      manifestDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      assets: [first.assets[0]!, secondAsset],
      totalBytes: 8,
    });
    const unselected = manifest({
      id: 'unselected-assets',
      manifestDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      assets: [
        {
          ...first.assets[0]!,
          id: 'unselected-model',
          url: 'https://example.com/model/0123456789abcdef0123456789abcdef01234567/unselected.onnx',
          cacheKey: 'other/model/key',
        },
      ],
    });
    const requested: string[] = [];
    const store = new MemoryAssetStore();
    const instance = new AssetPreparationManager({
      store,
      fetcher: vi.fn(async (url) => {
        requested.push(String(url));
        return response(BYTES);
      }),
      createDigest: fixedDigest(HASH),
    });

    await instance.prepare(selected, createConsentReceipt(selected, ['test-license']));
    expect(requested).toEqual(selected.assets.map(({ url }) => url));
    expect(requested).not.toContain(unselected.assets[0]!.url);
    expect(store.events.filter((event) => event.startsWith('has:'))).toEqual(
      selected.assets.map(({ cacheKey }) => `has:${cacheKey}`),
    );
  });

  it('aborts cancellation and never promotes stale work', async () => {
    const store = new MemoryAssetStore();
    let release!: () => void;
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((resolve, reject) => {
          release = () => resolve(response(BYTES));
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const ports = manager(store, fetcher);
    const set = manifest();
    const controller = new AbortController();
    const preparing = ports.instance.prepare(set, createConsentReceipt(set, ['test-license']), {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    release();

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.final.size).toBe(0);
    expect(store.temporary.size).toBe(0);
  });

  it('streams chunks into temporary storage, incrementally enforces size, and reports progress', async () => {
    const store = new MemoryAssetStore();
    const chunks: number[] = [];
    const digest: StreamingDigest = {
      update(chunk: Uint8Array) {
        chunks.push(chunk.byteLength);
      },
      async digest() {
        return HASH;
      },
    };
    const network = streamedResponse(
      [new Uint8Array([1]), new Uint8Array([2, 3]), new Uint8Array([4])],
      undefined,
    );
    const arrayBuffer = vi
      .spyOn(network, 'arrayBuffer')
      .mockRejectedValue(new Error('not allowed'));
    const progress: number[] = [];
    const instance = new AssetPreparationManager({
      store,
      fetcher: vi.fn(async () => network),
      createDigest: () => digest,
    });
    const set = manifest();

    await instance.prepare(set, createConsentReceipt(set, ['test-license']), {
      onProgress: ({ percent }) => progress.push(percent),
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(chunks).toEqual([1, 2, 1]);
    expect(
      store.events.filter((event) => event.startsWith('write:')).map((event) => event.at(-1)),
    ).toEqual(['1', '2', '1']);
    expect(progress).toEqual([25, 75, 100]);
  });

  it('cancels the response reader and removes a streamed partial on abort', async () => {
    const store = new MemoryAssetStore();
    const cancelled = vi.fn();
    let hold!: ReadableStreamDefaultController<Uint8Array>;
    const network = withResponseMetadata(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            hold = controller;
            controller.enqueue(new Uint8Array([1, 2]));
          },
          cancel: cancelled,
        }),
      ),
    );
    const instance = new AssetPreparationManager({
      store,
      fetcher: vi.fn(async () => network),
      createDigest: fixedDigest(HASH),
    });
    const set = manifest();
    const controller = new AbortController();
    const preparing = instance.prepare(set, createConsentReceipt(set, ['test-license']), {
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(store.events.some((event) => event.includes('write:'))).toBe(true),
    );

    controller.abort();
    hold.error(new DOMException('Aborted', 'AbortError'));

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalled();
    expect(store.final.size).toBe(0);
    expect(store.temporary.size).toBe(0);
  });

  it('uses stable, typed preparation errors', () => {
    expect(new AssetPreparationError('hash-mismatch', 'bad').code).toBe('hash-mismatch');
  });
});
