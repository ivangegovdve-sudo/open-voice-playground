import {
  SUPERTONIC_LANGUAGES,
  type AssetSetManifest,
  type BrowserRuntimeBackend,
  type SupertonicLanguage,
} from '@open-voice/contracts';

import type { CatalogVoice } from '../catalog/filters';
import {
  createEdgeMetadataAdapter,
  createPocketCompanionAdapter,
  createWorkerRuntimeAdapter,
  type WorkerRuntimeAdapterOptions,
  type WorkerPort,
} from './providers';
import {
  StaticRuntimeRegistry,
  type RuntimeOperationContext,
  type RuntimeRegistry,
} from './runtime';
import type { SupertonicSelectionCoordinator } from './supertonic/selection';

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
  supertonicSelectionCoordinator?: Pick<
    SupertonicSelectionCoordinator,
    'buildPreparePayload' | 'preparedKey' | 'buildSynthesizeCommand'
  >;
  hasWebGpu?: () => boolean;
};

type SupertonicWorkerRuntimeOptionsInput = Pick<
  WorkerRuntimeAdapterOptions,
  'voices' | 'assetSets' | 'prepareAssets' | 'workerFactory'
> & {
  coordinator?: LaunchRuntimeRegistryOptions['supertonicSelectionCoordinator'];
  hasWebGpu?: () => boolean;
};

function selectedBackend(value: unknown): BrowserRuntimeBackend {
  if (value !== 'wasm' && value !== 'webgpu') {
    throw new Error('Select exactly one supported Supertonic backend.');
  }
  return value;
}

function selectedLanguage(value: unknown): SupertonicLanguage {
  if (typeof value !== 'string' || !(SUPERTONIC_LANGUAGES as readonly string[]).includes(value)) {
    throw new Error('Select one supported Supertonic language.');
  }
  return value as SupertonicLanguage;
}

export function createSupertonicWorkerRuntimeOptions({
  voices,
  assetSets,
  prepareAssets,
  workerFactory,
  coordinator,
  hasWebGpu = () => typeof navigator !== 'undefined' && 'gpu' in navigator,
}: SupertonicWorkerRuntimeOptionsInput): WorkerRuntimeAdapterOptions {
  const requireCoordinator = () => {
    if (coordinator === undefined) {
      throw new Error('A current accepted Supertonic selection receipt is required.');
    }
    return coordinator;
  };
  return {
    engineId: 'supertonic',
    voices,
    assetSets,
    prepareAssets,
    workerFactory,
    // Task 3 carries the closed seam but cannot make a production truth claim.
    browserRuntimeEnabled: false,
    cancellationPolicy: 'immediate',
    disposePolicy: 'acknowledged',
    disposeTimeoutMs: 500,
    replacementPolicy: 'fresh-generation',
    capabilityControls: () => [
      {
        id: 'backend',
        label: 'Backend',
        type: 'select',
        defaultValue: hasWebGpu() ? 'webgpu' : 'wasm',
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
    ],
    preparePayloadBuilder: async ({ operationId, voice, request, context }) => {
      const signal = context.signal;
      const onProgress = context.onProgress;
      return await requireCoordinator().buildPreparePayload({
        operationId,
        voiceId: voice.id,
        backend: selectedBackend(request.controls.backend),
        ...(signal === undefined ? {} : { signal }),
        ...(onProgress === undefined ? {} : { onProgress }),
      });
    },
    preparedKeyBuilder: ({ voice, request }) =>
      requireCoordinator().preparedKey(voice.id, selectedBackend(request.controls.backend)),
    synthesizeCommandBuilder: ({ operationId, voice, request }) => {
      const speed = request.controls.speed;
      if (typeof speed !== 'number') throw new Error('Select a numeric Supertonic speed.');
      return requireCoordinator().buildSynthesizeCommand({
        operationId,
        voiceId: voice.id,
        text: request.text,
        language: selectedLanguage(request.controls.language),
        speed,
      });
    },
  };
}

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
  supertonicSelectionCoordinator,
  hasWebGpu,
}: LaunchRuntimeRegistryOptions): RuntimeRegistry {
  const voicesFor = (engineId: string) => voices.filter((voice) => voice.engineId === engineId);
  const setsFor = (engineId: string) => assetSets.filter((set) => set.engineId === engineId);
  const genericAdapter = (engineId: 'kokoro' | 'kitten' | 'piper') =>
    createWorkerRuntimeAdapter({
      engineId,
      voices: voicesFor(engineId),
      assetSets: setsFor(engineId),
      prepareAssets,
      workerFactory: workerFactories[engineId],
      // Asset evidence and protocol boundaries are complete, but real engine
      // Workers are not. This may only change with engine-specific browser QA.
      browserRuntimeEnabled: false,
    });
  const browserAdapters = [
    genericAdapter('kokoro'),
    genericAdapter('kitten'),
    createWorkerRuntimeAdapter(
      createSupertonicWorkerRuntimeOptions({
        voices: voicesFor('supertonic'),
        assetSets: setsFor('supertonic'),
        prepareAssets,
        workerFactory: workerFactories.supertonic,
        ...(supertonicSelectionCoordinator === undefined
          ? {}
          : { coordinator: supertonicSelectionCoordinator }),
        ...(hasWebGpu === undefined ? {} : { hasWebGpu }),
      }),
    ),
    genericAdapter('piper'),
  ];
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
