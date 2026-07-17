import { describe, expect, it } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { buildExplorerEntries } from './explorer';
import { mapLaunchCatalog } from './launch-catalog';

describe('voice explorer entries', () => {
  it('maps 426 runtime presets plus 312 catalog-only Pocket variants', () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog);
    const runtime = entries.filter(({ entryKind }) => entryKind === 'runtime-preset');
    const pocketOnly = entries.filter(
      ({ entryKind }) => entryKind === 'catalog-only-pocket-variant',
    );

    expect(entries).toHaveLength(738);
    expect(runtime).toHaveLength(426);
    expect(pocketOnly).toHaveLength(312);
    expect(pocketOnly.filter(({ locale }) => locale === 'en')).toHaveLength(78);
    expect(
      pocketOnly.every(
        (entry) =>
          entry.region === 'Unspecified' &&
          entry.gender === 'unspecified' &&
          entry.runtimeModes.length === 0,
      ),
    ).toBe(true);
  });

  it('keeps raw selectors visible and distinct without mutating runtime carriage', () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog);
    const germanAlba = entries.filter(
      (entry) =>
        entry.entryKind === 'catalog-only-pocket-variant' &&
        entry.label === 'alba' &&
        entry.locale === 'de',
    );

    expect(germanAlba.map(({ id }) => id)).toEqual([
      'pocket:german.alba',
      'pocket:german_24l.alba',
    ]);
    expect(germanAlba.map(({ name }) => name)).toEqual(['Alba · german', 'Alba · german_24l']);
    expect(catalog.voices.some((voice) => voice.id === 'pocket:german.alba')).toBe(false);
    expect(catalog.voices.every((voice) => !('entryKind' in voice))).toBe(true);
  });

  it('keeps all 20 legacy Pocket presets runtime-declared and clones demo metadata per variant', () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog);
    const runtimePocket = entries.filter(
      (entry) => entry.entryKind === 'runtime-preset' && entry.engineId === 'pocket',
    );
    const coverage = entries.filter((entry) => entry.entryKind === 'catalog-only-pocket-variant');

    expect(runtimePocket).toHaveLength(20);
    expect(coverage[0]?.officialDemo).toEqual(catalog.pocketCoverage?.officialDemo);
    expect(coverage[0]?.officialDemo).not.toBe(catalog.pocketCoverage?.officialDemo);
    expect(coverage[0]?.officialDemo).not.toBe(coverage[1]?.officialDemo);
  });
});
