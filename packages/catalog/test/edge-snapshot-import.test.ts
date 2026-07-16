import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  computeEdgeSnapshotReview,
  normalizeEdgeSnapshot,
  renderEdgeSnapshotModule,
} from '../src/edge-snapshot-import.js';
import { EDGE_VOICE_SNAPSHOT } from '../src/launch-data.js';

const launchDataUrl = new URL('../src/launch-data.ts', import.meta.url);

describe('maintainer-only Edge snapshot import', () => {
  it('normalizes only source-published fields and preserves upstream ordering', () => {
    expect(
      normalizeEdgeSnapshot([
        {
          ShortName: 'en-US-AdaNeural',
          Locale: 'en-US',
          Gender: 'Female',
          VoiceTag: { ContentCategories: ['General', 'Friendly', 'General'] },
          ignoredServiceField: 'not public catalog data',
        },
        {
          upstreamId: 'bg-BG-BorislavNeural',
          locale: 'bg-BG',
          gender: 'male',
          styles: ['General'],
        },
      ]),
    ).toEqual([
      {
        upstreamId: 'en-US-AdaNeural',
        locale: 'en-US',
        gender: 'female',
        styles: ['General', 'Friendly'],
      },
      {
        upstreamId: 'bg-BG-BorislavNeural',
        locale: 'bg-BG',
        gender: 'male',
        styles: ['General'],
      },
    ]);
  });

  it('rejects malformed or duplicate service records instead of inferring metadata', () => {
    expect(() =>
      normalizeEdgeSnapshot([
        { ShortName: 'en-US-AdaNeural', Locale: 'en-US', Gender: 'Unknown', VoiceTag: {} },
      ]),
    ).toThrow(/gender/i);
    expect(() =>
      normalizeEdgeSnapshot([
        { upstreamId: 'same', locale: 'en-US', gender: 'female', styles: [] },
        { upstreamId: 'same', locale: 'en-US', gender: 'female', styles: [] },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('renders the checked-in static snapshot byte for byte', async () => {
    expect(await readFile(launchDataUrl, 'utf8')).toBe(
      renderEdgeSnapshotModule(EDGE_VOICE_SNAPSHOT),
    );
  });

  it('reports a canonical hash and a reviewable add/change/remove diff', () => {
    const review = computeEdgeSnapshotReview(
      [
        { upstreamId: 'a', locale: 'en-US', gender: 'female', styles: [] },
        { upstreamId: 'b', locale: 'en-GB', gender: 'male', styles: [] },
      ],
      [
        { upstreamId: 'b', locale: 'en-GB', gender: 'female', styles: [] },
        { upstreamId: 'c', locale: 'fr-FR', gender: 'female', styles: [] },
      ],
    );

    expect(review.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(review.added).toEqual(['c']);
    expect(review.removed).toEqual(['a']);
    expect(review.changed).toEqual(['b']);
  });
});
