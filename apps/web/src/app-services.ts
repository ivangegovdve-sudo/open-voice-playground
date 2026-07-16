import { PreviewController, type AudioPort } from './audio/preview-controller';
import { seedCatalog, type SeedCatalog } from './catalog/catalog';
import { loadLaunchCatalog } from './catalog/launch-catalog';
import { AssetPreparationManager, createBrowserStorageManagerPort } from './runtime/assets';
import { createLaunchRuntimeRegistry } from './runtime/launch-runtime';
import { OpfsAssetStore } from './runtime/opfs';
import {
  StaticRuntimeRegistry,
  UnavailableRuntimeAdapter,
  type RuntimeRegistry,
} from './runtime/runtime';
import { createLocalDataStore, type LocalDataStore } from './state/local-store';

export type AppServices = {
  catalog: SeedCatalog;
  store: LocalDataStore;
  preview: PreviewController;
  runtime: RuntimeRegistry;
  runtimeSummary: {
    evidenceClearedVoiceCount: number;
    operationalVoiceCount: number;
    operationalEngineIds: string[];
    operationalVoiceIds: string[];
  };
  now(): Date;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
};

function unavailableReason(mode: 'browser' | 'online' | 'companion' | 'sample-only'): string {
  if (mode === 'browser') {
    return 'Browser runtime is not installed in this build.';
  }
  if (mode === 'online') {
    return 'Online service is unavailable. No request was sent.';
  }
  if (mode === 'companion') {
    return 'Companion is not connected.';
  }
  return 'This preset is available only as an official sample.';
}

function createUnavailableRuntimeRegistry(catalog: SeedCatalog): RuntimeRegistry {
  return new StaticRuntimeRegistry(
    catalog.engines.map((engine) => {
      const mode =
        engine.runtimeModes.find((candidate) => candidate !== 'sample-only') ?? 'sample-only';
      return new UnavailableRuntimeAdapter(engine.id, mode, unavailableReason);
    }),
  );
}

export function createDefaultServices(): AppServices {
  return {
    catalog: seedCatalog,
    store: createLocalDataStore(),
    preview: new PreviewController((url) => new Audio(url) as AudioPort),
    runtime: createUnavailableRuntimeRegistry(seedCatalog),
    runtimeSummary: {
      evidenceClearedVoiceCount: 0,
      operationalVoiceCount: 0,
      operationalEngineIds: [],
      operationalVoiceIds: [],
    },
    now: () => new Date(),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * Production boot path. Loading the external public catalog is the only I/O
 * performed here. OPFS and Worker boundaries remain lazy, and asset preparation
 * is deliberately blocked by a null consent receipt until a reviewed consent UI
 * can supply one in a later runtime-enablement task.
 */
export async function createLaunchServices(
  fetcher: typeof fetch = globalThis.fetch,
): Promise<AppServices> {
  const catalog = await loadLaunchCatalog(fetcher);
  const assets = new AssetPreparationManager({
    store: new OpfsAssetStore(),
    fetcher,
    storage: createBrowserStorageManagerPort(),
  });
  const runtime = createLaunchRuntimeRegistry({
    voices: catalog.voices,
    assetSets: catalog.assetSets,
    prepareAssets: async (assetSet, _voice, context) => {
      await assets.prepare(assetSet, null, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        onProgress: ({ assetId, percent }) =>
          context.onProgress?.({ phase: `Downloading ${assetId}`, percent }),
      });
    },
  });
  return {
    catalog,
    store: createLocalDataStore(),
    preview: new PreviewController((url) => new Audio(url) as AudioPort),
    runtime,
    runtimeSummary: {
      evidenceClearedVoiceCount: catalog.voices.filter(
        ({ releaseGate }) => releaseGate?.status === 'enabled',
      ).length,
      // createLaunchRuntimeRegistry keeps every real synthesis worker disabled
      // until its engine-specific browser or companion verification task passes.
      operationalVoiceCount: 0,
      operationalEngineIds: [],
      operationalVoiceIds: [],
    },
    now: () => new Date(),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}
