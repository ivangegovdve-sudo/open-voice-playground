import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTERS,
  filterVoices,
  parseFilterSearch,
  serializeFilterSearch,
  type CatalogVoice,
} from './filters';
import { seedCatalog } from './catalog';
import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { buildExplorerEntries } from './explorer';
import { mapLaunchCatalog } from './launch-catalog';

const voices: CatalogVoice[] = [
  {
    id: 'atlas:alba',
    name: 'Álba',
    engineId: 'atlas',
    engineName: 'Atlas',
    locale: 'es-ES',
    language: 'Spanish',
    region: 'ES',
    gender: 'female',
    styles: ['warm'],
    licenseIds: ['community'],
    sourceIds: ['atlas-source'],
    runtimeModes: ['browser'],
    sample: null,
  },
  {
    id: 'atlas:bruno',
    name: 'Bruno',
    engineId: 'atlas',
    engineName: 'Atlas',
    locale: 'pt-BR',
    language: 'Portuguese',
    region: 'BR',
    gender: 'male',
    styles: ['clear'],
    licenseIds: ['community'],
    sourceIds: ['atlas-source'],
    runtimeModes: ['companion'],
    sample: null,
  },
  {
    id: 'gallery:celine',
    name: 'Céline',
    engineId: 'gallery',
    engineName: 'Gallery',
    locale: 'fr-FR',
    language: 'French',
    region: 'FR',
    gender: 'unspecified',
    styles: ['narrative'],
    licenseIds: ['listen-only'],
    sourceIds: ['gallery-source'],
    runtimeModes: ['sample-only'],
    sample: null,
  },
];

describe('catalog filters', () => {
  it('matches search text without requiring diacritics', () => {
    const result = filterVoices(voices, { ...EMPTY_FILTERS, q: 'alba' });

    expect(result.map((voice) => voice.id)).toEqual(['atlas:alba']);
  });

  it('ORs values within a filter and ANDs different filters', () => {
    const result = filterVoices(voices, {
      ...EMPTY_FILTERS,
      mode: ['browser', 'companion'],
      region: ['ES'],
      license: ['community'],
    });

    expect(result.map((voice) => voice.id)).toEqual(['atlas:alba']);
  });

  it('round-trips every filter through stable query parameters', () => {
    const filters = {
      ...EMPTY_FILTERS,
      q: 'clear voice',
      mode: ['browser', 'companion'],
      engine: ['atlas'],
      lang: ['Portuguese'],
      locale: ['pt-BR'],
      region: ['BR'],
      gender: ['male'],
      style: ['clear'],
      license: ['community'],
      sort: 'engine' as const,
    };

    const search = serializeFilterSearch(filters);

    expect(search).toContain('mode=browser');
    expect(search).toContain('mode=companion');
    expect(parseFilterSearch(search)).toEqual(filters);
  });

  it('filters fixture voices by the region published in their BCP47 locale', () => {
    const result = filterVoices(seedCatalog.voices, { ...EMPTY_FILTERS, region: ['GB'] });

    expect(result.map((voice) => voice.id)).toEqual(['fixture-browser:voice-b']);
  });

  it.each([
    ['mode=catalog-only&engine=pocket&lang=German', 52],
    ['mode=catalog-only&locale=de', 52],
    ['region=Unspecified&engine=pocket&mode=catalog-only', 312],
    ['gender=unspecified&mode=catalog-only', 312],
  ])('filters Pocket coverage with %s', (search, expected) => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson));

    expect(filterVoices(entries, parseFilterSearch(search))).toHaveLength(expected);
  });

  it.each(['GB', 'US', 'BR', 'PT'])('does not infer country %s for Pocket coverage', (region) => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson));

    expect(
      filterVoices(entries, { ...EMPTY_FILTERS, mode: ['catalog-only'], region: [region] }),
    ).toEqual([]);
  });

  it('keeps catalog-only availability separate from legacy Pocket runtime presets', () => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson));
    const result = filterVoices(entries, {
      ...EMPTY_FILTERS,
      engine: ['pocket'],
      mode: ['catalog-only'],
    });

    expect(result).toHaveLength(312);
    expect(result.every((entry) => entry.entryKind === 'catalog-only-pocket-variant')).toBe(true);
  });

  it('searches the raw selector and label in either display order', () => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson));
    const result = filterVoices(entries, { ...EMPTY_FILTERS, q: 'german_24l alba' });

    expect(result.map(({ id }) => id)).toEqual(['pocket:german_24l.alba']);
  });
});
