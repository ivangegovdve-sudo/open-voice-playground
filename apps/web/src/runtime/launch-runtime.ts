import type { AssetSetManifest } from '@open-voice/contracts';

import type { CatalogVoice } from '../catalog/filters';
import {
  createEdgeMetadataAdapter,
  createPocketCompanionAdapter,
  createWorkerRuntimeAdapter,
  type WorkerPort,
} from './providers';
import {
  StaticRuntimeRegistry,
  type RuntimeOperationContext,
  type RuntimeRegistry,
} from './runtime';

export type LaunchWorkerFactories = {
  kokoro: () => WorkerPort | Promise<WorkerPort>;
  kitten: () => WorkerPort | Promise<WorkerPort>;
  supertonic: () => WorkerPort | Promise<WorkerPort>;
  piper: () => WorkerPort | Promise<WorkerPort>;
};

export type LaunchRuntimeRegistryOptions = {
  voices: readonly CatalogVoice[];
  assetSets: readonly AssetSetManifest[];
  prepareAssets: (
    assetSet: AssetSetManifest,
    voice: CatalogVoice,
    context: RuntimeOperationContext,
  ) => Promise<void>;
  workerFactories?: LaunchWorkerFactories;
};

const defaultWorkerFactories: LaunchWorkerFactories = {
  kokoro: async () => (await import('./workers/factories/kokoro')).createWorker(),
  kitten: async () => (await import('./workers/factories/kitten')).createWorker(),
  supertonic: async () => (await import('./workers/factories/supertonic')).createWorker(),
  piper: async () => (await import('./workers/factories/piper')).createWorker(),
};

/**
 * Registers the launch seams without claiming real synthesis. The four browser
 * boundaries stay hard-disabled until their concrete model runtimes pass a real
 * browser verification gate; therefore registry creation and capability checks
 * cannot construct a Worker or touch the asset store.
 */
export function createLaunchRuntimeRegistry({
  voices,
  assetSets,
  prepareAssets,
  workerFactories = defaultWorkerFactories,
}: LaunchRuntimeRegistryOptions): RuntimeRegistry {
  const voicesFor = (engineId: string) => voices.filter((voice) => voice.engineId === engineId);
  const setsFor = (engineId: string) => assetSets.filter((set) => set.engineId === engineId);
  const browserAdapters = (['kokoro', 'kitten', 'supertonic', 'piper'] as const).map((engineId) =>
    createWorkerRuntimeAdapter({
      engineId,
      voices: voicesFor(engineId),
      assetSets: setsFor(engineId),
      prepareAssets,
      workerFactory: workerFactories[engineId],
      // Asset evidence and protocol boundaries are complete, but real engine
      // Workers are not. This may only change with engine-specific browser QA.
      browserRuntimeEnabled: false,
    }),
  );
  const pocketPack = setsFor('pocket')[0];
  if (pocketPack === undefined) {
    throw new Error('The Pocket companion pack manifest is required by the launch registry.');
  }

  return new StaticRuntimeRegistry([
    ...browserAdapters,
    createEdgeMetadataAdapter(voicesFor('edge')),
    createPocketCompanionAdapter(voicesFor('pocket'), pocketPack),
  ]);
}
