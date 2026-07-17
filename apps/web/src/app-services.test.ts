import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUPERTONIC_LANGUAGES, type BrowserRuntimeBackend } from '@open-voice/contracts';

import launchRaw from '../../../packages/catalog/data/launch-catalog.public.json?raw';
import { createLaunchServices } from './app-services';
import { launchCatalogUrl } from './catalog/launch-catalog';
import { createLocalDataStore, type PersistedSupertonicConsent } from './state/local-store';

const acceptance = {
  acceptedLicenseIds: ['supertone-weights-license'],
  acceptedTermsHashes: ['sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f'],
} as const;

const selections = {
  wasm: {
    id: 'supertonic-wasm',
    digest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
  },
  webgpu: {
    id: 'supertonic-webgpu',
    digest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
  },
} as const;

function fetchLaunchCatalog() {
  return vi.fn(
    async () =>
      new Response(launchRaw, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
  );
}

function receiptFor(backend: BrowserRuntimeBackend): PersistedSupertonicConsent {
  return {
    schemaVersion: 1,
    selectionId: selections[backend].id,
    selectionDigest: selections[backend].digest,
    acceptedLicenseIds: [...acceptance.acceptedLicenseIds],
    acceptedTermsHashes: [...acceptance.acceptedTermsHashes],
    acceptedAt: '2026-07-17T07:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe('production launch services', () => {
  it('loads the external catalog explicitly and creates no worker or asset I/O', async () => {
    const fetcher = fetchLaunchCatalog();
    const coordinatorLoader = vi.fn();
    const workerConstructor = vi.fn();
    const xmlHttpRequestConstructor = vi.fn();
    const importScripts = vi.fn();
    const cacheKeys = vi.fn(async () => []);
    const cacheMatch = vi.fn();
    const cacheWrite = vi.fn();
    const cacheDelete = vi.fn();
    const cacheOpen = vi.fn(async () => ({
      delete: cacheDelete,
      match: cacheMatch,
      put: cacheWrite,
    }));
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
      keys: cacheKeys,
      open: cacheOpen,
    });

    const services = await createLaunchServices(fetcher, {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: coordinatorLoader,
    });
    const workbench = services.supertonicWorkbench!;

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
    expect(cacheKeys).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(workbench.describe('wasm')).toEqual({
      selectionId: selections.wasm.id,
      selectionDigest: selections.wasm.digest,
      backend: 'wasm',
      assetSetId: 'supertonic-browser-assets',
      manifestDigest: 'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
      runtimeArtifactId: 'onnxruntime-web-wasm-runtime',
      modelBytes: 401_276_744,
      runtimeBytes: 13_479_978,
      selectedBytes: 414_756_722,
      largestAssetBytes: 256_534_781,
      safetyMarginBytes: 20_737_837,
      upperBoundBytes: 692_029_340,
      requiredLicenseIds: [...acceptance.acceptedLicenseIds],
      requiredTermsHashes: [...acceptance.acceptedTermsHashes],
    });
    expect(workbench.describe('webgpu')).toMatchObject({
      selectionId: selections.webgpu.id,
      selectionDigest: selections.webgpu.digest,
      backend: 'webgpu',
      runtimeBytes: 26_827_543,
      selectedBytes: 428_104_287,
      safetyMarginBytes: 21_405_215,
      upperBoundBytes: 706_044_283,
    });
    expect(workbench.controls.map(({ id }) => id)).toEqual(['backend', 'language', 'speed']);
    expect(workbench.controls).toEqual([
      {
        id: 'backend',
        label: 'Backend',
        type: 'select',
        defaultValue: 'wasm',
        options: [
          { label: 'WebGPU', value: 'webgpu' },
          { label: 'WASM', value: 'wasm' },
        ],
      },
      {
        id: 'language',
        label: 'Language',
        type: 'select',
        defaultValue: 'en',
        options: SUPERTONIC_LANGUAGES.map((language) => ({
          label: language.toUpperCase(),
          value: language,
        })),
      },
      {
        id: 'speed',
        label: 'Speed',
        type: 'range',
        min: 0.75,
        max: 1.25,
        step: 0.05,
        defaultValue: 1.05,
      },
    ]);
    expect(SUPERTONIC_LANGUAGES).toHaveLength(31);
    expect(workbench.preparedKey('supertonic:F1', 'wasm')).toBe(
      JSON.stringify([
        'supertonic:F1',
        selections.wasm.id,
        selections.wasm.digest,
        'wasm',
        'supertonic-browser-assets',
        'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
        'onnxruntime-web-wasm-runtime',
      ]),
    );
    expect(coordinatorLoader).not.toHaveBeenCalled();
    await expect(
      services.runtime.get('supertonic')!.checkCapability(
        services.catalog.voices.find(({ engineId }) => engineId === 'supertonic')!,
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
    expect(cacheKeys).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(coordinatorLoader).not.toHaveBeenCalled();
  });

  it('matches pure prepared keys against the real coordinator for both backends and ten presets', async () => {
    const services = await createLaunchServices(fetchLaunchCatalog(), { hasWebGpu: () => false });
    const workbench = services.supertonicWorkbench!;
    const { SupertonicSelectionCoordinator } = await import('./runtime/supertonic/selection');
    const real = new SupertonicSelectionCoordinator({
      assetSet: services.catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!,
      runtimeArtifacts: services.catalog.runtimeArtifacts,
      runtimeSelections: services.catalog.runtimeSelections,
      assetManager: {
        prepare: vi.fn(),
        prepareRuntimeArtifact: vi.fn(),
        readPreparedAssets: vi.fn(),
        readPreparedRuntimeArtifact: vi.fn(),
      },
      getReceipt: () => null,
    });
    const voiceIds = services.catalog.voices
      .filter(({ engineId }) => engineId === 'supertonic')
      .map(({ id }) => id);

    expect(voiceIds).toHaveLength(10);
    for (const backend of ['wasm', 'webgpu'] as const) {
      expect(workbench.describe(backend)).toEqual(real.describe(backend));
      for (const voiceId of voiceIds) {
        expect(workbench.preparedKey(voiceId, backend)).toBe(real.preparedKey(voiceId, backend));
      }
    }
  });

  it('persists only exact acceptance metadata without loading inference boundaries', async () => {
    const store = createLocalDataStore({ indexedDB: null });
    const loader = vi.fn();
    const workerConstructor = vi.fn();
    const xmlHttpRequestConstructor = vi.fn();
    const cacheKeys = vi.fn(async () => []);
    const cacheMatch = vi.fn();
    const cacheWrite = vi.fn();
    const cacheDelete = vi.fn();
    const cacheOpen = vi.fn(async () => ({
      delete: cacheDelete,
      match: cacheMatch,
      put: cacheWrite,
    }));
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
    vi.stubGlobal('navigator', navigatorProxy);
    vi.stubGlobal('caches', {
      keys: cacheKeys,
      open: cacheOpen,
    });
    const fetcher = fetchLaunchCatalog();
    const services = await createLaunchServices(fetcher, {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: loader,
      now: () => new Date('2026-07-17T07:00:00.000Z'),
      store,
    });
    const workbench = services.supertonicWorkbench!;
    await workbench.hydrate();
    const before = workbench.getSnapshot();
    expect(workbench.getSnapshot()).toBe(before);

    await workbench.accept('wasm');

    expect(workbench.isAccepted('wasm')).toBe(true);
    expect(workbench.isAccepted('webgpu')).toBe(false);
    expect(workbench.getSnapshot()).not.toBe(before);
    expect(workbench.getSnapshot()).toBe(workbench.getSnapshot());
    await expect(store.getSupertonicConsent()).resolves.toEqual(receiptFor('wasm'));
    expect(loader).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(workerConstructor).not.toHaveBeenCalled();
    expect(xmlHttpRequestConstructor).not.toHaveBeenCalled();
    expect(storageAccess).not.toHaveBeenCalled();
    expect(cacheKeys).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('rejects missing and stale receipts before loading, and synchronously clears stale memory', async () => {
    const missingLoader = vi.fn();
    const missing = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: missingLoader,
      store: createLocalDataStore({ indexedDB: null }),
    });
    await missing.supertonicWorkbench!.hydrate();
    await expect(
      missing.supertonicWorkbench!.buildPreparePayload({
        operationId: 1,
        voiceId: 'supertonic:F1',
        backend: 'wasm',
      }),
    ).rejects.toThrow(/exact current/i);
    expect(missingLoader).not.toHaveBeenCalled();

    const staleStore = createLocalDataStore({ indexedDB: null });
    await staleStore.setSupertonicConsent({
      ...receiptFor('wasm'),
      selectionDigest: `sha256:${'0'.repeat(64)}`,
    });
    const staleLoader = vi.fn();
    const stale = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: staleLoader,
      store: staleStore,
    });
    await stale.supertonicWorkbench!.hydrate();

    expect(stale.supertonicWorkbench!.getSnapshot().receipt).toBeNull();
    await expect(staleStore.getSupertonicConsent()).resolves.toBeNull();
    await expect(
      stale.supertonicWorkbench!.buildPreparePayload({
        operationId: 2,
        voiceId: 'supertonic:F1',
        backend: 'wasm',
      }),
    ).rejects.toThrow(/exact current/i);
    expect(staleLoader).not.toHaveBeenCalled();
  });

  it('loads and caches the coordinator only for accepted preparation, never synthesis alone', async () => {
    const buildPreparePayload = vi.fn(async () => ({ prepared: true }) as never);
    const buildSynthesizeCommand = vi.fn(() => ({ synthesized: true }) as never);
    const coordinator = {
      buildPreparePayload,
      buildSynthesizeCommand,
      preparedKey: vi.fn(() => 'coordinator-key'),
    };
    const factory = vi.fn((_input: unknown) => coordinator);
    const loader = vi.fn(async () => factory);
    const services = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: loader,
      store: createLocalDataStore({ indexedDB: null }),
    });
    const workbench = services.supertonicWorkbench!;
    await workbench.hydrate();
    expect(() =>
      workbench.buildSynthesizeCommand({
        operationId: 2,
        voiceId: 'supertonic:F1',
        text: 'Still lazy.',
        language: 'en',
        speed: 1.05,
      }),
    ).toThrow(/prepare/i);
    expect(loader).not.toHaveBeenCalled();
    await workbench.accept('wasm');

    await workbench.buildPreparePayload({
      operationId: 3,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
    });
    await workbench.buildPreparePayload({
      operationId: 4,
      voiceId: 'supertonic:F2',
      backend: 'wasm',
    });
    workbench.buildSynthesizeCommand({
      operationId: 5,
      voiceId: 'supertonic:F2',
      text: 'Loaded only after preparation.',
      language: 'bg',
      speed: 1.05,
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
    const factoryInput = factory.mock.calls[0]![0] as unknown as {
      assetSet: { id: string; manifestDigest: string };
      runtimeArtifacts: Array<{ id: string; backend: string }>;
      runtimeSelections: Array<{ id: string; backend: string }>;
      assetManager: {
        prepare: unknown;
        prepareRuntimeArtifact: unknown;
        readPreparedAssets: unknown;
        readPreparedRuntimeArtifact: unknown;
      };
      getReceipt(
        description: ReturnType<typeof workbench.describe>,
      ): Omit<PersistedSupertonicConsent, 'acceptedAt' | 'schemaVersion'> | null;
    };
    expect(factoryInput.assetSet).toMatchObject({
      id: 'supertonic-browser-assets',
      manifestDigest: 'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
    });
    expect(
      factoryInput.runtimeArtifacts
        .map(({ id, backend }) => ({ id, backend }))
        .sort((left, right) => left.backend.localeCompare(right.backend)),
    ).toEqual([
      { id: 'onnxruntime-web-wasm-runtime', backend: 'wasm' },
      { id: 'onnxruntime-web-webgpu-jsep-wasm', backend: 'webgpu' },
    ]);
    expect(
      factoryInput.runtimeSelections
        .map(({ id, backend }) => ({ id, backend }))
        .sort((left, right) => left.backend.localeCompare(right.backend)),
    ).toEqual([
      { id: 'supertonic-wasm', backend: 'wasm' },
      { id: 'supertonic-webgpu', backend: 'webgpu' },
    ]);
    expect(factoryInput.assetManager).toMatchObject({
      prepare: expect.any(Function),
      prepareRuntimeArtifact: expect.any(Function),
      readPreparedAssets: expect.any(Function),
      readPreparedRuntimeArtifact: expect.any(Function),
    });
    expect(factoryInput.getReceipt(workbench.describe('wasm'))).toEqual({
      selectionId: selections.wasm.id,
      selectionDigest: selections.wasm.digest,
      acceptedLicenseIds: [...acceptance.acceptedLicenseIds],
      acceptedTermsHashes: [...acceptance.acceptedTermsHashes],
    });
    expect(buildPreparePayload).toHaveBeenCalledTimes(2);
    expect(buildPreparePayload).toHaveBeenNthCalledWith(1, {
      operationId: 3,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
    });
    expect(buildPreparePayload).toHaveBeenNthCalledWith(2, {
      operationId: 4,
      voiceId: 'supertonic:F2',
      backend: 'wasm',
    });
    expect(buildSynthesizeCommand).toHaveBeenCalledOnce();
    expect(buildSynthesizeCommand).toHaveBeenCalledWith({
      operationId: 5,
      voiceId: 'supertonic:F2',
      text: 'Loaded only after preparation.',
      language: 'bg',
      speed: 1.05,
    });
    await workbench.revoke();
    expect(factoryInput.getReceipt(workbench.describe('wasm'))).toBeNull();
  });

  it('rechecks abort after a delayed import without caching a coordinator', async () => {
    const delayedFactory = deferred<(input: unknown) => never>();
    const acceptedFactory = vi.fn(() => ({
      buildPreparePayload: vi.fn(async () => ({ prepared: true }) as never),
      buildSynthesizeCommand: vi.fn(() => ({ synthesized: true }) as never),
      preparedKey: vi.fn(() => 'prepared'),
    }));
    const loader = vi
      .fn()
      .mockImplementationOnce(() => delayedFactory.promise)
      .mockResolvedValue(acceptedFactory);
    const services = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: loader,
      store: createLocalDataStore({ indexedDB: null }),
    });
    const workbench = services.supertonicWorkbench!;
    await workbench.hydrate();
    await workbench.accept('wasm');
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      workbench.buildPreparePayload({
        operationId: 0,
        voiceId: 'supertonic:F1',
        backend: 'wasm',
        signal: alreadyAborted.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader).not.toHaveBeenCalled();
    const controller = new AbortController();
    const aborted = workbench.buildPreparePayload({
      operationId: 1,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    controller.abort();
    delayedFactory.resolve(acceptedFactory as never);

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(acceptedFactory).not.toHaveBeenCalled();
    await workbench.buildPreparePayload({
      operationId: 2,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(acceptedFactory).toHaveBeenCalledOnce();
  });

  it('rechecks receipt after a delayed import without instantiating or caching stale state', async () => {
    const delayedFactory = deferred<(input: unknown) => never>();
    const acceptedFactory = vi.fn(() => ({
      buildPreparePayload: vi.fn(async () => ({ prepared: true }) as never),
      buildSynthesizeCommand: vi.fn(() => ({ synthesized: true }) as never),
      preparedKey: vi.fn(() => 'prepared'),
    }));
    const loader = vi
      .fn()
      .mockImplementationOnce(() => delayedFactory.promise)
      .mockResolvedValue(acceptedFactory);
    const services = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      loadSupertonicCoordinator: loader,
      store: createLocalDataStore({ indexedDB: null }),
    });
    const workbench = services.supertonicWorkbench!;
    await workbench.hydrate();
    await workbench.accept('wasm');
    const stale = workbench.buildPreparePayload({
      operationId: 1,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
    });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    await workbench.revoke();
    delayedFactory.resolve(acceptedFactory as never);

    await expect(stale).rejects.toThrow(/exact current/i);
    expect(acceptedFactory).not.toHaveBeenCalled();
    await workbench.accept('wasm');
    await workbench.buildPreparePayload({
      operationId: 2,
      voiceId: 'supertonic:F1',
      backend: 'wasm',
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(acceptedFactory).toHaveBeenCalledOnce();
  });

  it('keeps the latest user acceptance decision when delayed hydration resolves', async () => {
    const persisted = deferred<PersistedSupertonicConsent | null>();
    const baseStore = createLocalDataStore({ indexedDB: null });
    const store = {
      ...baseStore,
      getSupertonicConsent: vi.fn(() => persisted.promise),
      setSupertonicConsent: vi.fn((value: PersistedSupertonicConsent | null) =>
        baseStore.setSupertonicConsent(value),
      ),
    };
    const services = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      now: () => new Date('2026-07-17T07:00:00.000Z'),
      store,
    });
    const workbench = services.supertonicWorkbench!;
    const hydration = workbench.hydrate();
    const acceptanceWrite = workbench.accept('wasm');
    persisted.resolve(receiptFor('webgpu'));
    await Promise.all([hydration, acceptanceWrite]);

    expect(workbench.isAccepted('wasm')).toBe(true);
    expect(workbench.getSnapshot().receipt).toEqual(receiptFor('wasm'));
    await expect(baseStore.getSupertonicConsent()).resolves.toEqual(receiptFor('wasm'));

    const persistedAfterRevoke = deferred<PersistedSupertonicConsent | null>();
    const secondStore = {
      ...baseStore,
      getSupertonicConsent: vi.fn(() => persistedAfterRevoke.promise),
    };
    const second = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      now: () => new Date('2026-07-17T07:00:00.000Z'),
      store: secondStore,
    });
    const secondHydration = second.supertonicWorkbench!.hydrate();
    const revocation = second.supertonicWorkbench!.revoke();
    persistedAfterRevoke.resolve(receiptFor('wasm'));
    await Promise.all([secondHydration, revocation]);
    expect(second.supertonicWorkbench!.getSnapshot().receipt).toBeNull();
    await expect(baseStore.getSupertonicConsent()).resolves.toBeNull();
  });

  it('clears accepted selection memory before backend deletion and never resurrects it', async () => {
    const store = createLocalDataStore({ indexedDB: null });
    const services = await createLaunchServices(fetchLaunchCatalog(), {
      hasWebGpu: () => false,
      store,
    });
    const workbench = services.supertonicWorkbench!;
    await workbench.hydrate();
    await workbench.accept('wasm');
    const deletion = deferred<void>();
    vi.spyOn(store, 'setSupertonicConsent').mockImplementationOnce(() => deletion.promise);

    const switching = workbench.selectBackend('webgpu');

    expect(workbench.getSnapshot().backend).toBe('webgpu');
    expect(workbench.getSnapshot().receipt).toBeNull();
    expect(workbench.isAccepted('webgpu')).toBe(false);
    const switchingBack = workbench.selectBackend('wasm');
    expect(workbench.isAccepted('wasm')).toBe(false);
    deletion.resolve();
    await Promise.all([switching, switchingBack]);
  });
});
