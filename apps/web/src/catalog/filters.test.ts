import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTERS,
  filterVoices,
  parseFilterSearch,
  serializeFilterSearch,
  type CatalogVoice,
} from './filters';

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
});
