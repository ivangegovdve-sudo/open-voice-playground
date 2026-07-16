import { describe, expect, it, vi } from 'vitest';

import type { AssetSetManifest } from '@open-voice/contracts';

import {
  AssetPreparationManager,
  AssetPreparationError,
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
}

function response(bytes: Uint8Array<ArrayBuffer>, contentLength = bytes.byteLength): Response {
  return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    headers: { 'content-length': String(contentLength) },
    status: 200,
  });
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
  return new Response(stream, {
    status: 200,
    ...(contentLength === undefined
      ? {}
      : { headers: { 'content-length': String(contentLength) } }),
  });
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
      credentials: 'omit',
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    });
    expect(ports.createDigest).toHaveBeenCalledOnce();
    expect(store.final.get('test/model/0123456789ab')).toEqual(BYTES);
    expect(store.temporary.size).toBe(0);
    expect(progress.at(-1)).toBe(100);
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
    const network = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          hold = controller;
          controller.enqueue(new Uint8Array([1, 2]));
        },
        cancel: cancelled,
      }),
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
