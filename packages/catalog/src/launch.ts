import { createHash } from 'node:crypto';

import {
  AssetDeliveryEvidenceSchema,
  AssetSetManifestSchema,
  FeatureFlagSchema,
  GalleryManifestSchema,
  GeneratedMediaProvenanceSchema,
  GenerationCandidateSchema,
  LaunchEngineManifestSchema,
  LaunchVoicePresetSchema,
  LicenseRecordSchema,
  OfficialSampleSchema,
  PinnedReleaseAssetEvidenceSchema,
  SourceRecordSchema,
  type AssetSetManifest,
  type AssetDeliveryEvidence,
  type FeatureFlag,
  type GalleryManifest,
  type GeneratedMediaProvenance,
  type GenerationCandidate,
  type ImmutableAsset,
  type LaunchEngineManifest,
  type LaunchVoicePreset,
  type LicenseRecord,
  type OfficialSample,
  type PinnedReleaseAssetEvidence,
  type RuntimeMode,
  type SourceRecord,
} from '@open-voice/contracts';
import { z } from 'zod';

import type { PinnedAssetSource } from './launch-asset-types.js';
import { KITTEN_ASSETS, SUPERTONIC_ASSETS } from './launch-assets-browser.js';
import { KOKORO_ASSETS } from './launch-assets-kokoro.js';
import { POCKET_ASSETS } from './launch-assets-pocket.js';
import { EDGE_VOICE_SNAPSHOT } from './launch-data.js';
import {
  ALL_LAUNCH_LICENSES,
  GALLERIES,
  GENERATION_CANDIDATES,
  LAUNCH_SOURCES,
} from './launch-evidence.js';
import { PIPER_RELEASE_ASSET_EVIDENCE } from './launch-piper-evidence.js';

const GENERATED_AT = '2026-07-16T00:00:00.000Z';

export const LaunchCatalogManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogId: z.literal('open-voice-launch'),
    generatedAt: z.string().datetime({ offset: true }),
    engines: z.array(LaunchEngineManifestSchema).min(1),
    voices: z.array(LaunchVoicePresetSchema).min(1),
    samples: z.array(OfficialSampleSchema),
    licenses: z.array(LicenseRecordSchema).min(1),
    sources: z.array(SourceRecordSchema).min(1),
    assetSets: z.array(AssetSetManifestSchema).min(1),
    assetDeliveryEvidence: z.array(AssetDeliveryEvidenceSchema),
    releaseAssetEvidence: z.array(PinnedReleaseAssetEvidenceSchema),
    featureFlags: z.array(FeatureFlagSchema),
    galleries: z.array(GalleryManifestSchema),
    generationCandidates: z.array(GenerationCandidateSchema),
    generatedMedia: z.array(GeneratedMediaProvenanceSchema),
  })
  .strict();

export type LaunchCatalogManifest = {
  schemaVersion: 2;
  catalogId: 'open-voice-launch';
  generatedAt: string;
  engines: LaunchEngineManifest[];
  voices: LaunchVoicePreset[];
  samples: OfficialSample[];
  licenses: LicenseRecord[];
  sources: SourceRecord[];
  assetSets: AssetSetManifest[];
  assetDeliveryEvidence: AssetDeliveryEvidence[];
  releaseAssetEvidence: PinnedReleaseAssetEvidence[];
  featureFlags: FeatureFlag[];
  galleries: GalleryManifest[];
  generationCandidates: GenerationCandidate[];
  generatedMedia: GeneratedMediaProvenance[];
};

export type LaunchCatalogCounts = {
  totalVoices: number;
  byEngine: Record<string, number>;
  declaredByRuntime: Record<RuntimeMode, number>;
  enabledByRuntime: Record<RuntimeMode, number>;
  enabledVoices: number;
  unavailableVoices: number;
};

export class LaunchCatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchCatalogValidationError';
  }
}

export function computeEdgeSnapshotContentHash(): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(EDGE_VOICE_SNAPSHOT)).digest('hex')}`;
}

const ENABLED_GATE = {
  status: 'enabled',
  reason: null,
  detail: 'Reviewed preset and immutable asset evidence are present for this declared runtime.',
} as const;
const EDGE_GATE = {
  status: 'unavailable',
  reason: 'terms-not-cleared',
  detail:
    'Metadata only. The unsupported consumer-service path is not called, proxied, or bundled.',
} as const;
const PIPER_GATE = {
  status: 'unavailable',
  reason: 'asset-unavailable',
  detail:
    'Official release-asset evidence is recorded, but GitHub serves the archives without cross-origin browser access. No rights-reviewed, commit-pinned CORS mirror exists.',
} as const;
const PIPER_DIMITAR_GATE = {
  status: 'unavailable',
  reason: 'asset-unavailable',
  detail:
    'No reviewed immutable browser asset has been located for this preset. No request is made.',
} as const;

// This is an explicit transcription of the language and Female/Male groupings
// in the pinned upstream VOICES.md. Runtime metadata never parses the ID.
const KOKORO_PRESETS = [
  ...[
    'af_alloy',
    'af_aoede',
    'af_bella',
    'af_heart',
    'af_jessica',
    'af_kore',
    'af_nicole',
    'af_nova',
    'af_river',
    'af_sarah',
    'af_sky',
  ].map((id) => ({ id, locale: 'en-US', gender: 'female' as const })),
  ...[
    'am_adam',
    'am_echo',
    'am_eric',
    'am_fenrir',
    'am_liam',
    'am_michael',
    'am_onyx',
    'am_puck',
    'am_santa',
  ].map((id) => ({ id, locale: 'en-US', gender: 'male' as const })),
  ...['bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily'].map((id) => ({
    id,
    locale: 'en-GB',
    gender: 'female' as const,
  })),
  ...['bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'].map((id) => ({
    id,
    locale: 'en-GB',
    gender: 'male' as const,
  })),
  { id: 'ef_dora', locale: 'es-ES', gender: 'female' as const },
  ...['em_alex', 'em_santa'].map((id) => ({ id, locale: 'es-ES', gender: 'male' as const })),
  { id: 'ff_siwis', locale: 'fr-FR', gender: 'female' as const },
  ...['hf_alpha', 'hf_beta'].map((id) => ({ id, locale: 'hi-IN', gender: 'female' as const })),
  ...['hm_omega', 'hm_psi'].map((id) => ({ id, locale: 'hi-IN', gender: 'male' as const })),
  { id: 'if_sara', locale: 'it-IT', gender: 'female' as const },
  { id: 'im_nicola', locale: 'it-IT', gender: 'male' as const },
  ...['jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro'].map((id) => ({
    id,
    locale: 'ja-JP',
    gender: 'female' as const,
  })),
  { id: 'jm_kumo', locale: 'ja-JP', gender: 'male' as const },
  { id: 'pf_dora', locale: 'pt-BR', gender: 'female' as const },
  ...['pm_alex', 'pm_santa'].map((id) => ({ id, locale: 'pt-BR', gender: 'male' as const })),
  ...['zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi'].map((id) => ({
    id,
    locale: 'zh-CN',
    gender: 'female' as const,
  })),
  ...['zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang'].map((id) => ({
    id,
    locale: 'zh-CN',
    gender: 'male' as const,
  })),
] as const;
const KOKORO_IDS = KOKORO_PRESETS.map(({ id }) => id);

const POCKET_IDS = [
  'alba',
  'estelle',
  'anna',
  'vera',
  'fantine',
  'charles',
  'paul',
  'eponine',
  'azelma',
  'george',
  'mary',
  'jane',
  'michael',
  'eve',
  'bill_boerst',
  'caro_davy',
  'peter_yearsley',
  'stuart_bell',
  'marius',
  'javert',
] as const;
const KITTEN_IDS = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'] as const;
const SUPERTONIC_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
const SUPERTONIC_LANGUAGES = [
  'ar',
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'de',
  'el',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lv',
  'lt',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'es',
  'sv',
  'tr',
  'uk',
  'vi',
] as const;
const PIPER_IDS = [
  'bg_BG-dimitar-medium',
  'de_DE-thorsten-medium',
  'es_ES-davefx-medium',
  'nl_NL-alex-medium',
  'pl_PL-gosia-medium',
  'pt_BR-cadu-medium',
  'ro_RO-mihai-medium',
  'ru_RU-dmitri-medium',
  'zh_CN-chaowen-medium',
  'en_GB-cori-medium',
  'fr_FR-siwis-medium',
  'uk_UA-lada-x_low',
] as const;

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id, 'en');
}

function slug(value: string): string {
  return value
    .replaceAll('_', '-')
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .toLowerCase();
}

function title(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function toAsset(engineId: string, asset: PinnedAssetSource): ImmutableAsset {
  return {
    id: asset.id,
    url: asset.url,
    revision: asset.revision,
    sha256: asset.sha256,
    bytes: asset.bytes,
    cacheKey: `${engineId}/${asset.id}/${asset.revision}/${asset.sha256.slice('sha256:'.length)}`,
    mediaType: asset.mediaType,
    sourceIds: [asset.sourceId],
    licenseIds: [asset.licenseId],
    requiredAcceptance: asset.requiredAcceptance,
  };
}

function assetSet(
  id: string,
  engineId: string,
  sourceAssets: PinnedAssetSource[],
  requiredAcceptanceLicenseIds: string[] = [],
): AssetSetManifest {
  const assets = sourceAssets.map((asset) => toAsset(engineId, asset));
  const manifestDigest = `sha256:${createHash('sha256')
    .update(JSON.stringify(assets))
    .digest('hex')}` as const;
  return {
    id,
    engineId,
    manifestDigest,
    assets,
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    requiredAcceptanceLicenseIds,
    releaseGate: ENABLED_GATE,
  };
}

function buildAssetSets(): AssetSetManifest[] {
  const kokoroModel = KOKORO_ASSETS.find((asset) => asset.path === 'onnx/model_q8f16.onnx');
  if (kokoroModel === undefined) {
    throw new LaunchCatalogValidationError('Kokoro base model asset is missing');
  }
  const kokoroSets = KOKORO_IDS.map((voiceId) => {
    const voiceAssetSource = KOKORO_ASSETS.find((asset) => asset.path === `voices/${voiceId}.bin`);
    if (voiceAssetSource === undefined) {
      throw new LaunchCatalogValidationError(`Kokoro asset is missing: ${voiceId}`);
    }
    const voiceAsset = { ...voiceAssetSource, licenseId: kokoroDatasetLicense(voiceId) };
    return assetSet(`kokoro-${slug(voiceId)}`, 'kokoro', [kokoroModel, voiceAsset]);
  });
  const pocketAssets = POCKET_ASSETS.map((asset) => {
    const match = asset.path.match(/(?:embeddings|embeddings_v3)\/([^/]+)\.safetensors$/);
    return match === null ? asset : { ...asset, licenseId: pocketDatasetLicense(match[1]!) };
  });
  return [
    ...kokoroSets,
    assetSet('kitten-browser-assets', 'kitten', KITTEN_ASSETS),
    assetSet('pocket-companion-pack', 'pocket', pocketAssets),
    assetSet('supertonic-browser-assets', 'supertonic', SUPERTONIC_ASSETS, [
      'supertone-weights-license',
    ]),
  ].sort(compareId);
}

const DELIVERY_REQUEST = {
  method: 'GET',
  rangeHeader: 'bytes=0-0',
  mode: 'cors',
  credentials: 'omit',
  redirect: 'follow',
  cache: 'no-store',
} as const;

function buildAssetDeliveryEvidence(
  assetSets: readonly AssetSetManifest[],
): AssetDeliveryEvidence[] {
  const checkedAt = '2026-07-16T00:15:33.037Z';
  const browser = 'Chromium 149.0.7827.55';
  const origin = 'https://example.com';
  const detail =
    'Only the named representative revision-pinned assets were checked with readable CORS responses. Runtime enablement still requires every required asset and redirect to pass.';
  const evidence = (
    engineId: string,
    observations: AssetDeliveryEvidence['observations'],
  ): AssetDeliveryEvidence => ({
    id: `${engineId}-representative-browser-delivery-2026-07-16`,
    engineId,
    assetSetIds: assetSets.filter((assetSet) => assetSet.engineId === engineId).map(({ id }) => id),
    checkedAssetIds: observations.map(({ assetId }) => assetId),
    scope: 'representative-assets',
    result: 'representative-pass',
    checkedAt,
    browser,
    origin,
    request: DELIVERY_REQUEST,
    observations,
    detail,
  });

  return [
    evidence('kokoro', [
      {
        assetId: 'onnx-model-q8f16-onnx',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/86033585',
      },
      {
        assetId: 'voices-af-heart-bin',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/522240',
      },
    ]),
    evidence('kitten', [
      {
        assetId: 'kitten-tts-micro-v0-8-onnx',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/41384970',
      },
      {
        assetId: 'voices-npz',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/3278902',
      },
    ]),
    evidence('supertonic', [
      {
        assetId: 'onnx-vector-estimator-onnx',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/256534781',
      },
      {
        assetId: 'config-json',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/174',
      },
      {
        assetId: 'voice-styles-f1-json',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/292046',
      },
    ]),
    evidence('pocket', [
      {
        assetId: 'tts-b6369a24-safetensors',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/235738732',
      },
      {
        assetId: 'embeddings-v3-alba-safetensors',
        responseType: 'cors',
        status: 206,
        bytesRead: 1,
        contentRange: 'bytes 0-0/6145272',
      },
    ]),
  ];
}

function assetBytes(assetSets: readonly AssetSetManifest[], assetSetId: string | null): number {
  if (assetSetId === null) {
    return 0;
  }
  const found = assetSets.find((set) => set.id === assetSetId);
  if (found === undefined) {
    throw new LaunchCatalogValidationError(`Missing generated asset set: ${assetSetId}`);
  }
  return found.totalBytes;
}

const KOKORO_KONIWA_IDS = new Set(['jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo']);

function kokoroDatasetLicense(id: string): string {
  if (KOKORO_KONIWA_IDS.has(id)) return 'kokoro-koniwa-dataset-license';
  if (id === 'ff_siwis') return 'kokoro-siwis-dataset-license';
  return 'kokoro-voice-license';
}

function kokoroSourceIds(id: string): string[] {
  return [
    'kokoro-model-source',
    'kokoro-voice-metadata-source',
    ...(KOKORO_KONIWA_IDS.has(id) ? ['kokoro-koniwa-source'] : []),
    ...(id === 'ff_siwis' ? ['kokoro-siwis-source'] : []),
  ];
}

const POCKET_VCTK_IDS = new Set([
  'anna',
  'vera',
  'fantine',
  'charles',
  'paul',
  'eponine',
  'azelma',
  'george',
  'mary',
  'jane',
  'michael',
  'eve',
]);
const POCKET_VOICE_ZERO_IDS = new Set([
  'bill_boerst',
  'caro_davy',
  'peter_yearsley',
  'stuart_bell',
]);

function pocketDatasetLicense(id: string): string {
  if (id === 'alba') return 'pocket-alba-mackenna-dataset-license';
  if (id === 'estelle') return 'pocket-unmute-prod-dataset-license';
  if (POCKET_VCTK_IDS.has(id)) return 'pocket-vctk-dataset-license';
  if (POCKET_VOICE_ZERO_IDS.has(id)) return 'pocket-voice-zero-dataset-license';
  return 'pocket-donations-dataset-license';
}

function buildVoices(assetSets: readonly AssetSetManifest[]): LaunchVoicePreset[] {
  const edge: LaunchVoicePreset[] = EDGE_VOICE_SNAPSHOT.map((voice) => ({
    id: `edge:${voice.upstreamId}`,
    engineId: 'edge',
    upstreamId: voice.upstreamId,
    displayName: voice.upstreamId,
    locale: voice.locale,
    languageTags: [voice.locale],
    gender: voice.gender,
    runtimeModes: ['online'],
    styleTags: voice.styles,
    licenseIds: ['edge-service-terms'],
    sourceIds: ['edge-voices-snapshot'],
    backend: 'external-service',
    releaseGate: EDGE_GATE,
    assetSetId: null,
    declaredDownloadBytes: 0,
    consentRequired: false,
  }));

  const kokoro: LaunchVoicePreset[] = KOKORO_PRESETS.map((metadata) => {
    const upstreamId = metadata.id;
    const assetSetId = `kokoro-${slug(upstreamId)}`;
    return {
      id: `kokoro:${upstreamId}`,
      engineId: 'kokoro',
      upstreamId,
      displayName: title(upstreamId.slice(3)),
      locale: metadata.locale,
      languageTags: [metadata.locale],
      gender: metadata.gender,
      runtimeModes: ['browser'],
      styleTags: [],
      licenseIds: [kokoroDatasetLicense(upstreamId)],
      sourceIds: kokoroSourceIds(upstreamId),
      backend: 'webgpu-wasm',
      releaseGate: ENABLED_GATE,
      assetSetId,
      declaredDownloadBytes: assetBytes(assetSets, assetSetId),
      consentRequired: true,
    };
  });

  const pocketAssetSetId = 'pocket-companion-pack';
  const pocket: LaunchVoicePreset[] = POCKET_IDS.map((upstreamId) => ({
    id: `pocket:${upstreamId}`,
    engineId: 'pocket',
    upstreamId,
    displayName: title(upstreamId),
    locale: upstreamId === 'estelle' ? 'fr' : 'en',
    languageTags: [upstreamId === 'estelle' ? 'fr' : 'en'],
    gender: 'unspecified',
    runtimeModes: ['companion'],
    styleTags: [],
    licenseIds: [pocketDatasetLicense(upstreamId)],
    sourceIds: ['pocket-code-source', 'pocket-voice-source', 'pocket-weights-source'],
    backend: 'companion',
    releaseGate: ENABLED_GATE,
    assetSetId: pocketAssetSetId,
    declaredDownloadBytes: assetBytes(assetSets, pocketAssetSetId),
    consentRequired: true,
  }));

  const kittenAssetSetId = 'kitten-browser-assets';
  const kitten: LaunchVoicePreset[] = KITTEN_IDS.map((publishedId) => {
    const upstreamId = publishedId;
    return {
      id: `kitten:${upstreamId}`,
      engineId: 'kitten',
      upstreamId,
      displayName: publishedId,
      locale: 'en',
      languageTags: ['en'],
      gender: 'unspecified',
      runtimeModes: ['browser'],
      styleTags: [],
      licenseIds: ['kitten-voice-license'],
      sourceIds: ['kitten-model-source'],
      backend: 'wasm',
      releaseGate: ENABLED_GATE,
      assetSetId: kittenAssetSetId,
      declaredDownloadBytes: assetBytes(assetSets, kittenAssetSetId),
      consentRequired: true,
    };
  });

  const supertoneAssetSetId = 'supertonic-browser-assets';
  const supertonic: LaunchVoicePreset[] = SUPERTONIC_IDS.map((upstreamId) => ({
    id: `supertonic:${upstreamId}`,
    engineId: 'supertonic',
    upstreamId,
    displayName: upstreamId,
    locale: 'en',
    languageTags: [...SUPERTONIC_LANGUAGES],
    gender: upstreamId.startsWith('F') ? 'female' : 'male',
    runtimeModes: ['browser'],
    styleTags: [],
    licenseIds: ['supertone-voice-license'],
    sourceIds: ['supertone-model-source', 'supertone-preset-metadata-source'],
    backend: 'webgpu-wasm',
    releaseGate: ENABLED_GATE,
    assetSetId: supertoneAssetSetId,
    declaredDownloadBytes: assetBytes(assetSets, supertoneAssetSetId),
    consentRequired: true,
  }));

  const piper: LaunchVoicePreset[] = PIPER_IDS.map((upstreamId) => {
    return {
      id: `piper:${upstreamId}`,
      engineId: 'piper',
      upstreamId,
      displayName: upstreamId,
      locale: upstreamId.slice(0, 5).replace('_', '-'),
      languageTags: [upstreamId.slice(0, 5).replace('_', '-')],
      gender: 'unspecified',
      runtimeModes: ['browser'],
      styleTags: [],
      licenseIds: ['piper-voice-license'],
      sourceIds: ['piper-voices-source', 'piper-sherpa-source'],
      backend: 'wasm',
      releaseGate: upstreamId === 'bg_BG-dimitar-medium' ? PIPER_DIMITAR_GATE : PIPER_GATE,
      assetSetId: null,
      declaredDownloadBytes: 0,
      consentRequired: false,
    };
  });

  return [...edge, ...kokoro, ...pocket, ...kitten, ...supertonic, ...piper].sort(compareId);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function buildEngines(
  voices: readonly LaunchVoicePreset[],
  assetSets: readonly AssetSetManifest[],
): LaunchEngineManifest[] {
  const languageTags = (engineId: string) =>
    uniqueSorted(
      voices.filter((voice) => voice.engineId === engineId).flatMap((voice) => voice.languageTags),
    );
  const assetSetIds = (engineId: string) =>
    assetSets.filter((set) => set.engineId === engineId).map((set) => set.id);
  return [
    {
      id: 'edge',
      displayName: 'Edge voice metadata',
      classification: 'open-source-client-external-service',
      runtimeModes: ['online'],
      languageTags: languageTags('edge'),
      licenseIds: ['edge-code-license', 'edge-service-terms'],
      sourceIds: ['edge-client-source', 'edge-voices-snapshot'],
      backend: 'external-service',
      releaseGate: EDGE_GATE,
      assetSetIds: [],
    },
    {
      id: 'kitten',
      displayName: 'KittenTTS Micro 0.8',
      classification: 'open-weight-local',
      runtimeModes: ['browser'],
      languageTags: languageTags('kitten'),
      licenseIds: ['kitten-code-license', 'kitten-weights-license'],
      sourceIds: ['kitten-code-source', 'kitten-model-source'],
      backend: 'wasm',
      releaseGate: ENABLED_GATE,
      assetSetIds: assetSetIds('kitten'),
    },
    {
      id: 'kokoro',
      displayName: 'Kokoro 82M',
      classification: 'open-weight-local',
      runtimeModes: ['browser'],
      languageTags: languageTags('kokoro'),
      licenseIds: ['kokoro-code-license', 'kokoro-weights-license'],
      sourceIds: [
        'kokoro-code-source',
        'kokoro-model-source',
        'kokoro-onnx-source',
        'kokoro-voice-metadata-source',
        'kokoro-koniwa-source',
        'kokoro-siwis-source',
      ],
      backend: 'webgpu-wasm',
      releaseGate: ENABLED_GATE,
      assetSetIds: assetSetIds('kokoro'),
    },
    {
      id: 'piper',
      displayName: 'Piper via sherpa-onnx',
      classification: 'open-weight-local',
      runtimeModes: ['browser'],
      languageTags: languageTags('piper'),
      licenseIds: ['piper-code-license', 'piper-weights-license'],
      sourceIds: ['piper-voices-source', 'piper-sherpa-source'],
      backend: 'wasm',
      releaseGate: PIPER_GATE,
      assetSetIds: assetSetIds('piper'),
    },
    {
      id: 'pocket',
      displayName: 'Pocket TTS preset pack',
      classification: 'open-weight-local',
      runtimeModes: ['companion'],
      languageTags: languageTags('pocket'),
      licenseIds: ['pocket-code-license', 'pocket-weights-license'],
      sourceIds: ['pocket-code-source', 'pocket-voice-source', 'pocket-weights-source'],
      backend: 'companion',
      releaseGate: ENABLED_GATE,
      assetSetIds: assetSetIds('pocket'),
    },
    {
      id: 'supertonic',
      displayName: 'Supertonic 3',
      classification: 'open-weight-local',
      runtimeModes: ['browser'],
      languageTags: languageTags('supertonic'),
      licenseIds: ['supertone-code-license', 'supertone-weights-license'],
      sourceIds: [
        'supertone-code-source',
        'supertone-model-source',
        'supertone-preset-metadata-source',
      ],
      backend: 'webgpu-wasm',
      releaseGate: ENABLED_GATE,
      assetSetIds: assetSetIds('supertonic'),
    },
  ].sort(compareId) as LaunchEngineManifest[];
}

export function buildLaunchCatalog(): LaunchCatalogManifest {
  const assetSets = buildAssetSets();
  const voices = buildVoices(assetSets);
  const engines = buildEngines(voices, assetSets);
  return {
    schemaVersion: 2,
    catalogId: 'open-voice-launch',
    generatedAt: GENERATED_AT,
    engines,
    voices,
    samples: [],
    licenses: [...ALL_LAUNCH_LICENSES].sort(compareId),
    sources: LAUNCH_SOURCES.map((record) =>
      record.id === 'edge-voices-snapshot'
        ? { ...record, contentHash: computeEdgeSnapshotContentHash() }
        : record,
    ).sort(compareId),
    assetSets,
    assetDeliveryEvidence: buildAssetDeliveryEvidence(assetSets),
    releaseAssetEvidence: [...PIPER_RELEASE_ASSET_EVIDENCE].sort(compareId),
    featureFlags: [
      {
        id: 'future-azure-inference',
        enabled: false,
        serverOnlyCredentials: true,
        termsCleared: false,
        monthlyBudgetUsd: 0,
        hardStop: true,
        characterLimit: 0,
        spendLimitUsd: 0,
      },
    ],
    galleries: [...GALLERIES].sort(compareId),
    generationCandidates: [...GENERATION_CANDIDATES].sort(compareId),
    generatedMedia: [],
  };
}

export function countLaunchCatalog(catalog: LaunchCatalogManifest): LaunchCatalogCounts {
  const declaredByRuntime: Record<RuntimeMode, number> = {
    browser: 0,
    online: 0,
    companion: 0,
    'sample-only': 0,
  };
  const enabledByRuntime: Record<RuntimeMode, number> = {
    browser: 0,
    online: 0,
    companion: 0,
    'sample-only': 0,
  };
  const byEngine: Record<string, number> = {};
  let enabledVoices = 0;
  for (const voice of catalog.voices) {
    byEngine[voice.engineId] = (byEngine[voice.engineId] ?? 0) + 1;
    for (const mode of voice.runtimeModes) {
      declaredByRuntime[mode] += 1;
      if (voice.releaseGate.status === 'enabled') {
        enabledByRuntime[mode] += 1;
      }
    }
    if (voice.releaseGate.status === 'enabled') {
      enabledVoices += 1;
    }
  }
  return {
    totalVoices: catalog.voices.length,
    byEngine: Object.fromEntries(
      Object.entries(byEngine).sort(([left], [right]) => left.localeCompare(right, 'en')),
    ),
    declaredByRuntime,
    enabledByRuntime,
    enabledVoices,
    unavailableVoices: catalog.voices.length - enabledVoices,
  };
}

function requireUnique(records: ReadonlyArray<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new LaunchCatalogValidationError(`Duplicate ${label} ID: ${record.id}`);
    }
    seen.add(record.id);
  }
}

function requireReferences(
  owner: string,
  references: readonly string[],
  available: ReadonlySet<string>,
  kind: string,
): void {
  for (const reference of references) {
    if (!available.has(reference)) {
      throw new LaunchCatalogValidationError(`${owner} references missing ${kind}: ${reference}`);
    }
  }
}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

function requireExactRecordSet<T extends { id: string }>(
  actual: readonly T[],
  expected: readonly T[],
  label: string,
  project: (record: T) => unknown = (record) => record,
): void {
  const actualById = new Map(actual.map((record) => [record.id, record]));
  const expectedById = new Map(expected.map((record) => [record.id, record]));
  if (
    actualById.size !== expectedById.size ||
    [...expectedById.keys()].some((id) => !actualById.has(id))
  ) {
    throw new LaunchCatalogValidationError(`Exact ${label} ID set drifted`);
  }
  for (const [id, expectedRecord] of expectedById) {
    const actualRecord = actualById.get(id)!;
    if (JSON.stringify(project(actualRecord)) !== JSON.stringify(project(expectedRecord))) {
      throw new LaunchCatalogValidationError(`Canonical ${label} record drifted: ${id}`);
    }
  }
}

function canonicalTranscriptSha256(transcript: string): `sha256:${string}` {
  // Canonical transcript bytes are the exact UTF-8 bytes of the stored candidate
  // prompt. Schema parsing does not trim or normalize whitespace or newlines.
  return `sha256:${createHash('sha256').update(Buffer.from(transcript, 'utf8')).digest('hex')}`;
}

export function validateLaunchCatalogForRelease(input: unknown): {
  manifest: LaunchCatalogManifest;
  counts: LaunchCatalogCounts;
} {
  const parsed = LaunchCatalogManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new LaunchCatalogValidationError(`Launch catalog schema failed: ${issues(parsed.error)}`);
  }
  const manifest = parsed.data as LaunchCatalogManifest;
  for (const [records, label] of [
    [manifest.engines, 'engine'],
    [manifest.voices, 'voice'],
    [manifest.licenses, 'license'],
    [manifest.sources, 'source'],
    [manifest.assetSets, 'asset set'],
    [manifest.assetDeliveryEvidence, 'asset delivery evidence'],
    [manifest.releaseAssetEvidence, 'release asset evidence'],
    [manifest.featureFlags, 'feature flag'],
    [manifest.galleries, 'gallery'],
    [manifest.samples, 'official sample'],
    [manifest.generationCandidates, 'generation candidate'],
    [manifest.generatedMedia, 'generated media'],
  ] as const) {
    requireUnique(records, label);
  }
  const engineIds = new Set(manifest.engines.map(({ id }) => id));
  const licenseIds = new Set(manifest.licenses.map(({ id }) => id));
  const sourceIds = new Set(manifest.sources.map(({ id }) => id));
  const assetSetIds = new Set(manifest.assetSets.map(({ id }) => id));
  const candidateIds = new Set(manifest.generationCandidates.map(({ id }) => id));
  const sampleIds = new Set(manifest.samples.map(({ id }) => id));
  const generatedMediaIds = new Set(manifest.generatedMedia.map(({ id }) => id));
  const licensesById = new Map(manifest.licenses.map((license) => [license.id, license]));
  const enginesById = new Map(manifest.engines.map((engine) => [engine.id, engine]));
  const assetSetsById = new Map(manifest.assetSets.map((assetSet) => [assetSet.id, assetSet]));

  const requireReviewedForEnabledUse = (owner: string, references: readonly string[]): void => {
    for (const licenseId of references) {
      if (licensesById.get(licenseId)?.reviewStatus === 'needs-review') {
        throw new LaunchCatalogValidationError(
          `${owner} cannot be enabled with needs-review license ${licenseId}`,
        );
      }
    }
  };

  for (const engine of manifest.engines) {
    requireReferences(`Engine ${engine.id}`, engine.licenseIds, licenseIds, 'license');
    requireReferences(`Engine ${engine.id}`, engine.sourceIds, sourceIds, 'source');
    requireReferences(`Engine ${engine.id}`, engine.assetSetIds, assetSetIds, 'asset set');
    if (engine.releaseGate.status === 'enabled') {
      requireReviewedForEnabledUse(`Engine ${engine.id}`, engine.licenseIds);
    }
    for (const assetSetId of engine.assetSetIds) {
      if (assetSetsById.get(assetSetId)?.engineId !== engine.id) {
        throw new LaunchCatalogValidationError(
          `Engine ${engine.id} lists cross-engine asset set ${assetSetId}`,
        );
      }
    }
  }
  for (const voice of manifest.voices) {
    if (!engineIds.has(voice.engineId)) {
      throw new LaunchCatalogValidationError(`Voice ${voice.id} has no engine`);
    }
    requireReferences(`Voice ${voice.id}`, voice.licenseIds, licenseIds, 'license');
    requireReferences(`Voice ${voice.id}`, voice.sourceIds, sourceIds, 'source');
    if (voice.assetSetId !== null && !assetSetIds.has(voice.assetSetId)) {
      throw new LaunchCatalogValidationError(`Voice ${voice.id} has no asset set`);
    }
    if (!voice.id.startsWith(`${voice.engineId}:`)) {
      throw new LaunchCatalogValidationError(`Voice ${voice.id} has the wrong engine prefix`);
    }
    const engine = enginesById.get(voice.engineId)!;
    if (
      JSON.stringify(voice.runtimeModes) !== JSON.stringify(engine.runtimeModes) ||
      voice.backend !== engine.backend
    ) {
      throw new LaunchCatalogValidationError(
        `Voice ${voice.id} runtime mode or backend does not match its engine`,
      );
    }
    if (voice.releaseGate.status === 'enabled' && voice.assetSetId === null) {
      throw new LaunchCatalogValidationError(`Enabled voice ${voice.id} requires an asset set`);
    }
    if (voice.releaseGate.status === 'unavailable' && voice.declaredDownloadBytes !== 0) {
      throw new LaunchCatalogValidationError(
        `Unavailable voice ${voice.id} cannot claim download bytes`,
      );
    }
    if (voice.releaseGate.status === 'enabled') {
      requireReviewedForEnabledUse(`Voice ${voice.id}`, voice.licenseIds);
    }
    if (voice.assetSetId !== null) {
      const set = assetSetsById.get(voice.assetSetId)!;
      if (set.engineId !== voice.engineId || !engine.assetSetIds.includes(set.id)) {
        throw new LaunchCatalogValidationError(
          `Voice ${voice.id} references cross-engine or detached asset set ${set.id}`,
        );
      }
      if (voice.declaredDownloadBytes !== set.totalBytes) {
        throw new LaunchCatalogValidationError(
          `Voice ${voice.id} declared bytes do not match asset set ${set.id}`,
        );
      }
    }
  }
  const cacheIdentities = new Map<string, string>();
  for (const set of manifest.assetSets) {
    if (!engineIds.has(set.engineId)) {
      throw new LaunchCatalogValidationError(`Asset set ${set.id} has no engine`);
    }
    requireReferences(
      `Asset set ${set.id}`,
      set.requiredAcceptanceLicenseIds,
      licenseIds,
      'acceptance license',
    );
    const owner = enginesById.get(set.engineId)!;
    if (!owner.assetSetIds.includes(set.id)) {
      throw new LaunchCatalogValidationError(`Asset set ${set.id} is detached from its engine`);
    }
    if (!manifest.voices.some((voice) => voice.assetSetId === set.id)) {
      throw new LaunchCatalogValidationError(`Asset set ${set.id} is not used by a launch voice`);
    }
    if (set.releaseGate.status === 'enabled') {
      requireReviewedForEnabledUse(
        `Asset set ${set.id}`,
        set.assets.flatMap((asset) => asset.licenseIds),
      );
    }
    const expectedDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(set.assets))
      .digest('hex')}`;
    if (set.manifestDigest !== expectedDigest) {
      throw new LaunchCatalogValidationError(`Asset-set digest drift: ${set.id}`);
    }
    for (const asset of set.assets) {
      requireReferences(`Asset ${asset.id}`, asset.licenseIds, licenseIds, 'license');
      requireReferences(`Asset ${asset.id}`, asset.sourceIds, sourceIds, 'source');
      const fullCacheIdentity = `${asset.url}\0${asset.revision}\0${asset.sha256}\0${asset.bytes}`;
      const priorCacheIdentity = cacheIdentities.get(asset.cacheKey);
      if (priorCacheIdentity !== undefined && priorCacheIdentity !== fullCacheIdentity) {
        throw new LaunchCatalogValidationError(
          `Cache-key collision has different immutable content: ${asset.cacheKey}`,
        );
      }
      cacheIdentities.set(asset.cacheKey, fullCacheIdentity);
      if (
        !asset.cacheKey.includes(asset.revision) ||
        !asset.cacheKey.includes(asset.sha256.slice('sha256:'.length))
      ) {
        throw new LaunchCatalogValidationError(
          `Asset ${asset.id} cache key omits its full revision or digest`,
        );
      }
      if (
        asset.requiredAcceptance !== null &&
        !asset.licenseIds.includes(asset.requiredAcceptance.licenseId)
      ) {
        throw new LaunchCatalogValidationError(
          `Asset ${asset.id} acceptance license is not attached to the asset`,
        );
      }
      if (
        asset.requiredAcceptance !== null &&
        !set.requiredAcceptanceLicenseIds.includes(asset.requiredAcceptance.licenseId)
      ) {
        throw new LaunchCatalogValidationError(
          `Asset ${asset.id} acceptance license is not required by asset set ${set.id}`,
        );
      }
      if (asset.requiredAcceptance !== null) {
        const acceptanceLicense = licensesById.get(asset.requiredAcceptance.licenseId);
        if (
          acceptanceLicense?.evidenceSha256 === undefined ||
          acceptanceLicense.evidenceSha256 !== asset.requiredAcceptance.termsHash
        ) {
          throw new LaunchCatalogValidationError(
            `Asset ${asset.id} acceptance hash is not anchored to its reviewed license evidence digest`,
          );
        }
      }
    }
    for (const requiredLicenseId of set.requiredAcceptanceLicenseIds) {
      if (!set.assets.some((asset) => asset.requiredAcceptance?.licenseId === requiredLicenseId)) {
        throw new LaunchCatalogValidationError(
          `Asset set ${set.id} has an unused acceptance license ${requiredLicenseId}`,
        );
      }
    }
  }
  for (const delivery of manifest.assetDeliveryEvidence) {
    if (!engineIds.has(delivery.engineId)) {
      throw new LaunchCatalogValidationError(
        `Asset delivery evidence ${delivery.id} has no engine`,
      );
    }
    requireReferences(
      `Asset delivery evidence ${delivery.id}`,
      delivery.assetSetIds,
      assetSetIds,
      'asset set',
    );
    const coveredSets = manifest.assetSets.filter(({ id }) => delivery.assetSetIds.includes(id));
    if (coveredSets.some(({ engineId }) => engineId !== delivery.engineId)) {
      throw new LaunchCatalogValidationError(
        `Asset delivery evidence ${delivery.id} crosses engine boundaries`,
      );
    }
    const coveredAssets = new Map(
      coveredSets.flatMap(({ assets }) => assets.map((asset) => [asset.id, asset] as const)),
    );
    for (const observation of delivery.observations) {
      const asset = coveredAssets.get(observation.assetId);
      if (asset === undefined) {
        throw new LaunchCatalogValidationError(
          `Asset delivery evidence ${delivery.id} references missing asset ${observation.assetId}`,
        );
      }
      if (observation.contentRange !== `bytes 0-0/${asset.bytes}`) {
        throw new LaunchCatalogValidationError(
          `Asset delivery evidence ${delivery.id} has incorrect byte evidence for ${asset.id}`,
        );
      }
    }
    if (
      delivery.scope === 'all-required-assets' &&
      (delivery.checkedAssetIds.length !== coveredAssets.size ||
        [...coveredAssets.keys()].some((assetId) => !delivery.checkedAssetIds.includes(assetId)))
    ) {
      throw new LaunchCatalogValidationError(
        `Asset delivery evidence ${delivery.id} overstates all-asset delivery coverage`,
      );
    }
  }
  for (const evidence of manifest.releaseAssetEvidence) {
    requireReferences(`Release asset ${evidence.id}`, evidence.licenseIds, licenseIds, 'license');
    requireReferences(`Release asset ${evidence.id}`, evidence.sourceIds, sourceIds, 'source');
  }
  for (const gallery of manifest.galleries) {
    requireReferences(`Gallery ${gallery.id}`, gallery.licenseIds, licenseIds, 'license');
    requireReferences(`Gallery ${gallery.id}`, gallery.sourceIds, sourceIds, 'source');
    if (gallery.candidateId !== null && !candidateIds.has(gallery.candidateId)) {
      throw new LaunchCatalogValidationError(`Gallery ${gallery.id} has no candidate`);
    }
    requireReferences(`Gallery ${gallery.id}`, gallery.sampleIds, sampleIds, 'official sample');
    requireReferences(
      `Gallery ${gallery.id}`,
      gallery.generatedMediaIds,
      generatedMediaIds,
      'generated media',
    );
  }
  for (const sample of manifest.samples) {
    const gallery = manifest.galleries.find(({ id }) => id === sample.galleryId);
    if (gallery === undefined || !gallery.sampleIds.includes(sample.id)) {
      throw new LaunchCatalogValidationError(
        `Official sample ${sample.id} is not owned by its gallery`,
      );
    }
    requireReferences(`Official sample ${sample.id}`, sample.licenseIds, licenseIds, 'license');
    requireReferences(`Official sample ${sample.id}`, sample.sourceIds, sourceIds, 'source');
    const sampleRights = sample.licenseIds
      .map((licenseId) => licensesById.get(licenseId))
      .filter((license) => license?.scope === 'sample');
    if (sampleRights.length === 0) {
      throw new LaunchCatalogValidationError(
        `Official sample ${sample.id} has no sample rights record`,
      );
    }
    if (
      sample.redistributionStatus === 'redistribution-cleared' &&
      !sampleRights.some(
        (license) => license?.reviewStatus === 'verified' && license.permitsRedistribution,
      )
    ) {
      throw new LaunchCatalogValidationError(
        `Official sample ${sample.id} has no verified redistribution rights`,
      );
    }
    if (
      gallery.mode === 'source-only' &&
      (sample.redistributionStatus === 'redistribution-cleared' || sample.audioUrl !== null)
    ) {
      throw new LaunchCatalogValidationError(
        `Source-only gallery ${gallery.id} cannot host or redistribute sample audio`,
      );
    }
  }
  for (const candidate of manifest.generationCandidates) {
    const gallery = manifest.galleries.find(({ id }) => id === candidate.galleryId);
    if (gallery?.candidateId !== candidate.id) {
      throw new LaunchCatalogValidationError(
        `Candidate ${candidate.id} is not owned by its gallery`,
      );
    }
    requireReferences(`Candidate ${candidate.id}`, candidate.licenseIds, licenseIds, 'license');
    requireReferences(`Candidate ${candidate.id}`, candidate.sourceIds, sourceIds, 'source');
    if (
      candidate.referenceLineage !== null &&
      !candidateIds.has(candidate.referenceLineage.generatorCandidateId)
    ) {
      throw new LaunchCatalogValidationError(
        `Candidate ${candidate.id} references missing reference candidate: ${candidate.referenceLineage.generatorCandidateId}`,
      );
    }
    if (
      JSON.stringify(candidate.sourceIds) !== JSON.stringify(gallery.sourceIds) ||
      JSON.stringify(candidate.licenseIds) !== JSON.stringify(gallery.licenseIds)
    ) {
      throw new LaunchCatalogValidationError(
        `Candidate ${candidate.id} must exactly close its gallery source and license evidence`,
      );
    }
    if (gallery.mode !== 'source-only') {
      requireReviewedForEnabledUse(`Candidate ${candidate.id}`, candidate.licenseIds);
    }
    if (candidate.referenceLineage?.status === 'verified') {
      const lineage = candidate.referenceLineage;
      const generatorCandidate = manifest.generationCandidates.find(
        ({ id }) => id === lineage.generatorCandidateId,
      );
      const approvedReference = manifest.generatedMedia.find(
        (media) =>
          media.candidateId === lineage.generatorCandidateId &&
          media.audioSha256 === lineage.audioSha256 &&
          media.transcriptSha256 === lineage.transcriptSha256 &&
          media.humanReview.status === 'approved',
      );
      if (
        generatorCandidate === undefined ||
        lineage.promptText !== generatorCandidate.transcript ||
        lineage.transcriptSha256 !== canonicalTranscriptSha256(generatorCandidate.transcript) ||
        approvedReference === undefined
      ) {
        throw new LaunchCatalogValidationError(
          `Candidate ${candidate.id} has fabricated or unapproved verified reference lineage`,
        );
      }
    }
  }
  for (const media of manifest.generatedMedia) {
    const candidate = manifest.generationCandidates.find(({ id }) => id === media.candidateId);
    const gallery =
      candidate === undefined
        ? undefined
        : manifest.galleries.find(({ id }) => id === candidate.galleryId);
    if (
      candidate === undefined ||
      gallery === undefined ||
      !gallery.generatedMediaIds.includes(media.id)
    ) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} is not owned by its candidate gallery`,
      );
    }
    if (
      candidate.readiness !== 'ready-for-generation' ||
      candidate.runtimeEnvironment.status !== 'verified'
    ) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} has a candidate that is not publishable`,
      );
    }
    if (media.transcriptSha256 !== canonicalTranscriptSha256(candidate.transcript)) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} transcript hash does not match exact candidate prompt bytes`,
      );
    }
    requireReferences(`Generated media ${media.id}`, media.licenseIds, licenseIds, 'license');
    requireReferences(`Generated media ${media.id}`, media.sourceIds, sourceIds, 'source');
    if (
      !sourceIds.has(media.generatorSourceId) ||
      !media.sourceIds.includes(media.generatorSourceId)
    ) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} has no valid generator source`,
      );
    }
    const missingCandidateLicense = candidate.licenseIds.find(
      (licenseId) => !media.licenseIds.includes(licenseId),
    );
    if (missingCandidateLicense !== undefined) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} omits candidate license ${missingCandidateLicense}`,
      );
    }
    if (
      !media.licenseIds.some((licenseId) => {
        const rights = licensesById.get(licenseId);
        return (
          rights?.scope === 'generated-output' &&
          rights.reviewStatus === 'verified' &&
          rights.permitsRedistribution
        );
      })
    ) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} has no verified generated-output rights record`,
      );
    }
    const exactLineageMatches =
      media.modelRevision === candidate.modelRevision &&
      media.codeRevision === candidate.codeRevision &&
      media.seed === candidate.seed &&
      media.loadingStrategy === candidate.loadingStrategy &&
      JSON.stringify(media.parameters) === JSON.stringify(candidate.parameters) &&
      JSON.stringify(media.dependencyRevisions) === JSON.stringify(candidate.dependencyRevisions) &&
      JSON.stringify(media.runtimeEnvironment) === JSON.stringify(candidate.runtimeEnvironment) &&
      JSON.stringify(media.referenceLineage) === JSON.stringify(candidate.referenceLineage);
    if (!exactLineageMatches) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} does not match its candidate lineage`,
      );
    }
    if (
      candidate.watermarkRequirement === 'preserve-perth' &&
      media.watermark !== 'perth-preserved'
    ) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} must preserve the PerTh watermark`,
      );
    }
  }
  const counts = countLaunchCatalog(manifest);
  if (
    counts.totalVoices !== 426 ||
    counts.byEngine.edge !== 322 ||
    counts.byEngine.kokoro !== 54 ||
    counts.byEngine.pocket !== 20 ||
    counts.byEngine.kitten !== 8 ||
    counts.byEngine.supertonic !== 10 ||
    counts.byEngine.piper !== 12 ||
    counts.declaredByRuntime.browser !== 84 ||
    counts.enabledByRuntime.browser !== 72 ||
    counts.enabledByRuntime.companion !== 20 ||
    counts.enabledByRuntime.online !== 0
  ) {
    throw new LaunchCatalogValidationError('Launch count invariant failed');
  }
  // Compare parsed records with the equivalently parsed canonical catalog so
  // schema-preserving normalization (for example upstream metadata whitespace)
  // cannot look like release drift.
  const canonical = LaunchCatalogManifestSchema.parse(
    buildLaunchCatalog(),
  ) as LaunchCatalogManifest;
  requireExactRecordSet(manifest.engines, canonical.engines, 'launch engine');
  requireExactRecordSet(manifest.voices, canonical.voices, 'launch voice');
  requireExactRecordSet(manifest.assetSets, canonical.assetSets, 'launch asset set');
  requireExactRecordSet(manifest.featureFlags, canonical.featureFlags, 'feature flag');
  requireExactRecordSet(
    manifest.releaseAssetEvidence,
    canonical.releaseAssetEvidence,
    'Piper release evidence',
  );
  requireExactRecordSet(manifest.galleries, canonical.galleries, 'launch gallery', (gallery) => {
    const { sampleIds: _sampleIds, generatedMediaIds: _generatedMediaIds, ...fixed } = gallery;
    return fixed;
  });
  requireExactRecordSet(
    manifest.generationCandidates,
    canonical.generationCandidates,
    'generation candidate',
    ({ id, galleryId, sourceIds, licenseIds }) => ({ id, galleryId, sourceIds, licenseIds }),
  );

  for (const sample of manifest.samples) {
    const owners = manifest.galleries.filter((gallery) => gallery.sampleIds.includes(sample.id));
    if (owners.length !== 1 || owners[0]!.id !== sample.galleryId) {
      throw new LaunchCatalogValidationError(
        `Official sample ${sample.id} must have exactly one matching gallery owner`,
      );
    }
  }
  for (const media of manifest.generatedMedia) {
    const candidate = manifest.generationCandidates.find(({ id }) => id === media.candidateId);
    const owners = manifest.galleries.filter((gallery) =>
      gallery.generatedMediaIds.includes(media.id),
    );
    if (candidate === undefined || owners.length !== 1 || owners[0]!.id !== candidate.galleryId) {
      throw new LaunchCatalogValidationError(
        `Generated media ${media.id} must have exactly one matching gallery owner`,
      );
    }
  }
  const edge = manifest.voices.filter(({ engineId }) => engineId === 'edge');
  if (
    edge.some(
      (voice) =>
        voice.releaseGate.reason !== 'terms-not-cleared' ||
        voice.assetSetId !== null ||
        voice.backend !== 'external-service',
    )
  ) {
    throw new LaunchCatalogValidationError('Edge must remain metadata-only and terms-gated');
  }
  const piper = manifest.voices.filter(({ engineId }) => engineId === 'piper');
  const expectedPiperEvidenceVoiceIds = PIPER_IDS.filter((id) => id !== 'bg_BG-dimitar-medium').map(
    (id) => `piper:${id}`,
  );
  const actualPiperEvidenceVoiceIds = manifest.releaseAssetEvidence.map(({ voiceId }) => voiceId);
  if (
    piper.length !== 12 ||
    piper.some(
      (voice) => voice.releaseGate.reason !== 'asset-unavailable' || voice.assetSetId !== null,
    ) ||
    manifest.releaseAssetEvidence.length !== 11 ||
    manifest.releaseAssetEvidence.some(({ corsReadable }) => corsReadable) ||
    new Set(actualPiperEvidenceVoiceIds).size !== actualPiperEvidenceVoiceIds.length ||
    expectedPiperEvidenceVoiceIds.some(
      (voiceId) => !actualPiperEvidenceVoiceIds.includes(voiceId),
    ) ||
    actualPiperEvidenceVoiceIds.some((voiceId) => !expectedPiperEvidenceVoiceIds.includes(voiceId))
  ) {
    throw new LaunchCatalogValidationError(
      'Piper must remain asset-unavailable until a pinned CORS-readable mirror exists',
    );
  }
  if (manifest.galleries.length !== 12) {
    throw new LaunchCatalogValidationError('Gallery launch invariant failed');
  }
  if (
    manifest.assetDeliveryEvidence.length !== 4 ||
    manifest.assetDeliveryEvidence.some(
      ({ scope, result }) => scope !== 'representative-assets' || result !== 'representative-pass',
    )
  ) {
    throw new LaunchCatalogValidationError(
      'Task 4 browser delivery evidence must remain explicitly representative',
    );
  }
  return { manifest, counts };
}

export function stableStringifyLaunchCatalog(catalog: LaunchCatalogManifest): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
