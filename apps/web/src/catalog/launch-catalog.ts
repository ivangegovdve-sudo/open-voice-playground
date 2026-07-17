import type {
  AssetDeliveryEvidence,
  AssetSetManifest,
  BrowserRuntimeArtifact,
  BrowserRuntimeSelection,
  FeatureFlag,
  GalleryManifest,
  GeneratedMediaProvenance,
  GenerationCandidate,
  LaunchEngineManifest,
  LaunchVoicePreset,
  LicenseRecord,
  OfficialSample,
  PinnedReleaseAssetEvidence,
  PocketCoverageManifest,
  SourceRecord,
} from '@open-voice/contracts';

import catalogIntegrity from '../../../../packages/catalog/data/launch-catalog.integrity.json';

import { deriveLanguageName, deriveRegionFromLocale, type SeedCatalog } from './catalog';
import type { CatalogVoice, RuntimeMode } from './filters';

type LaunchCatalogData = {
  schemaVersion: 4;
  catalogId: 'open-voice-launch';
  generatedAt: string;
  engines: LaunchEngineManifest[];
  voices: LaunchVoicePreset[];
  samples: OfficialSample[];
  licenses: LicenseRecord[];
  sources: SourceRecord[];
  assetSets: AssetSetManifest[];
  runtimeArtifacts: BrowserRuntimeArtifact[];
  runtimeSelections: BrowserRuntimeSelection[];
  assetDeliveryEvidence: AssetDeliveryEvidence[];
  releaseAssetEvidence: PinnedReleaseAssetEvidence[];
  featureFlags: FeatureFlag[];
  galleries: GalleryManifest[];
  generationCandidates: GenerationCandidate[];
  generatedMedia: GeneratedMediaProvenance[];
  pocketCoverage: PocketCoverageManifest;
};

const ARRAY_FIELDS = [
  'engines',
  'voices',
  'samples',
  'licenses',
  'sources',
  'assetSets',
  'runtimeArtifacts',
  'runtimeSelections',
  'assetDeliveryEvidence',
  'releaseAssetEvidence',
  'featureFlags',
  'galleries',
  'generationCandidates',
  'generatedMedia',
] as const;

const TOP_LEVEL_FIELDS = [
  ...ARRAY_FIELDS,
  'catalogId',
  'generatedAt',
  'pocketCoverage',
  'schemaVersion',
].sort();
const EXPECTED_ENGINE_COUNTS: Readonly<Record<string, number>> = {
  edge: 322,
  kitten: 8,
  kokoro: 54,
  piper: 12,
  pocket: 20,
  supertonic: 10,
};
const LAUNCH_CATALOG_CACHE_PREFIX = 'open-voice-launch-catalog-';
const STRICT_JSON_CONTENT_TYPE =
  /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;
const RUNTIME_ARTIFACT_FIELDS = [
  'backend',
  'bytes',
  'cacheKey',
  'id',
  'licenseIds',
  'mediaType',
  'packageName',
  'packagePath',
  'packageVersion',
  'sha256',
  'sourceIds',
  'tarballIntegrity',
  'tarballSha1',
  'tarballUrl',
].sort();
const RUNTIME_SELECTION_FIELDS = [
  'assetSetId',
  'backend',
  'engineId',
  'id',
  'runtimeArtifactId',
  'selectionDigest',
].sort();
const EXPECTED_SUPERTONIC_ASSET_SET_DIGEST =
  'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6';
const EXPECTED_RUNTIME_ARTIFACTS: Readonly<Record<string, BrowserRuntimeArtifact>> = {
  'onnxruntime-web-wasm-runtime': {
    id: 'onnxruntime-web-wasm-runtime',
    backend: 'wasm',
    packageName: 'onnxruntime-web',
    packageVersion: '1.27.0',
    tarballUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz',
    tarballIntegrity:
      'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==',
    tarballSha1: 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4',
    packagePath: 'dist/ort-wasm-simd-threaded.wasm',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    bytes: 13_479_978,
    mediaType: 'application/wasm',
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded/d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    sourceIds: ['onnxruntime-web-source'],
    licenseIds: ['onnxruntime-web-runtime-license'],
  },
  'onnxruntime-web-webgpu-jsep-wasm': {
    id: 'onnxruntime-web-webgpu-jsep-wasm',
    backend: 'webgpu',
    packageName: 'onnxruntime-web',
    packageVersion: '1.27.0',
    tarballUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz',
    tarballIntegrity:
      'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==',
    tarballSha1: 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4',
    packagePath: 'dist/ort-wasm-simd-threaded.jsep.wasm',
    sha256: 'sha256:78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    bytes: 26_827_543,
    mediaType: 'application/wasm',
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded.jsep/78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    sourceIds: ['onnxruntime-web-source'],
    licenseIds: ['onnxruntime-web-runtime-license'],
  },
};
const EXPECTED_RUNTIME_SELECTIONS: Readonly<Record<string, BrowserRuntimeSelection>> = {
  'supertonic-wasm': {
    id: 'supertonic-wasm',
    engineId: 'supertonic',
    backend: 'wasm',
    assetSetId: 'supertonic-browser-assets',
    runtimeArtifactId: 'onnxruntime-web-wasm-runtime',
    selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
  },
  'supertonic-webgpu': {
    id: 'supertonic-webgpu',
    engineId: 'supertonic',
    backend: 'webgpu',
    assetSetId: 'supertonic-browser-assets',
    runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm',
    selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
  },
};
const POCKET_COVERAGE_FIELDS = [
  'auditSourceIds',
  'engineId',
  'id',
  'inventorySha256',
  'labelCount',
  'languageCounts',
  'officialDemo',
  'publishedOutputClipCount',
  'revisionPins',
  'rightsCounts',
  'selectorCount',
  'totalEmbeddings',
  'variants',
].sort();
const POCKET_REVISION_PIN_FIELDS = [
  'currentCodeAudit',
  'fullModel',
  'historicalPromptSnapshot',
  'noCloningModel',
  'stableCode',
  'voiceRepository',
].sort();
const POCKET_LANGUAGE_COUNT_FIELDS = ['de', 'en', 'es', 'fr', 'it', 'pt'].sort();
const POCKET_RIGHTS_COUNT_FIELDS = [
  'catalogOnlyRuntimeCandidate',
  'linkOnlyNonCommercial',
  'linkOnlyProvenancePending',
].sort();
const POCKET_VARIANT_FIELDS = [
  'countryCode',
  'engineId',
  'gender',
  'id',
  'label',
  'languageTag',
  'licenseIds',
  'listingPolicy',
  'officialDemoId',
  'rightsFamily',
  'selectorId',
  'sourceIds',
  'runtimeExclusionReason',
  'upstreamId',
  'upstreamPath',
].sort();
const POCKET_OFFICIAL_DEMO_FIELDS = [
  'audioPublished',
  'engineId',
  'id',
  'offlineAvailable',
  'outputClipStatus',
  'pageUrl',
  'reviewedAt',
  'rightsBasis',
  'sourceIds',
].sort();
const POCKET_SELECTOR_LANGUAGES = {
  english: 'en',
  'english_2026-01': 'en',
  'english_2026-04': 'en',
  french_24l: 'fr',
  german: 'de',
  german_24l: 'de',
  italian: 'it',
  italian_24l: 'it',
  portuguese: 'pt',
  portuguese_24l: 'pt',
  spanish: 'es',
  spanish_24l: 'es',
} as const;
const POCKET_LABELS = new Set([
  'alba',
  'anna',
  'azelma',
  'bill_boerst',
  'caro_davy',
  'charles',
  'cosette',
  'eponine',
  'estelle',
  'eve',
  'fantine',
  'george',
  'giovanni',
  'jane',
  'javert',
  'jean',
  'juergen',
  'lola',
  'marius',
  'mary',
  'michael',
  'paul',
  'peter_yearsley',
  'rafael',
  'stuart_bell',
  'vera',
]);
const POCKET_RIGHTS_FAMILIES = new Set([
  'alba-mackenna',
  'unmute-estelle',
  'vctk',
  'voice-zero',
  'voice-donation',
  'expresso',
  'ears',
  'repository-level-unclear',
]);
const POCKET_POLICY_REASONS = {
  'catalog-only-runtime-candidate': 'assets-not-release-pinned',
  'link-only-noncommercial': 'noncommercial-source-terms',
  'link-only-provenance-pending': 'per-clip-provenance-unresolved',
} as const;
const EXPECTED_POCKET_REVISIONS = {
  stableCode: '058886528d0b6f2f2d4022de2e244a5260729e6e',
  currentCodeAudit: 'd108410d23eef7e01db282f9442891162dbc3db6',
  fullModel: '4c8ad48f8a003909bc4f1122cbe88a4252124621',
  noCloningModel: 'e041936c75475d350b405bc870bcf7c22da4e9e6',
  voiceRepository: '323332d33f997de8394f24a193e1a76df720e01a',
  historicalPromptSnapshot: '64ab7d24c479d736a83b8cc666c4a776fca30fda',
} as const;
const EXPECTED_POCKET_LANGUAGE_COUNTS = {
  en: 78,
  fr: 26,
  de: 52,
  it: 52,
  pt: 52,
  es: 52,
} as const;
const EXPECTED_POCKET_RIGHTS_COUNTS = {
  catalogOnlyRuntimeCandidate: 240,
  linkOnlyNonCommercial: 24,
  linkOnlyProvenancePending: 48,
} as const;
const EXPECTED_POCKET_AUDIT_SOURCE_IDS = [
  'pocket-code-source',
  'pocket-current-code-audit-source',
  'pocket-full-model-source',
  'pocket-weights-source',
  'pocket-voice-source',
  'pocket-historical-prompt-source',
  'pocket-multilingual-announcement-source',
  'pocket-official-live-demo-source',
] as const;
const POCKET_OFFICIAL_DEMO_RIGHTS_BASIS =
  'External live-generation page only; no conditioning audio or output is copied, proxied, cached, or redistributed.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasSameClosedRecord(
  candidate: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  const candidateKeys = Object.keys(candidate).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    JSON.stringify(candidateKeys) === JSON.stringify(expectedKeys) &&
    candidateKeys.every((key) => {
      const candidateValue = candidate[key];
      const expectedValue = expected[key];
      return Array.isArray(candidateValue) && Array.isArray(expectedValue)
        ? JSON.stringify(candidateValue) === JSON.stringify(expectedValue)
        : candidateValue === expectedValue;
    })
  );
}

function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
    new Set(value).size === value.length
  );
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields);
}

function isUniqueRecordIdArray(value: unknown): value is string[] {
  return (
    isUniqueNonEmptyStringArray(value) &&
    value.every((entry) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(entry))
  );
}

const ISO_DATE_TIME =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME.test(value);
}

function parsePocketCoverage(
  value: unknown,
  runtimeVoiceIds: ReadonlySet<string>,
): PocketCoverageManifest {
  if (
    !isRecord(value) ||
    !hasExactFields(value, POCKET_COVERAGE_FIELDS) ||
    value.id !== 'pocket-multilingual-coverage' ||
    value.engineId !== 'pocket' ||
    typeof value.inventorySha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.inventorySha256) ||
    value.selectorCount !== 12 ||
    value.labelCount !== 26 ||
    value.totalEmbeddings !== 312 ||
    value.publishedOutputClipCount !== 0 ||
    !isRecord(value.revisionPins) ||
    !hasExactFields(value.revisionPins, POCKET_REVISION_PIN_FIELDS) ||
    !hasSameClosedRecord(value.revisionPins, EXPECTED_POCKET_REVISIONS) ||
    !isRecord(value.languageCounts) ||
    !hasExactFields(value.languageCounts, POCKET_LANGUAGE_COUNT_FIELDS) ||
    !hasSameClosedRecord(value.languageCounts, EXPECTED_POCKET_LANGUAGE_COUNTS) ||
    !isRecord(value.rightsCounts) ||
    !hasExactFields(value.rightsCounts, POCKET_RIGHTS_COUNT_FIELDS) ||
    !hasSameClosedRecord(value.rightsCounts, EXPECTED_POCKET_RIGHTS_COUNTS) ||
    JSON.stringify(value.auditSourceIds) !== JSON.stringify(EXPECTED_POCKET_AUDIT_SOURCE_IDS) ||
    !Array.isArray(value.variants) ||
    value.variants.length !== 312 ||
    !isRecord(value.officialDemo)
  ) {
    throw new Error('Invalid launch catalog payload: malformed Pocket coverage summary.');
  }

  const officialDemo = value.officialDemo;
  if (
    !hasExactFields(officialDemo, POCKET_OFFICIAL_DEMO_FIELDS) ||
    officialDemo.id !== 'pocket-official-live-demo' ||
    officialDemo.engineId !== 'pocket' ||
    officialDemo.pageUrl !== 'https://kyutai.org/tts' ||
    JSON.stringify(officialDemo.sourceIds) !==
      JSON.stringify(['pocket-official-live-demo-source']) ||
    officialDemo.outputClipStatus !== 'no-stable-official-generated-output-found' ||
    officialDemo.audioPublished !== false ||
    officialDemo.offlineAvailable !== false ||
    officialDemo.rightsBasis !== POCKET_OFFICIAL_DEMO_RIGHTS_BASIS ||
    !isIsoDateTime(officialDemo.reviewedAt)
  ) {
    throw new Error('Invalid launch catalog payload: malformed Pocket official demo.');
  }

  const variantIds = new Set<string>();
  const upstreamPaths = new Set<string>();
  const selectorIds = new Set<string>();
  const labels = new Set<string>();
  const languageCounts: Record<string, number> = { en: 0, fr: 0, de: 0, it: 0, pt: 0, es: 0 };
  const policyCounts: Record<string, number> = {
    'catalog-only-runtime-candidate': 0,
    'link-only-noncommercial': 0,
    'link-only-provenance-pending': 0,
  };

  for (const variant of value.variants) {
    if (!isRecord(variant) || !hasExactFields(variant, POCKET_VARIANT_FIELDS)) {
      throw new Error('Invalid launch catalog payload: malformed Pocket coverage variant.');
    }
    const selectorId = variant.selectorId;
    const label = variant.label;
    const listingPolicy = variant.listingPolicy;
    const expectedLanguage =
      typeof selectorId === 'string'
        ? POCKET_SELECTOR_LANGUAGES[selectorId as keyof typeof POCKET_SELECTOR_LANGUAGES]
        : undefined;
    const expectedReason =
      typeof listingPolicy === 'string'
        ? POCKET_POLICY_REASONS[listingPolicy as keyof typeof POCKET_POLICY_REASONS]
        : undefined;
    if (
      typeof variant.id !== 'string' ||
      variant.engineId !== 'pocket' ||
      typeof selectorId !== 'string' ||
      expectedLanguage === undefined ||
      typeof label !== 'string' ||
      !POCKET_LABELS.has(label) ||
      variant.id !== `pocket:${selectorId}.${label}` ||
      variant.upstreamId !== `${selectorId}.${label}` ||
      variant.upstreamPath !== `languages/${selectorId}/embeddings/${label}.safetensors` ||
      variant.languageTag !== expectedLanguage ||
      variant.countryCode !== null ||
      variant.gender !== 'unspecified' ||
      typeof variant.rightsFamily !== 'string' ||
      !POCKET_RIGHTS_FAMILIES.has(variant.rightsFamily) ||
      typeof listingPolicy !== 'string' ||
      expectedReason === undefined ||
      variant.runtimeExclusionReason !== expectedReason ||
      !isUniqueRecordIdArray(variant.licenseIds) ||
      !isUniqueRecordIdArray(variant.sourceIds) ||
      variant.officialDemoId !== officialDemo.id
    ) {
      throw new Error('Invalid launch catalog payload: malformed Pocket coverage variant.');
    }
    if (runtimeVoiceIds.has(variant.id)) {
      throw new Error('Invalid launch catalog payload: Pocket coverage runtime ID collision.');
    }
    if (variantIds.has(variant.id) || upstreamPaths.has(variant.upstreamPath as string)) {
      throw new Error('Invalid launch catalog payload: duplicate Pocket coverage identity.');
    }
    variantIds.add(variant.id);
    upstreamPaths.add(variant.upstreamPath as string);
    selectorIds.add(selectorId);
    labels.add(label);
    languageCounts[expectedLanguage] = (languageCounts[expectedLanguage] ?? 0) + 1;
    policyCounts[listingPolicy] = (policyCounts[listingPolicy] ?? 0) + 1;
  }

  if (
    selectorIds.size !== 12 ||
    labels.size !== 26 ||
    Object.entries(EXPECTED_POCKET_LANGUAGE_COUNTS).some(
      ([language, expected]) => languageCounts[language] !== expected,
    ) ||
    policyCounts['catalog-only-runtime-candidate'] !==
      EXPECTED_POCKET_RIGHTS_COUNTS.catalogOnlyRuntimeCandidate ||
    policyCounts['link-only-noncommercial'] !==
      EXPECTED_POCKET_RIGHTS_COUNTS.linkOnlyNonCommercial ||
    policyCounts['link-only-provenance-pending'] !==
      EXPECTED_POCKET_RIGHTS_COUNTS.linkOnlyProvenancePending
  ) {
    throw new Error('Invalid launch catalog payload: Pocket coverage closure drift.');
  }

  return value as unknown as PocketCoverageManifest;
}

function parseLaunchCatalog(value: unknown): LaunchCatalogData {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(TOP_LEVEL_FIELDS) ||
    value.schemaVersion !== 4 ||
    value.catalogId !== 'open-voice-launch' ||
    typeof value.generatedAt !== 'string' ||
    !isRecord(value.pocketCoverage) ||
    ARRAY_FIELDS.some((field) => !Array.isArray(value[field]))
  ) {
    throw new Error('Invalid launch catalog payload: required public fields are missing.');
  }
  const candidate = value as unknown as LaunchCatalogData;
  if (candidate.voices.length !== 426) {
    throw new Error(
      `Invalid launch catalog payload: expected 426 presets, got ${candidate.voices.length}.`,
    );
  }
  const runtimeVoiceIds = new Set(candidate.voices.map(({ id }) => id));
  if (runtimeVoiceIds.size !== candidate.voices.length) {
    throw new Error('Invalid launch catalog payload: duplicate preset IDs.');
  }
  if (candidate.engines.length !== 6 || candidate.galleries.length !== 12) {
    throw new Error('Invalid launch catalog payload: launch engine or gallery count drift.');
  }
  const engineIds = new Set<string>();
  for (const engine of candidate.engines) {
    if (
      !isRecord(engine) ||
      typeof engine.id !== 'string' ||
      typeof engine.displayName !== 'string' ||
      !Array.isArray(engine.runtimeModes) ||
      !Array.isArray(engine.languageTags) ||
      !Array.isArray(engine.licenseIds) ||
      !Array.isArray(engine.sourceIds) ||
      !isRecord(engine.releaseGate)
    ) {
      throw new Error('Invalid launch catalog payload: malformed engine record.');
    }
    engineIds.add(engine.id);
  }
  if (engineIds.size !== candidate.engines.length) {
    throw new Error('Invalid launch catalog payload: duplicate engine IDs.');
  }
  const runtimeArtifactIds = new Set<string>();
  const runtimeArtifactsById = new Map<string, BrowserRuntimeArtifact>();
  for (const artifact of candidate.runtimeArtifacts) {
    if (
      !isRecord(artifact) ||
      JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(RUNTIME_ARTIFACT_FIELDS) ||
      typeof artifact.id !== 'string' ||
      artifact.id.length === 0 ||
      (artifact.backend !== 'webgpu' && artifact.backend !== 'wasm') ||
      artifact.packageName !== 'onnxruntime-web' ||
      artifact.packageVersion !== '1.27.0' ||
      typeof artifact.tarballUrl !== 'string' ||
      artifact.tarballUrl.length === 0 ||
      typeof artifact.tarballIntegrity !== 'string' ||
      artifact.tarballIntegrity.length === 0 ||
      typeof artifact.tarballSha1 !== 'string' ||
      artifact.tarballSha1.length === 0 ||
      typeof artifact.packagePath !== 'string' ||
      artifact.packagePath.length === 0 ||
      typeof artifact.sha256 !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      (artifact.bytes as number) <= 0 ||
      artifact.mediaType !== 'application/wasm' ||
      typeof artifact.cacheKey !== 'string' ||
      artifact.cacheKey.length === 0 ||
      !isUniqueNonEmptyStringArray(artifact.sourceIds) ||
      !isUniqueNonEmptyStringArray(artifact.licenseIds)
    ) {
      throw new Error('Invalid launch catalog payload: malformed runtime artifact record.');
    }
    const expectedArtifact = EXPECTED_RUNTIME_ARTIFACTS[artifact.id];
    if (
      expectedArtifact === undefined ||
      !hasSameClosedRecord(artifact, expectedArtifact as unknown as Record<string, unknown>)
    ) {
      throw new Error('Invalid launch catalog payload: exact runtime artifact closure drift.');
    }
    if (runtimeArtifactIds.has(artifact.id)) {
      throw new Error('Invalid launch catalog payload: duplicate runtime artifact IDs.');
    }
    runtimeArtifactIds.add(artifact.id);
    runtimeArtifactsById.set(artifact.id, artifact as BrowserRuntimeArtifact);
  }
  if (
    candidate.runtimeArtifacts.length !== 2 ||
    !runtimeArtifactIds.has('onnxruntime-web-webgpu-jsep-wasm') ||
    !runtimeArtifactIds.has('onnxruntime-web-wasm-runtime')
  ) {
    throw new Error('Invalid launch catalog payload: exact runtime artifact closure drift.');
  }

  const runtimeSelectionIds = new Set<string>();
  for (const selection of candidate.runtimeSelections) {
    if (
      !isRecord(selection) ||
      JSON.stringify(Object.keys(selection).sort()) !== JSON.stringify(RUNTIME_SELECTION_FIELDS) ||
      typeof selection.id !== 'string' ||
      selection.id.length === 0 ||
      typeof selection.engineId !== 'string' ||
      selection.engineId.length === 0 ||
      (selection.backend !== 'webgpu' && selection.backend !== 'wasm') ||
      typeof selection.assetSetId !== 'string' ||
      selection.assetSetId.length === 0 ||
      typeof selection.runtimeArtifactId !== 'string' ||
      selection.runtimeArtifactId.length === 0 ||
      typeof selection.selectionDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(selection.selectionDigest)
    ) {
      throw new Error('Invalid launch catalog payload: malformed runtime selection record.');
    }
    const expectedSelection = EXPECTED_RUNTIME_SELECTIONS[selection.id];
    if (
      expectedSelection === undefined ||
      !hasSameClosedRecord(selection, expectedSelection as unknown as Record<string, unknown>)
    ) {
      throw new Error('Invalid launch catalog payload: exact runtime selection closure drift.');
    }
    const artifact = runtimeArtifactsById.get(selection.runtimeArtifactId);
    const assetSet = candidate.assetSets.find(({ id }) => id === selection.assetSetId);
    if (assetSet?.manifestDigest !== EXPECTED_SUPERTONIC_ASSET_SET_DIGEST) {
      throw new Error('Invalid launch catalog payload: exact runtime selection closure drift.');
    }
    if (
      runtimeSelectionIds.has(selection.id) ||
      !engineIds.has(selection.engineId) ||
      artifact?.backend !== selection.backend ||
      assetSet?.engineId !== selection.engineId
    ) {
      throw new Error('Invalid launch catalog payload: detached or duplicate runtime selection.');
    }
    runtimeSelectionIds.add(selection.id);
  }
  if (
    candidate.runtimeSelections.length !== 2 ||
    !runtimeSelectionIds.has('supertonic-webgpu') ||
    !runtimeSelectionIds.has('supertonic-wasm')
  ) {
    throw new Error('Invalid launch catalog payload: exact runtime selection closure drift.');
  }
  const actualEngineCounts: Record<string, number> = {};
  for (const voice of candidate.voices) {
    if (
      !isRecord(voice) ||
      typeof voice.id !== 'string' ||
      typeof voice.engineId !== 'string' ||
      typeof voice.displayName !== 'string' ||
      typeof voice.locale !== 'string' ||
      !Array.isArray(voice.languageTags) ||
      !Array.isArray(voice.runtimeModes) ||
      !Array.isArray(voice.styleTags) ||
      !Array.isArray(voice.licenseIds) ||
      !Array.isArray(voice.sourceIds) ||
      !isRecord(voice.releaseGate) ||
      (voice.releaseGate.status !== 'enabled' && voice.releaseGate.status !== 'unavailable') ||
      !engineIds.has(voice.engineId)
    ) {
      throw new Error('Invalid launch catalog payload: malformed voice record.');
    }
    actualEngineCounts[voice.engineId] = (actualEngineCounts[voice.engineId] ?? 0) + 1;
  }
  if (
    Object.entries(EXPECTED_ENGINE_COUNTS).some(
      ([engineId, expected]) => actualEngineCounts[engineId] !== expected,
    ) ||
    Object.keys(actualEngineCounts).some((engineId) => !(engineId in EXPECTED_ENGINE_COUNTS))
  ) {
    throw new Error('Invalid launch catalog payload: per-engine preset count drift.');
  }
  const pocketCoverage = parsePocketCoverage(candidate.pocketCoverage, runtimeVoiceIds);
  return { ...candidate, pocketCoverage };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function mapLaunchCatalog(value: unknown): SeedCatalog {
  const launch = parseLaunchCatalog(value);
  const enginesById = new Map(launch.engines.map((engine) => [engine.id, engine]));
  const voices: CatalogVoice[] = launch.voices.map((voice) => {
    const engine = enginesById.get(voice.engineId);
    if (engine === undefined) {
      throw new Error(`Invalid launch catalog payload: ${voice.id} references a missing engine.`);
    }
    const languages = unique(voice.languageTags.map(deriveLanguageName));
    const regions = unique(voice.languageTags.map(deriveRegionFromLocale));
    return {
      id: voice.id,
      name: voice.displayName,
      engineId: voice.engineId,
      engineName: engine.displayName,
      locale: voice.locale,
      languageTags: [...voice.languageTags],
      languages,
      language: deriveLanguageName(voice.locale),
      region: deriveRegionFromLocale(voice.locale),
      regions,
      gender: voice.gender,
      styles: [...voice.styleTags],
      licenseIds: [...voice.licenseIds],
      sourceIds: [...voice.sourceIds],
      runtimeModes: [...voice.runtimeModes] as RuntimeMode[],
      sample: null,
      backend: voice.backend,
      releaseGate: { ...voice.releaseGate },
      assetSetId: voice.assetSetId,
      declaredDownloadBytes: voice.declaredDownloadBytes,
      consentRequired: voice.consentRequired,
    };
  });

  return {
    kind: 'launch',
    catalogId: launch.catalogId,
    voices,
    engines: launch.engines.map((engine) => ({
      id: engine.id,
      name: engine.displayName,
      classification: engine.classification,
      runtimeModes: [...engine.runtimeModes] as RuntimeMode[],
      languageTags: [...engine.languageTags],
      licenseIds: [...engine.licenseIds],
      sourceIds: [...engine.sourceIds],
      backend: engine.backend,
      releaseGate: { ...engine.releaseGate },
      assetSetIds: [...engine.assetSetIds],
    })),
    licenses: new Map(
      launch.licenses.map((record) => [
        record.id,
        {
          id: record.id,
          name: record.name,
          scope: record.scope,
          url: record.evidenceUrl,
          attribution: record.attribution,
          redistribution: record.permitsRedistribution,
          commercialUse: record.permitsCommercialUse,
          terms: record.exactUpstreamTerms ?? null,
          reviewStatus: record.reviewStatus,
          ...(record.spdxId === undefined ? {} : { spdxId: record.spdxId }),
        },
      ]),
    ),
    sources: new Map(
      launch.sources.map((record) => [
        record.id,
        {
          id: record.id,
          url: record.canonicalUrl,
          sourceClass: record.sourceClass,
          lastVerifiedAt: record.lastVerifiedAt,
          health: record.health,
          revision: record.upstreamRevision,
          ...(record.contentHash === undefined ? {} : { contentHash: record.contentHash }),
        },
      ]),
    ),
    generatedAt: launch.generatedAt,
    assetSets: launch.assetSets.map((assetSet) => structuredClone(assetSet)),
    runtimeArtifacts: launch.runtimeArtifacts.map((artifact) => structuredClone(artifact)),
    runtimeSelections: launch.runtimeSelections.map((selection) => structuredClone(selection)),
    assetDeliveryEvidence: launch.assetDeliveryEvidence.map((record) => structuredClone(record)),
    releaseAssetEvidence: launch.releaseAssetEvidence.map((record) => structuredClone(record)),
    featureFlags: launch.featureFlags.map((record) => structuredClone(record)),
    galleries: launch.galleries.map((record) => structuredClone(record)),
    officialSamples: launch.samples.map((record) => structuredClone(record)),
    generationCandidates: launch.generationCandidates.map((record) => structuredClone(record)),
    generatedMedia: launch.generatedMedia.map((record) => structuredClone(record)),
    pocketCoverage: structuredClone(launch.pocketCoverage),
  };
}

export const launchCatalogUrl = new URL(
  '../../../../packages/catalog/data/launch-catalog.public.json',
  import.meta.url,
).href;

function isContentAddressedLaunchCatalog(url: string): boolean {
  try {
    const pathname = new URL(url, 'https://open-voice.invalid').pathname;
    return /^\/assets\/launch-catalog\.public-[A-Za-z0-9_-]{6,}\.json$/.test(pathname);
  } catch {
    return false;
  }
}

async function cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Cancellation is best effort; the original validation failure is authoritative.
  }
}

async function readExactCatalogBytes(response: Response): Promise<Uint8Array> {
  const expectedBytes = catalogIntegrity.bytes;
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes) {
      await cancelResponseBody(response, 'Unexpected launch catalog Content-Length.');
      throw new Error(
        `Launch catalog requires exactly ${expectedBytes} bytes; Content-Length was ${declaredLength}.`,
      );
    }
  }

  if (response.body === null) {
    throw new Error('Launch catalog response has no readable body.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : null;
      if (bytes === null) {
        throw new Error('Launch catalog stream produced a non-byte chunk.');
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > expectedBytes) {
        await reader.cancel('Launch catalog exceeded its exact byte limit.');
        throw new Error(
          `Launch catalog requires exactly ${expectedBytes} bytes; the stream overflowed.`,
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the read or validation error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== expectedBytes) {
    throw new Error(
      `Launch catalog requires exactly ${expectedBytes} bytes; received ${totalBytes}.`,
    );
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseCatalogResponse(response: Response, url: string): Promise<SeedCatalog> {
  if (!response.ok) {
    throw new Error(`Launch catalog request failed with HTTP ${response.status}.`);
  }
  const baseUrl = globalThis.location?.href ?? 'https://open-voice.invalid/';
  if (
    response.redirected ||
    (response.url !== '' && new URL(response.url, baseUrl).href !== new URL(url, baseUrl).href)
  ) {
    throw new Error('Launch catalog response URL did not match the exact requested asset URL.');
  }
  if (!STRICT_JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Launch catalog response must use an application/json content type.');
  }
  try {
    const bytes = await readExactCatalogBytes(response);
    const digestInput = Uint8Array.from(bytes).buffer;
    const actualDigest = `sha256:${[
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput)),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
    if (actualDigest !== catalogIntegrity.sha256) {
      throw new Error(
        `Exact catalog integrity mismatch: expected ${catalogIntegrity.sha256}, received ${actualDigest}.`,
      );
    }
    return mapLaunchCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch (error) {
    throw new Error(
      `Launch catalog at ${url} failed exact-byte integrity, schema, or count validation.`,
      {
        cause: error,
      },
    );
  }
}

async function versionedCatalogCaches(url: string): Promise<Cache[]> {
  if (!isContentAddressedLaunchCatalog(url) || typeof globalThis.caches === 'undefined') {
    return [];
  }
  try {
    const names = (await globalThis.caches.keys())
      .filter((name) => name.startsWith(LAUNCH_CATALOG_CACHE_PREFIX))
      .sort((left, right) => right.localeCompare(left, 'en'));
    return await Promise.all(names.map((name) => globalThis.caches.open(name)));
  } catch {
    return [];
  }
}

async function loadLaunchCatalogFromUrl(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<SeedCatalog> {
  const caches = await versionedCatalogCaches(url);
  let networkError: unknown;
  try {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit' });
    return await parseCatalogResponse(response, url);
  } catch (error) {
    networkError = error;
  }

  for (const cache of caches) {
    try {
      const cached = await cache.match(url);
      if (cached !== undefined) {
        return await parseCatalogResponse(cached, url);
      }
    } catch {
      await cache.delete(url).catch(() => false);
    }
  }
  throw networkError;
}

/** Production entry point: the bundler owns the one immutable catalog URL. */
export async function loadLaunchCatalog(
  fetcher: typeof fetch = globalThis.fetch,
  ...forbiddenCustomUrl: never[]
): Promise<SeedCatalog> {
  if (forbiddenCustomUrl.length !== 0) {
    throw new Error('Production launch catalog loading is fixed to the built immutable URL.');
  }
  return loadLaunchCatalogFromUrl(launchCatalogUrl, fetcher);
}

/** Explicit fixture seam that cannot be reached through the production boot API. */
export function createTestOnlyLaunchCatalogLoader(
  url: string,
): (fetcher?: typeof fetch) => Promise<SeedCatalog> {
  return (fetcher = globalThis.fetch) => loadLaunchCatalogFromUrl(url, fetcher);
}
