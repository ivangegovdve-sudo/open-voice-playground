import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_LANGUAGES,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
  SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES,
  SUPERTONIC_VOICE_IDS,
  SupertonicPrepareWorkerCommandSchema,
  SupertonicSynthesizeWorkerCommandSchema,
  type AssetSetManifest,
  type BrowserRuntimeArtifact,
  type BrowserRuntimeBackend,
  type BrowserRuntimeSelection,
  type SupertonicLanguage,
  type SupertonicPrepareWorkerCommand,
  type SupertonicSynthesizeWorkerCommand,
  type SupertonicVoiceId,
} from '@open-voice/contracts';

import type {
  AssetPreparationManager,
  AssetPreparationProgress,
  ConsentReceipt,
  PreparedAssetBytes,
  PreparedRuntimeArtifactBytes,
  ResolvedStoredRuntimeArtifact,
} from '../assets';
import type { SupertonicRuntimeArtifactResolver } from './runtime-artifacts';

const REQUIRED_LICENSE_IDS = ['supertone-weights-license'] as const;
const REQUIRED_TERMS_HASHES = [
  'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
] as const;
const MODEL_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323';
type TransferredAssetId = (typeof SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES)[number]['assetId'];
const MODEL_PATHS: Readonly<Record<TransferredAssetId, string>> = {
  'onnx-duration-predictor-onnx': 'onnx/duration_predictor.onnx',
  'onnx-text-encoder-onnx': 'onnx/text_encoder.onnx',
  'onnx-tts-json': 'onnx/tts.json',
  'onnx-unicode-indexer-json': 'onnx/unicode_indexer.json',
  'onnx-vector-estimator-onnx': 'onnx/vector_estimator.onnx',
  'onnx-vocoder-onnx': 'onnx/vocoder.onnx',
  'voice-styles-f1-json': 'voice_styles/F1.json',
  'voice-styles-f2-json': 'voice_styles/F2.json',
  'voice-styles-f3-json': 'voice_styles/F3.json',
  'voice-styles-f4-json': 'voice_styles/F4.json',
  'voice-styles-f5-json': 'voice_styles/F5.json',
  'voice-styles-m1-json': 'voice_styles/M1.json',
  'voice-styles-m2-json': 'voice_styles/M2.json',
  'voice-styles-m3-json': 'voice_styles/M3.json',
  'voice-styles-m4-json': 'voice_styles/M4.json',
  'voice-styles-m5-json': 'voice_styles/M5.json',
};
const RUNTIME_PACKAGE_NAME = 'onnxruntime-web';
const RUNTIME_PACKAGE_VERSION = '1.27.0';
const RUNTIME_TARBALL_URL =
  'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz';
const RUNTIME_TARBALL_INTEGRITY =
  'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==';
const RUNTIME_TARBALL_SHA1 = 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4';

type SupertonicAssetManager = Pick<
  AssetPreparationManager,
  'prepare' | 'readPreparedAssets' | 'prepareRuntimeArtifact' | 'readPreparedRuntimeArtifact'
>;

export type SupertonicSelectionReceipt = {
  selectionId: string;
  selectionDigest: string;
  acceptedLicenseIds: string[];
  acceptedTermsHashes: string[];
};

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

export type SupertonicPreparePayload = {
  command: SupertonicPrepareWorkerCommand;
  transferList: ArrayBuffer[];
  preparedKey: string;
};

export type SupertonicSelectionCoordinatorOptions = {
  assetSet: AssetSetManifest;
  runtimeArtifacts: readonly BrowserRuntimeArtifact[];
  runtimeSelections: readonly BrowserRuntimeSelection[];
  assetManager: SupertonicAssetManager;
  getReceipt: (description: SupertonicSelectionDescription) => SupertonicSelectionReceipt | null;
  loadRuntimeResolver?: () => Promise<SupertonicRuntimeArtifactResolver>;
  currentOrigin?: () => string;
};

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return sameArray(Object.keys(value).sort(), [...expected].sort());
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  Object.freeze(value);
  return value;
}

function safeAdd(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Supertonic selection bytes exceed safe browser limits.');
  }
  return total;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The Supertonic selection was cancelled.', 'AbortError');
  }
}

function assertCanonicalAssetSet(candidate: AssetSetManifest): void {
  if (
    !hasExactKeys(candidate, [
      'id',
      'engineId',
      'manifestDigest',
      'assets',
      'totalBytes',
      'requiredAcceptanceLicenseIds',
      'releaseGate',
    ]) ||
    candidate.id !== SUPERTONIC_ASSET_SET_ID ||
    candidate.engineId !== 'supertonic' ||
    candidate.manifestDigest !== SUPERTONIC_MANIFEST_DIGEST ||
    candidate.totalBytes !== 401_276_744 ||
    candidate.releaseGate.status !== 'enabled' ||
    candidate.releaseGate.reason !== null ||
    candidate.releaseGate.detail !==
      'Reviewed preset and immutable asset evidence are present for this declared runtime.' ||
    !hasExactKeys(candidate.releaseGate, ['status', 'reason', 'detail']) ||
    !sameArray(candidate.requiredAcceptanceLicenseIds, REQUIRED_LICENSE_IDS) ||
    candidate.assets.length !== SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.length
  ) {
    throw new Error('Supertonic asset set does not match the frozen selection boundary.');
  }
  for (const [index, expected] of SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.entries()) {
    const asset = candidate.assets[index];
    const finalOrigin =
      expected.mediaType === 'application/onnx'
        ? 'https://cas-bridge.xethub.hf.co'
        : 'https://huggingface.co';
    const expectedUrl = `https://huggingface.co/Supertone/supertonic-3/resolve/${MODEL_REVISION}/${MODEL_PATHS[expected.assetId]}?download=true`;
    const expectedCacheKey = `supertonic/${expected.assetId}/${MODEL_REVISION}/${expected.sha256.slice('sha256:'.length)}`;
    if (
      asset === undefined ||
      !hasExactKeys(asset, [
        'id',
        'url',
        'approvedFinalOrigins',
        'revision',
        'sha256',
        'bytes',
        'cacheKey',
        'mediaType',
        'sourceIds',
        'licenseIds',
        'requiredAcceptance',
      ]) ||
      asset.id !== expected.assetId ||
      asset.url !== expectedUrl ||
      !sameArray(asset.approvedFinalOrigins, [finalOrigin]) ||
      asset.revision !== MODEL_REVISION ||
      asset.sha256 !== expected.sha256 ||
      asset.bytes !== expected.byteLength ||
      asset.cacheKey !== expectedCacheKey ||
      asset.mediaType !== expected.mediaType ||
      !sameArray(asset.sourceIds, ['supertone-model-source']) ||
      !sameArray(asset.licenseIds, REQUIRED_LICENSE_IDS) ||
      asset.requiredAcceptance === undefined ||
      asset.requiredAcceptance === null ||
      !hasExactKeys(asset.requiredAcceptance, ['licenseId', 'termsHash']) ||
      asset.requiredAcceptance?.licenseId !== REQUIRED_LICENSE_IDS[0] ||
      asset.requiredAcceptance.termsHash !== REQUIRED_TERMS_HASHES[0]
    ) {
      throw new Error('Supertonic model identity does not match canonical asset-set order.');
    }
  }
}

function assertCanonicalRuntimeRecords(
  artifacts: readonly BrowserRuntimeArtifact[],
  selections: readonly BrowserRuntimeSelection[],
): void {
  if (artifacts.length !== 2 || selections.length !== 2) {
    throw new Error('Supertonic requires exactly two frozen runtime selections.');
  }
  for (const backend of ['wasm', 'webgpu'] as const) {
    const expected = SUPERTONIC_RUNTIME_IDENTITIES[backend];
    const artifact = artifacts.find((candidate) => candidate.backend === backend);
    const selection = selections.find((candidate) => candidate.backend === backend);
    if (artifact === undefined || selection === undefined) {
      throw new Error('Supertonic runtime records do not match the frozen backend join.');
    }
    const runtimeStem =
      backend === 'webgpu' ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
    const packagePath = `dist/${runtimeStem}.wasm`;
    const cacheKey = `runtime/${RUNTIME_PACKAGE_NAME}/${RUNTIME_PACKAGE_VERSION}/${runtimeStem}/${expected.sha256.slice('sha256:'.length)}`;
    if (
      !hasExactKeys(artifact, [
        'id',
        'backend',
        'packageName',
        'packageVersion',
        'tarballUrl',
        'tarballIntegrity',
        'tarballSha1',
        'packagePath',
        'sha256',
        'bytes',
        'mediaType',
        'cacheKey',
        'sourceIds',
        'licenseIds',
      ]) ||
      artifact.id !== expected.artifactId ||
      artifact.backend !== backend ||
      artifact.packageName !== RUNTIME_PACKAGE_NAME ||
      artifact.packageVersion !== RUNTIME_PACKAGE_VERSION ||
      artifact.tarballUrl !== RUNTIME_TARBALL_URL ||
      artifact.tarballIntegrity !== RUNTIME_TARBALL_INTEGRITY ||
      artifact.tarballSha1 !== RUNTIME_TARBALL_SHA1 ||
      artifact.packagePath !== packagePath ||
      artifact.sha256 !== expected.sha256 ||
      artifact.bytes !== expected.byteLength ||
      artifact.mediaType !== expected.mediaType ||
      artifact.cacheKey !== cacheKey ||
      !sameArray(artifact.sourceIds, ['onnxruntime-web-source']) ||
      !sameArray(artifact.licenseIds, ['onnxruntime-web-runtime-license']) ||
      !hasExactKeys(selection, [
        'id',
        'engineId',
        'backend',
        'assetSetId',
        'runtimeArtifactId',
        'selectionDigest',
      ]) ||
      selection.id !== expected.selectionId ||
      selection.selectionDigest !== expected.selectionDigest ||
      selection.engineId !== 'supertonic' ||
      selection.backend !== backend ||
      selection.assetSetId !== SUPERTONIC_ASSET_SET_ID ||
      selection.runtimeArtifactId !== expected.artifactId
    ) {
      throw new Error('Supertonic runtime records do not match the frozen backend join.');
    }
  }
}

function validateReceipt(
  receipt: SupertonicSelectionReceipt | null,
  description: SupertonicSelectionDescription,
): asserts receipt is SupertonicSelectionReceipt {
  if (
    receipt === null ||
    receipt.selectionId !== description.selectionId ||
    receipt.selectionDigest !== description.selectionDigest ||
    !sameArray(receipt.acceptedLicenseIds, REQUIRED_LICENSE_IDS) ||
    !sameArray(receipt.acceptedTermsHashes, REQUIRED_TERMS_HASHES)
  ) {
    throw new Error(
      'An exact current Supertonic selection receipt is required before asset access.',
    );
  }
}

function assertPreparedModels(
  prepared: readonly PreparedAssetBytes[],
  assetSet: AssetSetManifest,
): void {
  if (prepared.length !== assetSet.assets.length) {
    throw new Error('Prepared Supertonic model closure is incomplete.');
  }
  const owners = new Set<ArrayBuffer>();
  for (const [index, expected] of assetSet.assets.entries()) {
    const item = prepared[index];
    if (
      item === undefined ||
      item.assetId !== expected.id ||
      item.cacheKey !== expected.cacheKey ||
      item.sha256 !== expected.sha256 ||
      item.byteLength !== expected.bytes ||
      item.bytes.byteLength !== expected.bytes ||
      owners.has(item.bytes)
    ) {
      throw new Error('Prepared Supertonic bytes do not match the canonical model closure.');
    }
    owners.add(item.bytes);
  }
}

function assertPreparedRuntime(
  prepared: PreparedRuntimeArtifactBytes,
  artifact: BrowserRuntimeArtifact,
  modelBytes: readonly PreparedAssetBytes[],
): void {
  if (
    prepared.artifactId !== artifact.id ||
    prepared.cacheKey !== artifact.cacheKey ||
    prepared.sha256 !== artifact.sha256 ||
    prepared.byteLength !== artifact.bytes ||
    prepared.mediaType !== artifact.mediaType ||
    prepared.bytes.byteLength !== artifact.bytes ||
    modelBytes.some(({ bytes }) => bytes === prepared.bytes)
  ) {
    throw new Error('Prepared runtime bytes do not match the selected frozen artifact.');
  }
}

function assertOperation(
  operationId: number,
  voiceId: string,
): asserts voiceId is SupertonicVoiceId {
  if (!Number.isSafeInteger(operationId) || operationId < 0) {
    throw new Error('Supertonic operation ID must be a nonnegative safe integer.');
  }
  if (!(SUPERTONIC_VOICE_IDS as readonly string[]).includes(voiceId)) {
    throw new Error('Supertonic voice ID is outside the frozen preset set.');
  }
}

export class SupertonicSelectionCoordinator {
  private readonly assetSet: AssetSetManifest;
  private readonly artifacts: Readonly<Record<BrowserRuntimeBackend, BrowserRuntimeArtifact>>;
  private readonly selections: Readonly<Record<BrowserRuntimeBackend, BrowserRuntimeSelection>>;
  private readonly assetManager: SupertonicAssetManager;
  private readonly getReceipt: SupertonicSelectionCoordinatorOptions['getReceipt'];
  private readonly loadRuntimeResolver: () => Promise<SupertonicRuntimeArtifactResolver>;
  private readonly currentOrigin: () => string;

  constructor({
    assetSet,
    runtimeArtifacts,
    runtimeSelections,
    assetManager,
    getReceipt,
    loadRuntimeResolver = async () =>
      (await import('./runtime-artifacts')).resolveSupertonicRuntimeArtifact,
    currentOrigin = () => globalThis.location.origin,
  }: SupertonicSelectionCoordinatorOptions) {
    const canonicalAssetSet = structuredClone(assetSet);
    const canonicalArtifacts = structuredClone(runtimeArtifacts);
    const canonicalSelections = structuredClone(runtimeSelections);
    assertCanonicalAssetSet(canonicalAssetSet);
    assertCanonicalRuntimeRecords(canonicalArtifacts, canonicalSelections);
    this.assetSet = deepFreeze(canonicalAssetSet);
    this.artifacts = deepFreeze({
      wasm: canonicalArtifacts.find(({ backend }) => backend === 'wasm')!,
      webgpu: canonicalArtifacts.find(({ backend }) => backend === 'webgpu')!,
    });
    this.selections = deepFreeze({
      wasm: canonicalSelections.find(({ backend }) => backend === 'wasm')!,
      webgpu: canonicalSelections.find(({ backend }) => backend === 'webgpu')!,
    });
    this.assetManager = assetManager;
    this.getReceipt = getReceipt;
    this.loadRuntimeResolver = loadRuntimeResolver;
    this.currentOrigin = currentOrigin;
  }

  describe(backend: BrowserRuntimeBackend): SupertonicSelectionDescription {
    const selection = this.selections[backend];
    const artifact = this.artifacts[backend];
    const selectedBytes = safeAdd(this.assetSet.totalBytes, artifact.bytes);
    const largestAssetBytes = Math.max(
      artifact.bytes,
      ...this.assetSet.assets.map(({ bytes }) => bytes),
    );
    const safetyMarginBytes = Math.ceil(selectedBytes * 0.05);
    return {
      selectionId: selection.id,
      selectionDigest: selection.selectionDigest,
      backend,
      assetSetId: SUPERTONIC_ASSET_SET_ID,
      manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
      runtimeArtifactId: artifact.id,
      modelBytes: this.assetSet.totalBytes,
      runtimeBytes: artifact.bytes,
      selectedBytes,
      largestAssetBytes,
      safetyMarginBytes,
      upperBoundBytes: safeAdd(selectedBytes, largestAssetBytes, safetyMarginBytes),
      requiredLicenseIds: [...REQUIRED_LICENSE_IDS],
      requiredTermsHashes: [...REQUIRED_TERMS_HASHES],
    };
  }

  preparedKey(voiceId: string, backend: BrowserRuntimeBackend): string {
    assertOperation(0, voiceId);
    const selection = this.selections[backend];
    const artifact = this.artifacts[backend];
    return JSON.stringify([
      voiceId,
      selection.id,
      selection.selectionDigest,
      backend,
      SUPERTONIC_ASSET_SET_ID,
      SUPERTONIC_MANIFEST_DIGEST,
      artifact.id,
    ]);
  }

  async buildPreparePayload({
    operationId,
    voiceId,
    backend,
    signal,
    onProgress,
  }: {
    operationId: number;
    voiceId: string;
    backend: BrowserRuntimeBackend;
    signal?: AbortSignal;
    onProgress?: (progress: { phase: string; percent: number }) => void;
  }): Promise<SupertonicPreparePayload> {
    assertOperation(operationId, voiceId);
    const description = deepFreeze(structuredClone(this.describe(backend)));
    throwIfAborted(signal);
    const receipt = this.getReceipt(description);
    validateReceipt(receipt, this.describe(backend));
    throwIfAborted(signal);

    const modelReceipt: ConsentReceipt = {
      assetSetId: this.assetSet.id,
      manifestDigest: this.assetSet.manifestDigest,
      acceptedLicenseIds: [...receipt.acceptedLicenseIds],
      acceptedTermsHashes: [...receipt.acceptedTermsHashes],
    };
    const assetProgress =
      onProgress === undefined
        ? undefined
        : ({ assetId, percent }: AssetPreparationProgress) =>
            onProgress({ phase: assetId, percent });
    const preparationOptions = {
      ...(signal === undefined ? {} : { signal }),
      ...(assetProgress === undefined ? {} : { onProgress: assetProgress }),
    };
    const readOptions = signal === undefined ? {} : { signal };
    await this.assetManager.prepare(this.assetSet, modelReceipt, preparationOptions);
    throwIfAborted(signal);
    const preparedModels = await this.assetManager.readPreparedAssets(
      this.assetSet,
      modelReceipt,
      readOptions,
    );
    throwIfAborted(signal);
    assertPreparedModels(preparedModels, this.assetSet);

    const resolver = await this.loadRuntimeResolver();
    throwIfAborted(signal);
    const selection = this.selections[backend];
    const artifact = this.artifacts[backend];
    const resolved = await resolver(selection, artifact);
    throwIfAborted(signal);
    const exactOrigin = new URL(this.currentOrigin()).origin;
    const resolvedUrl = new URL(resolved.url);
    if (
      exactOrigin !== this.currentOrigin() ||
      resolvedUrl.origin !== exactOrigin ||
      resolvedUrl.username.length > 0 ||
      resolvedUrl.password.length > 0
    ) {
      throw new Error('Resolved Supertonic runtime URL escaped the exact application origin.');
    }
    const storedRuntime: ResolvedStoredRuntimeArtifact = {
      id: artifact.id,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      cacheKey: artifact.cacheKey,
      mediaType: artifact.mediaType,
      url: resolvedUrl.href,
      exactOrigin,
    };
    await this.assetManager.prepareRuntimeArtifact(storedRuntime, preparationOptions);
    throwIfAborted(signal);
    const preparedRuntime = await this.assetManager.readPreparedRuntimeArtifact(
      storedRuntime,
      readOptions,
    );
    throwIfAborted(signal);
    assertPreparedRuntime(preparedRuntime, artifact, preparedModels);

    const command = SupertonicPrepareWorkerCommandSchema.parse({
      command: 'prepare',
      operationId,
      engineId: 'supertonic',
      voiceId,
      selectionId: selection.id,
      selectionDigest: selection.selectionDigest,
      backend,
      assetSetId: this.assetSet.id,
      manifestDigest: this.assetSet.manifestDigest,
      runtimeArtifactId: artifact.id,
      assets: preparedModels.map((prepared, index) => ({
        assetId: prepared.assetId,
        sha256: prepared.sha256,
        byteLength: prepared.byteLength,
        mediaType: this.assetSet.assets[index]!.mediaType,
        bytes: prepared.bytes,
      })),
      runtimeArtifact: {
        artifactId: preparedRuntime.artifactId,
        sha256: preparedRuntime.sha256,
        byteLength: preparedRuntime.byteLength,
        mediaType: preparedRuntime.mediaType,
        bytes: preparedRuntime.bytes,
      },
    });
    throwIfAborted(signal);
    const transferList = [
      ...command.assets.map(({ bytes }) => bytes),
      command.runtimeArtifact.bytes,
    ];
    return { command, transferList, preparedKey: this.preparedKey(voiceId, backend) };
  }

  buildSynthesizeCommand({
    operationId,
    voiceId,
    text,
    language,
    speed,
  }: {
    operationId: number;
    voiceId: string;
    text: string;
    language: SupertonicLanguage;
    speed: number;
  }): SupertonicSynthesizeWorkerCommand {
    if (!(SUPERTONIC_LANGUAGES as readonly string[]).includes(language)) {
      throw new Error('Unsupported Supertonic language.');
    }
    return SupertonicSynthesizeWorkerCommandSchema.parse({
      command: 'synthesize',
      operationId,
      engineId: 'supertonic',
      voiceId,
      text,
      controls: { language, speed },
    });
  }
}
