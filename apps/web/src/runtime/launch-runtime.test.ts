import { describe, expect, it, vi } from 'vitest';

import type { AssetSetManifest } from '@open-voice/contracts';

import type { CatalogVoice } from '../catalog/filters';
import { createLaunchRuntimeRegistry, type LaunchWorkerFactories } from './launch-runtime';
import type { WorkerPort } from './providers';

function voice(engineId: string, gate: CatalogVoice['releaseGate']): CatalogVoice {
  const mode = engineId === 'edge' ? 'online' : engineId === 'pocket' ? 'companion' : 'browser';
  return {
    id: `${engineId}:preset`,
    name: 'Preset',
    engineId,
    engineName: engineId,
    locale: 'en',
    languageTags: ['en'],
    languages: ['English'],
    language: 'English',
    region: 'Unspecified',
    gender: 'unspecified',
    styles: [],
    licenseIds: ['license'],
    sourceIds: ['source'],
    runtimeModes: [mode],
    sample: null,
    backend:
      engineId === 'pocket' ? 'companion' : engineId === 'edge' ? 'external-service' : 'wasm',
    ...(gate === undefined ? {} : { releaseGate: gate }),
    assetSetId: engineId === 'edge' || engineId === 'piper' ? null : `${engineId}-browser-assets`,
    declaredDownloadBytes: engineId === 'edge' || engineId === 'piper' ? 0 : 4,
    consentRequired: !['edge', 'piper'].includes(engineId),
  };
}

function assetSet(engineId: string): AssetSetManifest {
  return {
    id: `${engineId}-browser-assets`,
    engineId,
    manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
    assets: [
      {
        id: `${engineId}-asset`,
        url: `https://example.com/${engineId}/0123456789abcdef0123456789abcdef01234567/model.onnx`,
        approvedFinalOrigins: ['https://example.com'],
        revision: '0123456789abcdef0123456789abcdef01234567',
        sha256: 'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        bytes: 4,
        cacheKey: `${engineId}/model/0123456789ab`,
        mediaType: 'application/onnx',
        sourceIds: ['source'],
        licenseIds: ['license'],
        requiredAcceptance: null,
      },
    ],
    totalBytes: 4,
    requiredAcceptanceLicenseIds: [],
    releaseGate: { status: 'enabled', reason: null, detail: 'Reviewed assets.' },
  };
}

describe('honest launch runtime registry', () => {
  it('registers dedicated lazy boundaries without constructing Workers or preparing assets', async () => {
    const enabledGate = {
      status: 'enabled',
      reason: null,
      detail: 'Asset evidence reviewed.',
    } as const;
    const voices = ['kokoro', 'kitten', 'supertonic'].map((id) => voice(id, enabledGate));
    voices.push(
      voice('piper', {
        status: 'unavailable',
        reason: 'asset-unavailable',
        detail: 'No CORS-readable immutable asset.',
      }),
      voice('edge', {
        status: 'unavailable',
        reason: 'terms-not-cleared',
        detail: 'Metadata only.',
      }),
      voice('pocket', enabledGate),
    );
    const prepareAssets = vi.fn(async () => {});
    const workerFactories = Object.fromEntries(
      ['kokoro', 'kitten', 'supertonic', 'piper'].map((id) => [
        id,
        vi.fn(() => ({}) as WorkerPort),
      ]),
    ) as unknown as LaunchWorkerFactories;
    const registry = createLaunchRuntimeRegistry({
      voices,
      assetSets: [
        assetSet('kokoro'),
        assetSet('kitten'),
        assetSet('supertonic'),
        assetSet('pocket'),
      ],
      prepareAssets,
      workerFactories,
    });

    for (const engineId of ['kokoro', 'kitten', 'supertonic']) {
      const adapter = registry.get(engineId)!;
      await expect(adapter.listVoices()).resolves.toEqual([`${engineId}:preset`]);
      await expect(
        adapter.checkCapability(
          voices.find((item) => item.engineId === engineId)!,
          'browser',
        ),
      ).resolves.toMatchObject({ available: false, reason: 'runtime-verification-pending' });
    }
    await expect(
      registry.get('piper')!.checkCapability(
        voices.find(({ engineId }) => engineId === 'piper')!,
        'browser',
      ),
    ).resolves.toMatchObject({ available: false, reason: 'asset-unavailable' });
    await expect(
      registry.get('edge')!.checkCapability(
        voices.find(({ engineId }) => engineId === 'edge')!,
        'online',
      ),
    ).resolves.toMatchObject({ available: false, reason: 'terms-not-cleared' });
    await expect(
      registry.get('pocket')!.checkCapability(
        voices.find(({ engineId }) => engineId === 'pocket')!,
        'companion',
      ),
    ).resolves.toMatchObject({ available: false, reason: 'companion-not-connected' });
    expect(prepareAssets).not.toHaveBeenCalled();
    for (const factory of Object.values(workerFactories)) expect(factory).not.toHaveBeenCalled();
  });
});
