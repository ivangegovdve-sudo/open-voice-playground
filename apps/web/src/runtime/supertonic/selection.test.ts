import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type {
  AssetSetManifest,
  BrowserRuntimeArtifact,
  BrowserRuntimeBackend,
  BrowserRuntimeSelection,
} from '@open-voice/contracts';

import type {
  PreparedAssetBytes,
  PreparedRuntimeArtifactBytes,
  ResolvedStoredRuntimeArtifact,
} from '../assets';
import {
  SupertonicSelectionCoordinator,
  type SupertonicSelectionDescription,
  type SupertonicSelectionReceipt,
} from './selection';
import type { SupertonicRuntimeArtifactResolver } from './runtime-artifacts';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
);
const launchCatalog = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'packages', 'catalog', 'data', 'launch-catalog.public.json'),
    'utf8',
  ),
) as {
  assetSets: AssetSetManifest[];
  runtimeArtifacts: BrowserRuntimeArtifact[];
  runtimeSelections: BrowserRuntimeSelection[];
};
const assetSet = launchCatalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
const runtimeArtifacts = launchCatalog.runtimeArtifacts;
const runtimeSelections = launchCatalog.runtimeSelections;

const modelBuffers = assetSet.assets.map(({ bytes }) => new ArrayBuffer(bytes));
const runtimeBuffers: Record<BrowserRuntimeBackend, ArrayBuffer> = {
  wasm: new ArrayBuffer(runtimeArtifacts.find(({ backend }) => backend === 'wasm')!.bytes),
  webgpu: new ArrayBuffer(runtimeArtifacts.find(({ backend }) => backend === 'webgpu')!.bytes),
};

const expectedAcceptance = {
  acceptedLicenseIds: ['supertone-weights-license'],
  acceptedTermsHashes: ['sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f'],
} as const;

function receiptFor(backend: BrowserRuntimeBackend): SupertonicSelectionReceipt {
  const selection = runtimeSelections.find((candidate) => candidate.backend === backend)!;
  return {
    selectionId: selection.id,
    selectionDigest: selection.selectionDigest,
    acceptedLicenseIds: [...expectedAcceptance.acceptedLicenseIds],
    acceptedTermsHashes: [...expectedAcceptance.acceptedTermsHashes],
  };
}

function preparedModels(buffers = modelBuffers): PreparedAssetBytes[] {
  return assetSet.assets.map((asset, index) => ({
    assetId: asset.id,
    cacheKey: asset.cacheKey,
    sha256: asset.sha256,
    byteLength: asset.bytes,
    bytes: buffers[index]!,
  }));
}

type Phase =
  | 'model-prepare'
  | 'model-read'
  | 'resolver-import'
  | 'resolver'
  | 'runtime-prepare'
  | 'runtime-read';

function harness(
  backend: BrowserRuntimeBackend = 'wasm',
  options: {
    receipt?: SupertonicSelectionReceipt | null;
    abortAt?: Phase;
    controller?: AbortController;
    resolverFailure?: Error;
    getReceipt?: (description: SupertonicSelectionDescription) => SupertonicSelectionReceipt | null;
  } = {},
) {
  const events: string[] = [];
  const controller = options.controller ?? new AbortController();
  const abortAt = (phase: Phase) => {
    events.push(phase);
    if (options.abortAt === phase) controller.abort();
  };
  const assetManager = {
    prepare: vi.fn(async (_assetSet: AssetSetManifest) => {
      abortAt('model-prepare');
      return {} as never;
    }),
    readPreparedAssets: vi.fn(async (_assetSet: AssetSetManifest) => {
      abortAt('model-read');
      return preparedModels();
    }),
    prepareRuntimeArtifact: vi.fn(async (_artifact: ResolvedStoredRuntimeArtifact) => {
      abortAt('runtime-prepare');
    }),
    readPreparedRuntimeArtifact: vi.fn(
      async (artifact: ResolvedStoredRuntimeArtifact): Promise<PreparedRuntimeArtifactBytes> => {
        abortAt('runtime-read');
        const artifactBackend = runtimeArtifacts.find(({ id }) => id === artifact.id)!.backend;
        return {
          artifactId: artifact.id,
          cacheKey: artifact.cacheKey,
          sha256: artifact.sha256,
          byteLength: artifact.bytes,
          mediaType: artifact.mediaType,
          bytes: runtimeBuffers[artifactBackend],
        };
      },
    ),
  };
  const resolver = vi.fn<SupertonicRuntimeArtifactResolver>(async (_selection, artifact) => {
    abortAt('resolver');
    if (options.resolverFailure !== undefined) throw options.resolverFailure;
    return { ...artifact, url: `https://app.example/assets/${artifact.id}.wasm` };
  });
  const loadRuntimeResolver = vi.fn(async () => {
    abortAt('resolver-import');
    return resolver;
  });
  const getReceipt = vi.fn(
    options.getReceipt ??
      (() => (options.receipt === undefined ? receiptFor(backend) : options.receipt)),
  );
  const coordinator = new SupertonicSelectionCoordinator({
    assetSet,
    runtimeArtifacts,
    runtimeSelections,
    assetManager,
    getReceipt,
    loadRuntimeResolver,
    currentOrigin: () => 'https://app.example',
  });
  return {
    coordinator,
    controller,
    events,
    assetManager,
    getReceipt,
    loadRuntimeResolver,
    resolver,
  };
}

describe('Supertonic closed runtime selection', () => {
  it('constructs and describes both closures without storage, resolver, network, or Worker access', () => {
    const ports = harness();

    expect(ports.coordinator.describe('wasm')).toEqual({
      selectionId: 'supertonic-wasm',
      selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
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
      requiredLicenseIds: ['supertone-weights-license'],
      requiredTermsHashes: [...expectedAcceptance.acceptedTermsHashes],
    });
    expect(ports.coordinator.describe('webgpu')).toMatchObject({
      selectionId: 'supertonic-webgpu',
      runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm',
      selectedBytes: 428_104_287,
      safetyMarginBytes: 21_405_215,
      upperBoundBytes: 706_044_283,
    });
    expect(ports.getReceipt).not.toHaveBeenCalled();
    expect(ports.loadRuntimeResolver).not.toHaveBeenCalled();
    for (const method of Object.values(ports.assetManager)) expect(method).not.toHaveBeenCalled();
  });

  it('rejects absent, stale, mismatched, missing, extra, or malformed receipts before any I/O', async () => {
    const valid = receiptFor('wasm');
    const invalidReceipts: Array<SupertonicSelectionReceipt | null> = [
      null,
      { ...valid, selectionId: 'supertonic-webgpu' },
      { ...valid, selectionDigest: `sha256:${'0'.repeat(64)}` },
      { ...valid, acceptedLicenseIds: [] },
      {
        ...valid,
        acceptedLicenseIds: [...valid.acceptedLicenseIds, 'onnxruntime-web-runtime-license'],
      },
      { ...valid, acceptedTermsHashes: [] },
      { ...valid, acceptedTermsHashes: [...valid.acceptedTermsHashes, `sha256:${'0'.repeat(64)}`] },
      { ...valid, acceptedLicenseIds: ['supertone-weights-license', 'supertone-weights-license'] },
    ];

    for (const receipt of invalidReceipts) {
      const ports = harness('wasm', { receipt });
      await expect(
        ports.coordinator.buildPreparePayload({
          operationId: 1,
          voiceId: 'supertonic:F1',
          backend: 'wasm',
        }),
      ).rejects.toThrow();
      expect(ports.getReceipt).toHaveBeenCalledTimes(1);
      expect(ports.loadRuntimeResolver).not.toHaveBeenCalled();
      for (const method of Object.values(ports.assetManager)) expect(method).not.toHaveBeenCalled();
    }
  });

  it('validates a returned receipt against coordinator-owned identity after an untrusted getter runs', async () => {
    const ports = harness('wasm', {
      getReceipt: (description) => {
        const webgpu = receiptFor('webgpu');
        try {
          description.selectionId = webgpu.selectionId;
          description.selectionDigest = webgpu.selectionDigest;
        } catch {
          // A hardened coordinator freezes the callback copy and still validates the return value.
        }
        return webgpu;
      },
    });

    await expect(
      ports.coordinator.buildPreparePayload({
        operationId: 1,
        voiceId: 'supertonic:F1',
        backend: 'wasm',
      }),
    ).rejects.toThrow(/exact current/i);
    expect(ports.loadRuntimeResolver).not.toHaveBeenCalled();
    for (const method of Object.values(ports.assetManager)) expect(method).not.toHaveBeenCalled();
  });

  it('prepares one canonical backend in order and returns exactly 17 fresh buffer owners', async () => {
    const ports = harness('wasm');
    const payload = await ports.coordinator.buildPreparePayload({
      operationId: 7,
      voiceId: 'supertonic:M5',
      backend: 'wasm',
    });

    expect(ports.events).toEqual([
      'model-prepare',
      'model-read',
      'resolver-import',
      'resolver',
      'runtime-prepare',
      'runtime-read',
    ]);
    expect(payload.command).toMatchObject({
      command: 'prepare',
      operationId: 7,
      engineId: 'supertonic',
      voiceId: 'supertonic:M5',
      selectionId: 'supertonic-wasm',
      backend: 'wasm',
      assetSetId: 'supertonic-browser-assets',
      runtimeArtifactId: 'onnxruntime-web-wasm-runtime',
    });
    expect(payload.command.assets).toHaveLength(16);
    expect(payload.transferList).toEqual([...modelBuffers, runtimeBuffers.wasm]);
    expect(new Set(payload.transferList).size).toBe(17);
    expect(payload.transferList.reduce((sum, bytes) => sum + bytes.byteLength, 0)).toBe(
      414_756_722,
    );
    expect(payload.preparedKey).toBe(ports.coordinator.preparedKey('supertonic:M5', 'wasm'));
    expect(JSON.stringify(payload.command)).not.toMatch(
      /cacheKey|exactOrigin|url|path|handle|receipt|license|terms/i,
    );
    expect(ports.assetManager.prepare).toHaveBeenCalledWith(
      assetSet,
      {
        assetSetId: assetSet.id,
        manifestDigest: assetSet.manifestDigest,
        acceptedLicenseIds: [...expectedAcceptance.acceptedLicenseIds],
        acceptedTermsHashes: [...expectedAcceptance.acceptedTermsHashes],
      },
      expect.any(Object),
    );
    const preparedAssetSet = ports.assetManager.prepare.mock.calls[0]![0];
    expect(Object.isFrozen(preparedAssetSet)).toBe(true);
    expect(Object.isFrozen(preparedAssetSet.assets)).toBe(true);
    expect(Object.isFrozen(preparedAssetSet.assets[0])).toBe(true);
    expect(ports.resolver).toHaveBeenCalledWith(
      runtimeSelections.find(({ backend }) => backend === 'wasm'),
      runtimeArtifacts.find(({ backend }) => backend === 'wasm'),
    );
    expect(Object.isFrozen(ports.resolver.mock.calls[0]![0])).toBe(true);
    expect(Object.isFrozen(ports.resolver.mock.calls[0]![1])).toBe(true);
  });

  it('does not retry or fall back when the selected backend resolver fails', async () => {
    const failure = new Error('selected runtime unavailable');
    const ports = harness('webgpu', { resolverFailure: failure });

    await expect(
      ports.coordinator.buildPreparePayload({
        operationId: 1,
        voiceId: 'supertonic:F1',
        backend: 'webgpu',
      }),
    ).rejects.toBe(failure);
    expect(ports.loadRuntimeResolver).toHaveBeenCalledTimes(1);
    expect(ports.resolver).toHaveBeenCalledTimes(1);
    expect(ports.resolver.mock.calls[0]![0].backend).toBe('webgpu');
    expect(ports.assetManager.prepareRuntimeArtifact).not.toHaveBeenCalled();
  });

  it('rejects mutated catalog joins without importing a resolver or touching storage', () => {
    const base = harness();
    const mutations = [
      {
        assetSet: { ...assetSet, manifestDigest: `sha256:${'0'.repeat(64)}` },
        runtimeArtifacts,
        runtimeSelections,
      },
      {
        assetSet,
        runtimeArtifacts: runtimeArtifacts.map((artifact) =>
          artifact.backend === 'wasm' ? { ...artifact, bytes: artifact.bytes + 1 } : artifact,
        ),
        runtimeSelections,
      },
      {
        assetSet: {
          ...assetSet,
          assets: assetSet.assets.map((asset, index) =>
            index === 0
              ? {
                  ...asset,
                  url: 'https://untrusted.invalid/model.onnx',
                  approvedFinalOrigins: ['https://untrusted.invalid'],
                  cacheKey: 'untrusted/cache-key',
                }
              : asset,
          ),
        },
        runtimeArtifacts,
        runtimeSelections,
      },
      {
        assetSet,
        runtimeArtifacts: runtimeArtifacts.map((artifact) =>
          artifact.backend === 'wasm'
            ? ({
                ...artifact,
                packageVersion: '0.0.0',
                cacheKey: 'untrusted/runtime-cache-key',
                licenseIds: ['untrusted-license'],
              } as unknown as BrowserRuntimeArtifact)
            : artifact,
        ),
        runtimeSelections,
      },
      {
        assetSet,
        runtimeArtifacts,
        runtimeSelections: runtimeSelections.map((selection) =>
          selection.backend === 'wasm'
            ? { ...selection, runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm' }
            : selection,
        ),
      },
    ];

    for (const mutation of mutations) {
      expect(
        () =>
          new SupertonicSelectionCoordinator({
            ...mutation,
            assetManager: base.assetManager,
            getReceipt: base.getReceipt,
            loadRuntimeResolver: base.loadRuntimeResolver,
            currentOrigin: () => 'https://app.example',
          }),
      ).toThrow();
    }
    expect(base.loadRuntimeResolver).not.toHaveBeenCalled();
    for (const method of Object.values(base.assetManager)) expect(method).not.toHaveBeenCalled();
  });

  it.each<Phase>([
    'model-prepare',
    'model-read',
    'resolver-import',
    'resolver',
    'runtime-prepare',
    'runtime-read',
  ])('suppresses a late success after cancellation during %s', async (abortAt) => {
    const controller = new AbortController();
    const ports = harness('wasm', { abortAt, controller });

    await expect(
      ports.coordinator.buildPreparePayload({
        operationId: 1,
        voiceId: 'supertonic:F1',
        backend: 'wasm',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(ports.events.at(-1)).toBe(abortAt);
  });

  it('builds a backend-bound prepared key and exact synthesize-time language/speed command', () => {
    const { coordinator } = harness();

    expect(coordinator.preparedKey('supertonic:F1', 'wasm')).not.toBe(
      coordinator.preparedKey('supertonic:F1', 'webgpu'),
    );
    expect(
      coordinator.buildSynthesizeCommand({
        operationId: 9,
        voiceId: 'supertonic:F1',
        text: 'Exact controls.',
        language: 'bg',
        speed: 1.05,
      }),
    ).toEqual({
      command: 'synthesize',
      operationId: 9,
      engineId: 'supertonic',
      voiceId: 'supertonic:F1',
      text: 'Exact controls.',
      controls: { language: 'bg', speed: 1.05 },
    });
  });
});
