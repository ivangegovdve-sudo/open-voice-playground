import type { CatalogVoice, RuntimeMode } from './filters';
import fixture from '../../../../packages/catalog/fixtures/catalog.fixture.json';

export type CatalogEngine = {
  id: string;
  name: string;
  classification: string;
  runtimeModes: RuntimeMode[];
  languageTags: string[];
  licenseIds: string[];
  sourceIds: string[];
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
};

export type SourceInfo = {
  id: string;
  url: string;
  sourceClass: string;
  lastVerifiedAt: string;
  health: string;
  revision: string;
};

export const RUNTIME_LABELS: Record<RuntimeMode, string> = {
  browser: 'Runs in browser',
  online: 'Online service',
  companion: 'Uses companion',
  'sample-only': 'Sample only',
};

export type SeedCatalog = {
  voices: CatalogVoice[];
  engines: CatalogEngine[];
  licenses: ReadonlyMap<string, LicenseInfo>;
  sources: ReadonlyMap<string, SourceInfo>;
  generatedAt: string;
};

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function languageName(locale: string): string {
  const language = new Intl.Locale(locale).language;
  return languageNames.of(language) ?? language;
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
      language: languageName(voice.locale),
      region: 'Unspecified',
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
      },
    ]),
  ),
  generatedAt: fixture.generatedAt,
};
