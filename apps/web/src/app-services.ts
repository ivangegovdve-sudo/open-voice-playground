import { PreviewController, type AudioPort } from './audio/preview-controller';
import { seedCatalog, type SeedCatalog } from './catalog/catalog';
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
    now: () => new Date(),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}
