import { describe, expect, it } from 'vitest';

import { RUNTIME_LABELS, seedCatalog } from './catalog';

describe('seed catalog adapter', () => {
  it('maps every validated fixture voice without changing its runtime mode', () => {
    expect(seedCatalog.voices).toHaveLength(5);
    expect(
      seedCatalog.voices.find((voice) => voice.id === 'fixture-browser:voice-a')?.runtimeModes,
    ).toEqual(['browser']);
    expect(RUNTIME_LABELS).toEqual({
      browser: 'Runs in browser',
      online: 'Online service',
      companion: 'Uses companion',
      'sample-only': 'Sample only',
    });
  });

  it('preserves complete sample-only disclosures from the fixture', () => {
    const voice = seedCatalog.voices.find(
      (candidate) => candidate.id === 'fixture-gallery:voice-a',
    );

    expect(voice?.sample).toMatchObject({
      transcript: 'A synthetic catalog fixture sample.',
      licenseId: 'fixture-sample-license',
      sourceId: 'fixture-gallery-source',
      officialPageUrl: 'https://example.invalid/fixture-gallery/demo',
    });
    expect(voice?.runtimeModes).toEqual(['sample-only']);
  });

  it('exposes linked license and source records for disclosure views', () => {
    expect(seedCatalog.licenses.get('fixture-voice-license')?.name).toBe('Fixture-only terms');
    expect(seedCatalog.sources.get('fixture-browser-source')?.url).toBe(
      'https://example.invalid/fixture-browser',
    );
  });
});
