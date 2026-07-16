import type { CatalogVoice, RuntimeMode } from './filters';
import fixture from '../../../../packages/catalog/fixtures/catalog.fixture.json';
import type {
  AssetDeliveryEvidence,
  AssetSetManifest,
  BrowserRuntimeArtifact,
  BrowserRuntimeSelection,
  FeatureFlag,
  GalleryManifest,
  GeneratedMediaProvenance,
  GenerationCandidate,
  OfficialSample,
  PinnedReleaseAssetEvidence,
} from '@open-voice/contracts';

export type CatalogEngine = {
  id: string;
  name: string;
  classification: string;
  runtimeModes: RuntimeMode[];
  languageTags: string[];
  licenseIds: string[];
  sourceIds: string[];
  backend?: CatalogVoice['backend'];
  releaseGate?: CatalogVoice['releaseGate'];
  assetSetIds?: string[];
};

export type LicenseInfo = {
  id: string;
  name: string;
  scope: string;
  url: string;
  attribution: string;
  redistribution: boolean;
  commercialUse: boolean;
  terms: string | null;
  reviewStatus: string;
  spdxId?: string;
};

export type SourceInfo = {
  id: string;
  url: string;
  sourceClass: string;
  lastVerifiedAt: string;
  health: string;
  revision: string;
  contentHash?: string;
};

export const RUNTIME_LABELS: Record<RuntimeMode, string> = {
  browser: 'Runs in browser',
  online: 'Online service',
  companion: 'Uses companion',
  'sample-only': 'Sample only',
};

export type SeedCatalog = {
  kind: 'fixture' | 'launch';
  catalogId: string;
  voices: CatalogVoice[];
  engines: CatalogEngine[];
  licenses: ReadonlyMap<string, LicenseInfo>;
  sources: ReadonlyMap<string, SourceInfo>;
  generatedAt: string;
  assetSets: AssetSetManifest[];
  runtimeArtifacts: BrowserRuntimeArtifact[];
  runtimeSelections: BrowserRuntimeSelection[];
  assetDeliveryEvidence: AssetDeliveryEvidence[];
  releaseAssetEvidence: PinnedReleaseAssetEvidence[];
  featureFlags: FeatureFlag[];
  galleries: GalleryManifest[];
  officialSamples: OfficialSample[];
  generationCandidates: GenerationCandidate[];
  generatedMedia: GeneratedMediaProvenance[];
};

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

export function deriveLanguageName(locale: string): string {
  const language = new Intl.Locale(locale).language;
  return languageNames.of(language) ?? language;
}

export function deriveRegionFromLocale(locale: string): string {
  try {
    return new Intl.Locale(locale).region ?? 'Unspecified';
  } catch {
    return 'Unspecified';
  }
}

const samplesByVoice = new Map(
  fixture.samples.map((sample) => [
    sample.voiceId,
    {
      id: sample.id,
      audioUrl: sample.officialAudioUrl,
      officialPageUrl: sample.officialPageUrl,
      transcript: sample.transcript,
      sourceId: sample.sourceId,
      licenseId: sample.licenseId,
    },
  ]),
);
const enginesById = new Map(fixture.engines.map((engine) => [engine.id, engine]));

export const seedCatalog: SeedCatalog = {
  kind: 'fixture',
  catalogId: fixture.catalogId,
  voices: fixture.voices.map((voice) => {
    const engine = enginesById.get(voice.engineId);
    if (engine === undefined) {
      throw new Error(`Fixture voice ${voice.id} references a missing engine`);
    }
    return {
      id: voice.id,
      name: voice.displayName,
      engineId: voice.engineId,
      engineName: engine.displayName,
      locale: voice.locale,
      languageTags: [...voice.languageTags],
      languages: [...new Set(voice.languageTags.map(deriveLanguageName))],
      language: deriveLanguageName(voice.locale),
      region: deriveRegionFromLocale(voice.locale),
      regions: [...new Set(voice.languageTags.map(deriveRegionFromLocale))],
      gender: voice.gender,
      styles: [...voice.styleTags],
      licenseIds: [...voice.licenseIds],
      sourceIds: [...voice.sourceIds],
      runtimeModes: [...voice.runtimeModes] as RuntimeMode[],
      sample: samplesByVoice.get(voice.id) ?? null,
    };
  }),
  engines: fixture.engines.map((engine) => ({
    id: engine.id,
    name: engine.displayName,
    classification: engine.classification,
    runtimeModes: [...engine.runtimeModes] as RuntimeMode[],
    languageTags: [...engine.languageTags],
    licenseIds: [...engine.licenseIds],
    sourceIds: [...engine.sourceIds],
  })),
  licenses: new Map(
    fixture.licenses.map((license) => [
      license.id,
      {
        id: license.id,
        name: license.name,
        scope: license.scope,
        url: license.evidenceUrl,
        attribution: license.attribution,
        redistribution: license.permitsRedistribution,
        commercialUse: license.permitsCommercialUse,
        terms: 'exactUpstreamTerms' in license ? (license.exactUpstreamTerms ?? null) : null,
        reviewStatus: license.reviewStatus,
        ...('spdxId' in license && license.spdxId !== undefined ? { spdxId: license.spdxId } : {}),
      },
    ]),
  ),
  sources: new Map(
    fixture.sources.map((source) => [
      source.id,
      {
        id: source.id,
        url: source.canonicalUrl,
        sourceClass: source.sourceClass,
        lastVerifiedAt: source.lastVerifiedAt,
        health: source.health,
        revision: source.upstreamRevision,
        ...('contentHash' in source && typeof source.contentHash === 'string'
          ? { contentHash: source.contentHash }
          : {}),
      },
    ]),
  ),
  generatedAt: fixture.generatedAt,
  assetSets: [],
  runtimeArtifacts: [],
  runtimeSelections: [],
  assetDeliveryEvidence: [],
  releaseAssetEvidence: [],
  featureFlags: [],
  galleries: [],
  officialSamples: [],
  generationCandidates: [],
  generatedMedia: [],
};
