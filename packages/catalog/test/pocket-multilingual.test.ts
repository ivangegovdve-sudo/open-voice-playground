import { PocketCoverageManifestSchema } from '@open-voice/contracts';
import { describe, expect, it } from 'vitest';

import { buildPocketCoverage, countPocketCoverage } from '../src/pocket-multilingual.js';
import {
  POCKET_MULTILINGUAL_LABELS,
  POCKET_MULTILINGUAL_SELECTORS,
} from '../src/pocket-multilingual-data.js';

const VCTK = new Set([
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
const VOICE_ZERO = new Set(['bill_boerst', 'caro_davy', 'peter_yearsley', 'stuart_bell']);
const DONATIONS = new Set(['marius', 'javert']);
const NONCOMMERCIAL = new Set(['cosette', 'jean']);
const PROVENANCE_PENDING = new Set(['giovanni', 'lola', 'juergen', 'rafael']);

function expectedRights(label: string) {
  if (label === 'alba') {
    return [
      'alba-mackenna',
      'catalog-only-runtime-candidate',
      'pocket-alba-mackenna-dataset-license',
    ];
  }
  if (label === 'estelle') {
    return [
      'unmute-estelle',
      'catalog-only-runtime-candidate',
      'pocket-unmute-prod-dataset-license',
    ];
  }
  if (VCTK.has(label)) {
    return ['vctk', 'catalog-only-runtime-candidate', 'pocket-vctk-dataset-license'];
  }
  if (VOICE_ZERO.has(label)) {
    return ['voice-zero', 'catalog-only-runtime-candidate', 'pocket-voice-zero-dataset-license'];
  }
  if (DONATIONS.has(label)) {
    return ['voice-donation', 'catalog-only-runtime-candidate', 'pocket-donations-dataset-license'];
  }
  if (label === 'cosette') {
    return ['expresso', 'link-only-noncommercial', 'pocket-expresso-dataset-license'];
  }
  if (label === 'jean') {
    return ['ears', 'link-only-noncommercial', 'pocket-ears-dataset-license'];
  }
  if (PROVENANCE_PENDING.has(label)) {
    return [
      'repository-level-unclear',
      'link-only-provenance-pending',
      'pocket-unresolved-per-clip-provenance',
    ];
  }
  throw new Error(`Missing test rights decision for ${label}`);
}

describe('Pocket multilingual public coverage', () => {
  it('publishes the reviewed inventory identity and exact public-only counts', () => {
    const coverage = buildPocketCoverage();

    expect(coverage).toMatchObject({
      id: 'pocket-multilingual-coverage',
      engineId: 'pocket',
      inventorySha256: 'sha256:67bb94d81b1a74f18ba13952a355b474ee8788201a58a66a49126316b9e33f6d',
      selectorCount: 12,
      labelCount: 26,
      totalEmbeddings: 312,
      publishedOutputClipCount: 0,
    });
    expect(countPocketCoverage(coverage)).toEqual({
      totalEmbeddings: 312,
      byLanguage: { de: 52, en: 78, es: 52, fr: 26, it: 52, pt: 52 },
      byPolicy: {
        'catalog-only-runtime-candidate': 240,
        'link-only-noncommercial': 24,
        'link-only-provenance-pending': 48,
      },
      publishedOutputClips: 0,
    });
  });

  it('builds exact sorted selector-label identities without aliasing same-language records', () => {
    const variants = buildPocketCoverage().variants ?? [];
    const expectedIds = POCKET_MULTILINGUAL_SELECTORS.flatMap(({ id: selectorId }) =>
      POCKET_MULTILINGUAL_LABELS.map((label) => `pocket:${selectorId}.${label}`),
    ).sort();

    expect(variants).toHaveLength(312);
    expect(variants.map(({ id }) => id)).toEqual(expectedIds);
    expect(new Set(variants.map(({ id }) => id))).toHaveLength(312);
    expect(new Set(variants.map(({ upstreamPath }) => upstreamPath))).toHaveLength(312);

    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    expect(byId.get('pocket:german.alba')?.languageTag).toBe('de');
    expect(byId.get('pocket:german_24l.alba')?.languageTag).toBe('de');
    expect(byId.get('pocket:german.alba')?.upstreamPath).not.toBe(
      byId.get('pocket:german_24l.alba')?.upstreamPath,
    );
  });

  it('assigns every label its exact reviewed family, policy, license, and source closure', () => {
    const coverage = buildPocketCoverage();
    const byId = new Map((coverage.variants ?? []).map((variant) => [variant.id, variant]));

    for (const selector of POCKET_MULTILINGUAL_SELECTORS) {
      for (const label of POCKET_MULTILINGUAL_LABELS) {
        const record = byId.get(`pocket:${selector.id}.${label}`);
        const [rightsFamily, listingPolicy, licenseId] = expectedRights(label);
        const provenancePending = PROVENANCE_PENDING.has(label);

        expect(record).toMatchObject({
          engineId: 'pocket',
          upstreamId: `${selector.id}.${label}`,
          selectorId: selector.id,
          label,
          upstreamPath: `languages/${selector.id}/embeddings/${label}.safetensors`,
          languageTag: selector.languageTag,
          countryCode: null,
          gender: 'unspecified',
          rightsFamily,
          listingPolicy,
          runtimeExclusionReason: provenancePending
            ? 'per-clip-provenance-unresolved'
            : NONCOMMERCIAL.has(label)
              ? 'noncommercial-source-terms'
              : 'assets-not-release-pinned',
          licenseIds: [licenseId],
          sourceIds: provenancePending
            ? [
                'pocket-code-source',
                'pocket-weights-source',
                'pocket-voice-source',
                'pocket-historical-prompt-source',
              ]
            : ['pocket-code-source', 'pocket-weights-source', 'pocket-voice-source'],
          officialDemoId: 'pocket-official-live-demo',
        });
      }
    }
  });

  it('closes the six immutable pins, eight audit sources, and external live demo', () => {
    const coverage = buildPocketCoverage();

    expect(coverage.revisionPins).toEqual({
      stableCode: '058886528d0b6f2f2d4022de2e244a5260729e6e',
      currentCodeAudit: 'd108410d23eef7e01db282f9442891162dbc3db6',
      fullModel: '4c8ad48f8a003909bc4f1122cbe88a4252124621',
      noCloningModel: 'e041936c75475d350b405bc870bcf7c22da4e9e6',
      voiceRepository: '323332d33f997de8394f24a193e1a76df720e01a',
      historicalPromptSnapshot: '64ab7d24c479d736a83b8cc666c4a776fca30fda',
    });
    expect(coverage.auditSourceIds).toEqual([
      'pocket-code-source',
      'pocket-current-code-audit-source',
      'pocket-full-model-source',
      'pocket-weights-source',
      'pocket-voice-source',
      'pocket-historical-prompt-source',
      'pocket-multilingual-announcement-source',
      'pocket-official-live-demo-source',
    ]);
    expect(coverage.officialDemo).toEqual({
      id: 'pocket-official-live-demo',
      engineId: 'pocket',
      pageUrl: 'https://kyutai.org/tts',
      sourceIds: ['pocket-official-live-demo-source'],
      outputClipStatus: 'no-stable-official-generated-output-found',
      audioPublished: false,
      offlineAvailable: false,
      rightsBasis:
        'External live-generation page only; no conditioning audio or output is copied, proxied, cached, or redistributed.',
      reviewedAt: '2026-07-16T00:00:00.000Z',
    });
    expect(PocketCoverageManifestSchema.safeParse(coverage).success).toBe(true);
  });
});
