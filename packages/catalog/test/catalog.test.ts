import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import * as catalog from '../src/index.js';

const api = catalog as Record<string, unknown>;
const temporaryDirectories: string[] = [];

type CatalogApi = {
  countCatalog: (manifest: unknown) => unknown;
  loadCatalog: (path: string) => Promise<unknown>;
  sortCatalogManifest: (manifest: unknown) => Record<string, unknown[]>;
  validateCatalogForRelease: (manifest: unknown) => {
    counts: unknown;
    manifest: Record<string, unknown[]>;
  };
};

function catalogApi(): CatalogApi {
  for (const exportName of [
    'countCatalog',
    'loadCatalog',
    'sortCatalogManifest',
    'validateCatalogForRelease',
  ]) {
    expect(api[exportName], `${exportName} should be exported`).toBeTypeOf('function');
  }

  return api as unknown as CatalogApi;
}

const fixtureCatalog = {
  schemaVersion: 1,
  catalogId: 'foundation-fixture',
  generatedAt: '2026-07-15T00:00:00.000Z',
  engines: [
    {
      id: 'fixture-browser',
      displayName: 'Fixture Browser Engine',
      classification: 'open-weight-local',
      runtimeModes: ['browser', 'companion'],
      languageTags: ['en-US'],
      licenseIds: ['fixture-code-license', 'fixture-weights-license'],
      sourceIds: ['fixture-browser-source'],
    },
    {
      id: 'fixture-companion',
      displayName: 'Fixture Companion Engine',
      classification: 'open-weight-local',
      runtimeModes: ['companion'],
      languageTags: ['de-DE'],
      licenseIds: ['fixture-code-license', 'fixture-weights-license'],
      sourceIds: ['fixture-companion-source'],
    },
    {
      id: 'fixture-gallery',
      displayName: 'Fixture Sample Gallery',
      classification: 'sample-only',
      runtimeModes: ['sample-only'],
      languageTags: ['fr-FR'],
      licenseIds: ['fixture-code-license'],
      sourceIds: ['fixture-gallery-source'],
    },
    {
      id: 'fixture-online',
      displayName: 'Fixture Online Engine',
      classification: 'open-source-client-external-service',
      runtimeModes: ['online'],
      languageTags: ['es-ES'],
      licenseIds: ['fixture-code-license'],
      sourceIds: ['fixture-online-source'],
    },
  ],
  voices: [
    {
      id: 'fixture-browser:voice-a',
      engineId: 'fixture-browser',
      upstreamId: 'voice-a',
      displayName: 'Fixture Voice A',
      locale: 'en-US',
      gender: 'unspecified',
      runtimeModes: ['browser'],
      styleTags: ['neutral'],
      licenseIds: ['fixture-voice-license'],
      sourceIds: ['fixture-browser-source'],
    },
    {
      id: 'fixture-browser:voice-b',
      engineId: 'fixture-browser',
      upstreamId: 'voice-b',
      displayName: 'Fixture Voice B',
      locale: 'en-GB',
      gender: 'neutral',
      runtimeModes: ['browser', 'companion'],
      styleTags: [],
      licenseIds: ['fixture-voice-license'],
      sourceIds: ['fixture-browser-source'],
    },
    {
      id: 'fixture-companion:voice-a',
      engineId: 'fixture-companion',
      upstreamId: 'voice-a',
      displayName: 'Fixture Companion Voice',
      locale: 'de-DE',
      gender: 'unspecified',
      runtimeModes: ['companion'],
      styleTags: [],
      licenseIds: ['fixture-voice-license'],
      sourceIds: ['fixture-companion-source'],
    },
    {
      id: 'fixture-gallery:voice-a',
      engineId: 'fixture-gallery',
      upstreamId: 'voice-a',
      displayName: 'Fixture Listen-only Voice',
      locale: 'fr-FR',
      gender: 'unspecified',
      runtimeModes: ['sample-only'],
      styleTags: [],
      licenseIds: ['fixture-voice-license'],
      sourceIds: ['fixture-gallery-source'],
    },
    {
      id: 'fixture-online:voice-a',
      engineId: 'fixture-online',
      upstreamId: 'voice-a',
      displayName: 'Fixture Online Voice',
      locale: 'es-ES',
      gender: 'unspecified',
      runtimeModes: ['online'],
      styleTags: [],
      licenseIds: ['fixture-voice-license'],
      sourceIds: ['fixture-online-source'],
    },
  ],
  samples: [
    {
      id: 'fixture-gallery:sample-a',
      engineId: 'fixture-gallery',
      voiceId: 'fixture-gallery:voice-a',
      transcript: 'Un ejemplo de catálogo sin datos de producción.',
      locale: 'fr-FR',
      durationSeconds: 2.5,
      officialAudioUrl: 'https://example.invalid/fixture-gallery/sample-a.wav',
      officialPageUrl: 'https://example.invalid/fixture-gallery/demo',
      licenseId: 'fixture-sample-license',
      sourceId: 'fixture-gallery-source',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
  ],
  licenses: [
    {
      id: 'fixture-code-license',
      scope: 'code',
      name: 'MIT License',
      spdxId: 'MIT',
      evidenceUrl: 'https://opensource.org/license/mit',
      attribution: 'Fixture author',
      permitsRedistribution: true,
      permitsCommercialUse: true,
      reviewedAt: '2026-07-15T00:00:00.000Z',
      reviewStatus: 'verified',
    },
    {
      id: 'fixture-weights-license',
      scope: 'weights',
      name: 'Fixture-only weights terms',
      exactUpstreamTerms: 'Synthetic fixture metadata only; no production weights are represented.',
      evidenceUrl: 'https://example.invalid/fixture-weights/license',
      attribution: 'Fixture author',
      permitsRedistribution: false,
      permitsCommercialUse: false,
      reviewedAt: '2026-07-15T00:00:00.000Z',
      reviewStatus: 'verified',
    },
    {
      id: 'fixture-sample-license',
      scope: 'sample',
      name: 'Fixture-only terms',
      exactUpstreamTerms: 'Synthetic fixture data only; no production asset is represented.',
      evidenceUrl: 'https://example.invalid/fixture-gallery/license',
      attribution: 'Fixture author',
      permitsRedistribution: false,
      permitsCommercialUse: false,
      reviewedAt: '2026-07-15T00:00:00.000Z',
      reviewStatus: 'verified',
    },
    {
      id: 'fixture-voice-license',
      scope: 'voice',
      name: 'Fixture-only terms',
      exactUpstreamTerms: 'Synthetic fixture data only; no production voice is represented.',
      evidenceUrl: 'https://example.invalid/fixture-voices/license',
      attribution: 'Fixture author',
      permitsRedistribution: false,
      permitsCommercialUse: false,
      reviewedAt: '2026-07-15T00:00:00.000Z',
      reviewStatus: 'verified',
    },
  ],
  sources: [
    {
      id: 'fixture-browser-source',
      canonicalUrl: 'https://example.invalid/fixture-browser',
      sourceClass: 'official-repository',
      upstreamRevision: 'fixture-v1',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
    {
      id: 'fixture-companion-source',
      canonicalUrl: 'https://example.invalid/fixture-companion',
      sourceClass: 'official-repository',
      upstreamRevision: 'fixture-v1',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
    {
      id: 'fixture-gallery-source',
      canonicalUrl: 'https://example.invalid/fixture-gallery',
      sourceClass: 'maintainer-demo',
      upstreamRevision: 'fixture-v1',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
    {
      id: 'fixture-online-source',
      canonicalUrl: 'https://example.invalid/fixture-online',
      sourceClass: 'official-documentation',
      upstreamRevision: 'fixture-v1',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
  ],
};

function cloneFixture(): typeof fixtureCatalog {
  return structuredClone(fixtureCatalog);
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error('Fixture collection must not be empty');
  }
  return value;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('catalog validation', () => {
  it('rejects duplicate IDs within every record collection', () => {
    const { validateCatalogForRelease } = catalogApi();
    for (const [collection, recordName] of [
      ['engines', 'engine'],
      ['voices', 'voice'],
      ['samples', 'sample'],
      ['licenses', 'license'],
      ['sources', 'source'],
    ] as const) {
      const manifest = cloneFixture();
      const records = manifest[collection] as Array<{ id: string }>;
      records.push(structuredClone(first(records)));

      expect(() => validateCatalogForRelease(manifest)).toThrow(
        new RegExp(`duplicate ${recordName} id`, 'i'),
      );
    }
  });

  it('separates runtime-mode, runnable, listen-only, and sample counts', () => {
    const { countCatalog } = catalogApi();

    expect(countCatalog(cloneFixture())).toEqual({
      totalVoices: 5,
      runnableVoices: 4,
      listenOnlyVoices: 1,
      samples: 1,
      byRuntime: {
        browser: 2,
        online: 1,
        companion: 2,
        'sample-only': 1,
      },
    });
  });

  it('requires referenced license and source evidence', () => {
    const { validateCatalogForRelease } = catalogApi();
    const withoutLicenseReference = cloneFixture();
    first(withoutLicenseReference.voices).licenseIds = [];

    expect(() => validateCatalogForRelease(withoutLicenseReference)).toThrow(/license/i);

    const withoutSourceEvidence = cloneFixture();
    const { upstreamRevision: _revision, ...incompleteSource } = first(
      withoutSourceEvidence.sources,
    );
    withoutSourceEvidence.sources[0] = incompleteSource as (typeof fixtureCatalog.sources)[number];

    expect(() => validateCatalogForRelease(withoutSourceEvidence)).toThrow(/source|revision/i);
  });

  it('requires independent license evidence for code, weights, voices, and samples', () => {
    const { validateCatalogForRelease } = catalogApi();
    const withoutCodeEvidence = cloneFixture();
    const onlineEngine = withoutCodeEvidence.engines.find(
      (engine) => engine.classification === 'open-source-client-external-service',
    );
    expect(onlineEngine).toBeDefined();
    onlineEngine!.licenseIds = ['fixture-weights-license'];

    expect(() => validateCatalogForRelease(withoutCodeEvidence)).toThrow(/code license/i);

    const withoutWeightEvidence = cloneFixture();
    const localEngine = withoutWeightEvidence.engines.find(
      (engine) => engine.classification === 'open-weight-local',
    );
    expect(localEngine).toBeDefined();
    localEngine!.licenseIds = ['fixture-code-license'];

    expect(() => validateCatalogForRelease(withoutWeightEvidence)).toThrow(/weights/i);

    const voiceUsingCodeLicense = cloneFixture();
    first(voiceUsingCodeLicense.voices).licenseIds = ['fixture-code-license'];

    expect(() => validateCatalogForRelease(voiceUsingCodeLicense)).toThrow(/voice license/i);

    const sampleUsingCodeLicense = cloneFixture();
    first(sampleUsingCodeLicense.samples).licenseId = 'fixture-code-license';

    expect(() => validateCatalogForRelease(sampleUsingCodeLicense)).toThrow(/sample license/i);
  });

  it('sorts every collection by stable ID without mutating the input', () => {
    const { sortCatalogManifest } = catalogApi();
    const manifest = cloneFixture();
    manifest.engines.reverse();
    manifest.voices.reverse();
    manifest.licenses.reverse();
    manifest.sources.reverse();
    const originalFirstVoiceId = first(manifest.voices).id;

    const sorted = sortCatalogManifest(manifest);

    for (const key of ['engines', 'voices', 'samples', 'licenses', 'sources'] as const) {
      const ids = (sorted[key] as Array<{ id: string }>).map(({ id }) => id);
      expect(ids).toEqual([...ids].sort());
    }
    expect(first(manifest.voices).id).toBe(originalFirstVoiceId);
  });

  it('performs release-level referential and availability validation', () => {
    const { validateCatalogForRelease } = catalogApi();
    const missingEngine = cloneFixture();
    first(missingEngine.voices).engineId = 'missing-engine';

    expect(() => validateCatalogForRelease(missingEngine)).toThrow(/engine/i);

    const noRunnableVoice = cloneFixture();
    noRunnableVoice.voices = noRunnableVoice.voices.filter((voice) =>
      voice.runtimeModes.includes('sample-only'),
    );

    expect(() => validateCatalogForRelease(noRunnableVoice)).toThrow(/runnable/i);

    const release = validateCatalogForRelease(cloneFixture());
    expect(release.counts).toEqual({
      totalVoices: 5,
      runnableVoices: 4,
      listenOnlyVoices: 1,
      samples: 1,
      byRuntime: {
        browser: 2,
        online: 1,
        companion: 2,
        'sample-only': 1,
      },
    });
  });

  it('loads, validates, and normalizes a JSON manifest from disk', async () => {
    const { loadCatalog } = catalogApi();
    const directory = await mkdtemp(join(tmpdir(), 'open-voice-catalog-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'catalog.json');
    const manifest = cloneFixture();
    manifest.voices.reverse();
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const loaded = (await loadCatalog(manifestPath)) as {
      counts: { runnableVoices: number };
      manifest: { voices: Array<{ id: string }> };
    };

    expect(loaded.counts.runnableVoices).toBe(4);
    expect(loaded.manifest.voices.map(({ id }) => id)).toEqual(
      [...loaded.manifest.voices.map(({ id }) => id)].sort(),
    );
  });
});
