import type { PocketOfficialLiveDemo, PocketPresetVariant } from '@open-voice/contracts';

import { deriveLanguageName, type SeedCatalog } from './catalog';
import type { CatalogVoice } from './filters';

export type RuntimeExplorerEntry = CatalogVoice & { entryKind: 'runtime-preset' };

export type PocketCoverageExplorerEntry = {
  entryKind: 'catalog-only-pocket-variant';
  id: string;
  name: string;
  engineId: 'pocket';
  engineName: string;
  locale: 'en' | 'fr' | 'de' | 'it' | 'pt' | 'es';
  languageTags: string[];
  languages: string[];
  language: string;
  region: 'Unspecified';
  regions: ['Unspecified'];
  gender: 'unspecified';
  styles: string[];
  licenseIds: string[];
  sourceIds: string[];
  runtimeModes: [];
  sample: null;
  selectorId: string;
  label: string;
  listingPolicy: PocketPresetVariant['listingPolicy'];
  runtimeExclusionReason: PocketPresetVariant['runtimeExclusionReason'];
  officialDemo: PocketOfficialLiveDemo;
};

export type VoiceExplorerEntry = RuntimeExplorerEntry | PocketCoverageExplorerEntry;

const displayLabel = (label: string) =>
  label
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const toCoverageEntry = (
  variant: PocketPresetVariant,
  engineName: string,
  officialDemo: PocketOfficialLiveDemo,
): PocketCoverageExplorerEntry => ({
  entryKind: 'catalog-only-pocket-variant',
  id: variant.id,
  name: `${displayLabel(variant.label)} · ${variant.selectorId}`,
  engineId: 'pocket',
  engineName,
  locale: variant.languageTag,
  languageTags: [variant.languageTag],
  languages: [deriveLanguageName(variant.languageTag)],
  language: deriveLanguageName(variant.languageTag),
  region: 'Unspecified',
  regions: ['Unspecified'],
  gender: 'unspecified',
  styles: [],
  licenseIds: [...variant.licenseIds],
  sourceIds: [...variant.sourceIds],
  runtimeModes: [],
  sample: null,
  selectorId: variant.selectorId,
  label: variant.label,
  listingPolicy: variant.listingPolicy,
  runtimeExclusionReason: variant.runtimeExclusionReason,
  officialDemo: structuredClone(officialDemo),
});

function selectorId(entry: VoiceExplorerEntry): string {
  return entry.entryKind === 'catalog-only-pocket-variant' ? entry.selectorId : '';
}

export function buildExplorerEntries(catalog: SeedCatalog): VoiceExplorerEntry[] {
  const runtimeEntries: RuntimeExplorerEntry[] = catalog.voices.map((voice) => ({
    ...voice,
    entryKind: 'runtime-preset',
  }));
  const coverage = catalog.pocketCoverage;
  if (coverage === null) {
    return runtimeEntries.sort(compareExplorerEntries);
  }

  const pocketEngine = catalog.engines.find(({ id }) => id === 'pocket');
  if (pocketEngine === undefined) {
    throw new Error('Pocket coverage requires the Pocket catalog engine.');
  }
  const coverageEntries = coverage.variants.map((variant) =>
    toCoverageEntry(variant, pocketEngine.name, coverage.officialDemo),
  );
  return [...runtimeEntries, ...coverageEntries].sort(compareExplorerEntries);
}

function compareExplorerEntries(left: VoiceExplorerEntry, right: VoiceExplorerEntry): number {
  return (
    left.name.localeCompare(right.name) ||
    left.locale.localeCompare(right.locale) ||
    selectorId(left).localeCompare(selectorId(right)) ||
    left.id.localeCompare(right.id)
  );
}
