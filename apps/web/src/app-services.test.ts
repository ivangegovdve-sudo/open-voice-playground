import { afterEach, describe, expect, it, vi } from 'vitest';

import launchRaw from '../../../packages/catalog/data/launch-catalog.public.json?raw';
import { createLaunchServices } from './app-services';
import { launchCatalogUrl } from './catalog/launch-catalog';

afterEach(() => vi.unstubAllGlobals());

describe('production launch services', () => {
  it('loads the external catalog explicitly and creates no worker or asset I/O', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(launchRaw, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const workerConstructor = vi.fn();
    const xmlHttpRequestConstructor = vi.fn();
    const importScripts = vi.fn();
    const cacheWrite = vi.fn();
    const cacheDelete = vi.fn();
    const storageAccess = vi.fn(() => ({
      estimate: vi.fn(),
      getDirectory: vi.fn(),
      persist: vi.fn(),
    }));
    const navigatorProxy = new Proxy(globalThis.navigator, {
      get(target, property, receiver) {
        return property === 'storage' ? storageAccess() : Reflect.get(target, property, receiver);
      },
    });
    vi.stubGlobal('Worker', workerConstructor);
    vi.stubGlobal('XMLHttpRequest', xmlHttpRequestConstructor);
    vi.stubGlobal('importScripts', importScripts);
    vi.stubGlobal('navigator', navigatorProxy);
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => []),
      open: vi.fn(async () => ({
        delete: cacheDelete,
        match: vi.fn(),
        put: cacheWrite,
      })),
    });

    const services = await createLaunchServices(fetcher);

    expect(services.catalog.kind).toBe('launch');
    expect(services.catalog.voices).toHaveLength(426);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(launchCatalogUrl, {
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(workerConstructor).not.toHaveBeenCalled();
    expect(xmlHttpRequestConstructor).not.toHaveBeenCalled();
    expect(importScripts).not.toHaveBeenCalled();
    expect(storageAccess).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    await expect(
      services.runtime.get('kokoro')!.checkCapability(
        services.catalog.voices.find(({ engineId }) => engineId === 'kokoro')!,
        'browser',
      ),
    ).resolves.toMatchObject({
      available: false,
      reason: 'runtime-verification-pending',
    });
    expect(workerConstructor).not.toHaveBeenCalled();
    expect(xmlHttpRequestConstructor).not.toHaveBeenCalled();
    expect(importScripts).not.toHaveBeenCalled();
    expect(storageAccess).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
  });
});
