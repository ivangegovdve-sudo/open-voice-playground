import {
  PocketCoverageManifestSchema,
  type PocketCoverageManifest,
  type PocketPresetVariant,
} from '@open-voice/contracts';

import { LaunchCatalogValidationError } from './launch.js';
import {
  POCKET_MULTILINGUAL_INVENTORY_SHA256,
  POCKET_MULTILINGUAL_LABELS,
  POCKET_MULTILINGUAL_REVISION,
  POCKET_MULTILINGUAL_SELECTORS,
} from './pocket-multilingual-data.js';

type PocketRightsDecision = Pick<
  PocketPresetVariant,
  'rightsFamily' | 'listingPolicy' | 'runtimeExclusionReason' | 'licenseIds'
>;

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
const PROVENANCE_PENDING = new Set(['giovanni', 'lola', 'juergen', 'rafael']);
const BASE_SOURCE_IDS = [
  'pocket-code-source',
  'pocket-weights-source',
  'pocket-voice-source',
] as const;

const cleared = (
  rightsFamily: PocketRightsDecision['rightsFamily'],
  licenseId: string,
): PocketRightsDecision => ({
  rightsFamily,
  listingPolicy: 'catalog-only-runtime-candidate',
  runtimeExclusionReason: 'assets-not-release-pinned',
  licenseIds: [licenseId],
});

const noncommercial = (
  rightsFamily: 'expresso' | 'ears',
  licenseId: string,
): PocketRightsDecision => ({
  rightsFamily,
  listingPolicy: 'link-only-noncommercial',
  runtimeExclusionReason: 'noncommercial-source-terms',
  licenseIds: [licenseId],
});

const provenancePending = (): PocketRightsDecision => ({
  rightsFamily: 'repository-level-unclear',
  listingPolicy: 'link-only-provenance-pending',
  runtimeExclusionReason: 'per-clip-provenance-unresolved',
  licenseIds: ['pocket-unresolved-per-clip-provenance'],
});

function rightsFor(label: string): PocketRightsDecision {
  if (label === 'alba') {
    return cleared('alba-mackenna', 'pocket-alba-mackenna-dataset-license');
  }
  if (label === 'estelle') {
    return cleared('unmute-estelle', 'pocket-unmute-prod-dataset-license');
  }
  if (VCTK.has(label)) {
    return cleared('vctk', 'pocket-vctk-dataset-license');
  }
  if (VOICE_ZERO.has(label)) {
    return cleared('voice-zero', 'pocket-voice-zero-dataset-license');
  }
  if (DONATIONS.has(label)) {
    return cleared('voice-donation', 'pocket-donations-dataset-license');
  }
  if (label === 'cosette') {
    return noncommercial('expresso', 'pocket-expresso-dataset-license');
  }
  if (label === 'jean') {
    return noncommercial('ears', 'pocket-ears-dataset-license');
  }
  if (PROVENANCE_PENDING.has(label)) {
    return provenancePending();
  }
  throw new LaunchCatalogValidationError(`Pocket label has no reviewed rights decision: ${label}`);
}

export type PocketCoverageCounts = {
  totalEmbeddings: 312;
  byLanguage: { de: 52; en: 78; es: 52; fr: 26; it: 52; pt: 52 };
  byPolicy: {
    'catalog-only-runtime-candidate': 240;
    'link-only-noncommercial': 24;
    'link-only-provenance-pending': 48;
  };
  publishedOutputClips: 0;
};

export function buildPocketCoverage(): PocketCoverageManifest {
  const variants = POCKET_MULTILINGUAL_SELECTORS.flatMap((selector) =>
    POCKET_MULTILINGUAL_LABELS.map((label): PocketPresetVariant => {
      const upstreamId = `${selector.id}.${label}`;
      const decision = rightsFor(label);
      return {
        id: `pocket:${upstreamId}`,
        engineId: 'pocket',
        upstreamId,
        selectorId: selector.id,
        label,
        upstreamPath: `languages/${selector.id}/embeddings/${label}.safetensors`,
        languageTag: selector.languageTag,
        countryCode: null,
        gender: 'unspecified',
        ...decision,
        sourceIds:
          decision.listingPolicy === 'link-only-provenance-pending'
            ? [...BASE_SOURCE_IDS, 'pocket-historical-prompt-source']
            : [...BASE_SOURCE_IDS],
        officialDemoId: 'pocket-official-live-demo',
      };
    }),
  ).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return PocketCoverageManifestSchema.parse({
    id: 'pocket-multilingual-coverage',
    engineId: 'pocket',
    revisionPins: {
      stableCode: '058886528d0b6f2f2d4022de2e244a5260729e6e',
      currentCodeAudit: 'd108410d23eef7e01db282f9442891162dbc3db6',
      fullModel: '4c8ad48f8a003909bc4f1122cbe88a4252124621',
      noCloningModel: POCKET_MULTILINGUAL_REVISION,
      voiceRepository: '323332d33f997de8394f24a193e1a76df720e01a',
      historicalPromptSnapshot: '64ab7d24c479d736a83b8cc666c4a776fca30fda',
    },
    inventorySha256: POCKET_MULTILINGUAL_INVENTORY_SHA256,
    selectorCount: 12,
    labelCount: 26,
    totalEmbeddings: 312,
    languageCounts: { en: 78, fr: 26, de: 52, it: 52, pt: 52, es: 52 },
    rightsCounts: {
      catalogOnlyRuntimeCandidate: 240,
      linkOnlyNonCommercial: 24,
      linkOnlyProvenancePending: 48,
    },
    publishedOutputClipCount: 0,
    auditSourceIds: [
      'pocket-code-source',
      'pocket-current-code-audit-source',
      'pocket-full-model-source',
      'pocket-weights-source',
      'pocket-voice-source',
      'pocket-historical-prompt-source',
      'pocket-multilingual-announcement-source',
      'pocket-official-live-demo-source',
    ],
    variants,
    officialDemo: {
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
    },
  });
}

export function countPocketCoverage(coverage: PocketCoverageManifest): PocketCoverageCounts {
  const byLanguage = { de: 0, en: 0, es: 0, fr: 0, it: 0, pt: 0 };
  const byPolicy = {
    'catalog-only-runtime-candidate': 0,
    'link-only-noncommercial': 0,
    'link-only-provenance-pending': 0,
  };
  for (const variant of coverage.variants) {
    byLanguage[variant.languageTag] += 1;
    byPolicy[variant.listingPolicy] += 1;
  }
  return {
    totalEmbeddings: coverage.variants.length,
    byLanguage,
    byPolicy,
    publishedOutputClips: coverage.publishedOutputClipCount,
  } as PocketCoverageCounts;
}
