import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_LANGUAGES,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
  SUPERTONIC_VOICE_IDS,
  type BrowserRuntimeBackend,
} from '@open-voice/contracts';

import { PreviewController, type AudioPort } from './audio/preview-controller';
import { seedCatalog, type SeedCatalog } from './catalog/catalog';
import { loadLaunchCatalog } from './catalog/launch-catalog';
import { AssetPreparationManager, createBrowserStorageManagerPort } from './runtime/assets';
import {
  createLaunchRuntimeRegistry,
  type LaunchRuntimeRegistryOptions,
} from './runtime/launch-runtime';
import { OpfsAssetStore } from './runtime/opfs';
import {
  StaticRuntimeRegistry,
  UnavailableRuntimeAdapter,
  type EngineControl,
  type RuntimeRegistry,
} from './runtime/runtime';
import {
  createLocalDataStore,
  type LocalDataStore,
  type PersistedSupertonicConsent,
} from './state/local-store';

type SupertonicCoordinatorFacade = NonNullable<
  LaunchRuntimeRegistryOptions['supertonicSelectionCoordinator']
>;

export type SupertonicSelectionDescription = {
  selectionId: string;
  selectionDigest: string;
  backend: BrowserRuntimeBackend;
  assetSetId: typeof SUPERTONIC_ASSET_SET_ID;
  manifestDigest: typeof SUPERTONIC_MANIFEST_DIGEST;
  runtimeArtifactId: string;
  modelBytes: number;
  runtimeBytes: number;
  selectedBytes: number;
  largestAssetBytes: number;
  safetyMarginBytes: number;
  upperBoundBytes: number;
  requiredLicenseIds: string[];
  requiredTermsHashes: string[];
};

export type SupertonicWorkbenchSnapshot = Readonly<{
  hydrated: boolean;
  backend: BrowserRuntimeBackend;
  receipt: PersistedSupertonicConsent | null;
}>;

type SupertonicCoordinatorFactoryInput = {
  assetSet: SeedCatalog['assetSets'][number];
  runtimeArtifacts: SeedCatalog['runtimeArtifacts'];
  runtimeSelections: SeedCatalog['runtimeSelections'];
  assetManager: AssetPreparationManager;
  getReceipt: (description: SupertonicSelectionDescription) => {
    selectionId: string;
    selectionDigest: string;
    acceptedLicenseIds: string[];
    acceptedTermsHashes: string[];
  } | null;
};

type SupertonicCoordinatorFactory = (
  input: SupertonicCoordinatorFactoryInput,
) => SupertonicCoordinatorFacade;

export type SupertonicWorkbench = SupertonicCoordinatorFacade & {
  controls: EngineControl[];
  describe(backend: BrowserRuntimeBackend): SupertonicSelectionDescription;
  hydrate(): Promise<void>;
  accept(backend: BrowserRuntimeBackend): Promise<void>;
  revoke(): Promise<void>;
  selectBackend(backend: BrowserRuntimeBackend): Promise<void>;
  getSnapshot(): SupertonicWorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  isAccepted(backend: BrowserRuntimeBackend): boolean;
};

export type LaunchServicesOptions = {
  hasWebGpu?: () => boolean;
  loadSupertonicCoordinator?: () => Promise<SupertonicCoordinatorFactory>;
  now?: () => Date;
  store?: LocalDataStore;
};

export type AppServices = {
  catalog: SeedCatalog;
  store: LocalDataStore;
  preview: PreviewController;
  runtime: RuntimeRegistry;
  supertonicWorkbench?: SupertonicWorkbench;
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

const REQUIRED_SUPERTONIC_LICENSE_IDS = ['supertone-weights-license'] as const;
const REQUIRED_SUPERTONIC_TERMS_HASHES = [
  'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
] as const;

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function frozenReceipt(
  receipt: PersistedSupertonicConsent | null,
): PersistedSupertonicConsent | null {
  if (receipt === null) return null;
  const clone = structuredClone(receipt);
  Object.freeze(clone.acceptedLicenseIds);
  Object.freeze(clone.acceptedTermsHashes);
  return Object.freeze(clone);
}

function safeByteTotal(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Supertonic selection bytes exceed safe browser limits.');
  }
  return total;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The Supertonic selection was cancelled.', 'AbortError');
}

function createSupertonicWorkbench({
  catalog,
  assetManager,
  store,
  hasWebGpu,
  loadCoordinator,
  now,
}: {
  catalog: SeedCatalog;
  assetManager: AssetPreparationManager;
  store: LocalDataStore;
  hasWebGpu: () => boolean;
  loadCoordinator: () => Promise<SupertonicCoordinatorFactory>;
  now: () => Date;
}): SupertonicWorkbench {
  const assetSet = catalog.assetSets.find(({ id }) => id === SUPERTONIC_ASSET_SET_ID);
  if (assetSet === undefined || assetSet.manifestDigest !== SUPERTONIC_MANIFEST_DIGEST) {
    throw new Error('The canonical Supertonic asset set is required.');
  }
  const recordsFor = (backend: BrowserRuntimeBackend) => {
    const identity = SUPERTONIC_RUNTIME_IDENTITIES[backend];
    const selection = catalog.runtimeSelections.find(
      (candidate) => candidate.id === identity.selectionId && candidate.backend === backend,
    );
    const artifact = catalog.runtimeArtifacts.find(
      (candidate) => candidate.id === identity.artifactId && candidate.backend === backend,
    );
    if (selection === undefined || artifact === undefined) {
      throw new Error(`The canonical Supertonic ${backend} selection is required.`);
    }
    return { artifact, selection };
  };
  const descriptions = Object.freeze(
    Object.fromEntries(
      (['wasm', 'webgpu'] as const).map((backend) => {
        const { artifact, selection } = recordsFor(backend);
        const selectedBytes = safeByteTotal(assetSet.totalBytes, artifact.bytes);
        const largestAssetBytes = Math.max(
          artifact.bytes,
          ...assetSet.assets.map(({ bytes }) => bytes),
        );
        const safetyMarginBytes = Math.ceil(selectedBytes * 0.05);
        const description: SupertonicSelectionDescription = {
          selectionId: selection.id,
          selectionDigest: selection.selectionDigest,
          backend,
          assetSetId: SUPERTONIC_ASSET_SET_ID,
          manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
          runtimeArtifactId: artifact.id,
          modelBytes: assetSet.totalBytes,
          runtimeBytes: artifact.bytes,
          selectedBytes,
          largestAssetBytes,
          safetyMarginBytes,
          upperBoundBytes: safeByteTotal(selectedBytes, largestAssetBytes, safetyMarginBytes),
          requiredLicenseIds: [...REQUIRED_SUPERTONIC_LICENSE_IDS],
          requiredTermsHashes: [...REQUIRED_SUPERTONIC_TERMS_HASHES],
        };
        Object.freeze(description.requiredLicenseIds);
        Object.freeze(description.requiredTermsHashes);
        return [backend, Object.freeze(description)];
      }),
    ) as Record<BrowserRuntimeBackend, SupertonicSelectionDescription>,
  );
  const initialBackend: BrowserRuntimeBackend = hasWebGpu() ? 'webgpu' : 'wasm';
  const controls: EngineControl[] = [
    {
      id: 'backend',
      label: 'Backend',
      type: 'select',
      defaultValue: initialBackend,
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
  ];
  let snapshot: SupertonicWorkbenchSnapshot = Object.freeze({
    hydrated: false,
    backend: initialBackend,
    receipt: null,
  });
  let mutationEpoch = 0;
  let hydration: Promise<void> | null = null;
  let coordinator: SupertonicCoordinatorFacade | null = null;
  const listeners = new Set<() => void>();

  const publish = (
    backend: BrowserRuntimeBackend,
    receipt: PersistedSupertonicConsent | null,
    hydrated = true,
  ) => {
    snapshot = Object.freeze({ hydrated, backend, receipt: frozenReceipt(receipt) });
    for (const listener of listeners) listener();
  };
  const receiptMatches = (
    receipt: PersistedSupertonicConsent | null,
    backend: BrowserRuntimeBackend,
  ) => {
    const description = descriptions[backend];
    return (
      receipt !== null &&
      receipt.selectionId === description.selectionId &&
      receipt.selectionDigest === description.selectionDigest &&
      sameStrings(receipt.acceptedLicenseIds, description.requiredLicenseIds) &&
      sameStrings(receipt.acceptedTermsHashes, description.requiredTermsHashes)
    );
  };
  const isAccepted = (backend: BrowserRuntimeBackend) =>
    snapshot.backend === backend && receiptMatches(snapshot.receipt, backend);
  const requireAcceptance = (backend: BrowserRuntimeBackend) => {
    if (!isAccepted(backend)) {
      throw new Error(
        'An exact current Supertonic selection receipt is required before asset access.',
      );
    }
  };
  const describe = (backend: BrowserRuntimeBackend) => descriptions[backend];
  const preparedKey = (voiceId: string, backend: BrowserRuntimeBackend) => {
    if (!(SUPERTONIC_VOICE_IDS as readonly string[]).includes(voiceId)) {
      throw new Error('Supertonic voice ID is outside the frozen preset set.');
    }
    const description = descriptions[backend];
    return JSON.stringify([
      voiceId,
      description.selectionId,
      description.selectionDigest,
      backend,
      description.assetSetId,
      description.manifestDigest,
      description.runtimeArtifactId,
    ]);
  };
  const getReceipt = (description: SupertonicSelectionDescription) => {
    if (
      !isAccepted(description.backend) ||
      snapshot.receipt?.selectionId !== description.selectionId ||
      snapshot.receipt.selectionDigest !== description.selectionDigest
    ) {
      return null;
    }
    return {
      selectionId: snapshot.receipt.selectionId,
      selectionDigest: snapshot.receipt.selectionDigest,
      acceptedLicenseIds: [...snapshot.receipt.acceptedLicenseIds],
      acceptedTermsHashes: [...snapshot.receipt.acceptedTermsHashes],
    };
  };

  const workbench: SupertonicWorkbench = {
    controls,
    describe,
    preparedKey,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAccepted,
    hydrate() {
      if (hydration !== null) return hydration;
      const startedAt = mutationEpoch;
      hydration = (async () => {
        const persisted = await store.getSupertonicConsent();
        if (mutationEpoch !== startedAt) return;
        coordinator = null;
        if (receiptMatches(persisted, snapshot.backend)) {
          publish(snapshot.backend, persisted);
          return;
        }
        publish(snapshot.backend, null);
        if (persisted !== null) await store.setSupertonicConsent(null);
      })();
      return hydration;
    },
    async accept(backend) {
      if (backend !== snapshot.backend) {
        throw new Error('Only the currently selected Supertonic backend can be accepted.');
      }
      mutationEpoch += 1;
      coordinator = null;
      const description = descriptions[backend];
      const receipt: PersistedSupertonicConsent = {
        schemaVersion: 1,
        selectionId: description.selectionId,
        selectionDigest: description.selectionDigest,
        acceptedLicenseIds: [...description.requiredLicenseIds],
        acceptedTermsHashes: [...description.requiredTermsHashes],
        acceptedAt: now().toISOString(),
      };
      publish(backend, receipt);
      await store.setSupertonicConsent(receipt);
    },
    async revoke() {
      mutationEpoch += 1;
      coordinator = null;
      publish(snapshot.backend, null);
      await store.setSupertonicConsent(null);
    },
    async selectBackend(backend) {
      if (backend === snapshot.backend) return;
      mutationEpoch += 1;
      coordinator = null;
      publish(backend, null);
      await store.setSupertonicConsent(null);
    },
    async buildPreparePayload(input) {
      requireAcceptance(input.backend);
      throwIfAborted(input.signal);
      if (coordinator === null) {
        const startedAt = mutationEpoch;
        const factory = await loadCoordinator();
        throwIfAborted(input.signal);
        if (mutationEpoch !== startedAt) requireAcceptance(input.backend);
        requireAcceptance(input.backend);
        const candidate = factory({
          assetSet,
          runtimeArtifacts: catalog.runtimeArtifacts,
          runtimeSelections: catalog.runtimeSelections,
          assetManager,
          getReceipt,
        });
        throwIfAborted(input.signal);
        if (mutationEpoch !== startedAt) requireAcceptance(input.backend);
        coordinator = candidate;
      }
      requireAcceptance(input.backend);
      throwIfAborted(input.signal);
      return await coordinator.buildPreparePayload(input);
    },
    buildSynthesizeCommand(input) {
      if (coordinator === null) {
        throw new Error('Prepare the accepted Supertonic selection before synthesis.');
      }
      requireAcceptance(snapshot.backend);
      return coordinator.buildSynthesizeCommand(input);
    },
  };
  return workbench;
}

async function loadSupertonicCoordinator(): Promise<SupertonicCoordinatorFactory> {
  const { SupertonicSelectionCoordinator } = await import('./runtime/supertonic/selection');
  return (input) => new SupertonicSelectionCoordinator(input);
}

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
 * is deliberately blocked until the exact local selection is accepted. Runtime
 * capability remains unavailable until a later evidence task enables it.
 */
export async function createLaunchServices(
  fetcher: typeof fetch = globalThis.fetch,
  {
    hasWebGpu = () => typeof navigator !== 'undefined' && 'gpu' in navigator,
    loadSupertonicCoordinator: loadCoordinator = loadSupertonicCoordinator,
    now = () => new Date(),
    store = createLocalDataStore(),
  }: LaunchServicesOptions = {},
): Promise<AppServices> {
  const catalog = await loadLaunchCatalog(fetcher);
  const assets = new AssetPreparationManager({
    store: new OpfsAssetStore(),
    fetcher,
    storage: createBrowserStorageManagerPort(),
  });
  const supertonicWorkbench = createSupertonicWorkbench({
    catalog,
    assetManager: assets,
    store,
    hasWebGpu,
    loadCoordinator,
    now,
  });
  const runtime = createLaunchRuntimeRegistry({
    voices: catalog.voices,
    assetSets: catalog.assetSets,
    supertonicSelectionCoordinator: supertonicWorkbench,
    hasWebGpu,
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
    store,
    preview: new PreviewController((url) => new Audio(url) as AudioPort),
    runtime,
    supertonicWorkbench,
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
    now,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}
