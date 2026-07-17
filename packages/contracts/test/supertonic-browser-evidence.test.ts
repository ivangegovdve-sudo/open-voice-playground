import { describe, expect, it } from 'vitest';

import { SupertonicBrowserEvidenceLedgerSchema } from '../src/supertonic-browser-evidence.js';

const INITIAL_LEDGER = {
  schemaVersion: 1,
  kind: 'open-voice-supertonic-browser-evidence-ledger',
  engineId: 'supertonic',
  operationalStatus: 'disabled',
  catalogSha256: 'sha256:b0246b36441b95f9ccd579bde76b6f0faf27efc6973ea3eb2bf1cba02b25fd2a',
  assetSetId: 'supertonic-browser-assets',
  manifestDigest: 'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
  tuples: [
    {
      tupleId: 'chrome-webgpu',
      browserFamily: 'chrome',
      backend: 'webgpu',
      selectionId: 'supertonic-webgpu',
      selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
      qualification: {
        status: 'not-run',
        reasonCode: 'production-qualification-not-run',
        detail: 'Production qualification has not been run.',
        evidence: null,
      },
    },
    {
      tupleId: 'chrome-wasm',
      browserFamily: 'chrome',
      backend: 'wasm',
      selectionId: 'supertonic-wasm',
      selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
      qualification: {
        status: 'not-run',
        reasonCode: 'production-qualification-not-run',
        detail: 'Production qualification has not been run.',
        evidence: null,
      },
    },
    {
      tupleId: 'edge-webgpu',
      browserFamily: 'edge',
      backend: 'webgpu',
      selectionId: 'supertonic-webgpu',
      selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
      qualification: {
        status: 'not-run',
        reasonCode: 'qualifying-edge-stable-host-unavailable',
        detail:
          'No qualifying Edge Stable host was available, so production qualification has not been run.',
        evidence: null,
      },
    },
    {
      tupleId: 'edge-wasm',
      browserFamily: 'edge',
      backend: 'wasm',
      selectionId: 'supertonic-wasm',
      selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
      qualification: {
        status: 'not-run',
        reasonCode: 'qualifying-edge-stable-host-unavailable',
        detail:
          'No qualifying Edge Stable host was available, so production qualification has not been run.',
        evidence: null,
      },
    },
  ],
} as const;

type MutableTuple = Record<string, unknown> & {
  qualification: Record<string, unknown>;
};

type MutableLedger = {
  schemaVersion: number;
  kind: string;
  engineId: string;
  operationalStatus: string;
  catalogSha256: string;
  assetSetId: string;
  manifestDigest: string;
  tuples: MutableTuple[];
  [key: string]: unknown;
};

function mutableLedger(): MutableLedger {
  return structuredClone(INITIAL_LEDGER) as unknown as MutableLedger;
}

describe('Supertonic browser production evidence ledger v1', () => {
  it('accepts only the exact truthful initial all-not-run ledger', () => {
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(INITIAL_LEDGER).success).toBe(true);

    for (const field of [
      'schemaVersion',
      'kind',
      'engineId',
      'operationalStatus',
      'assetSetId',
      'manifestDigest',
    ] as const) {
      const ledger = mutableLedger();
      Object.assign(ledger, { [field]: field === 'schemaVersion' ? 2 : 'other' });
      expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(ledger).success, field).toBe(false);
    }

    for (const catalogSha256 of ['sha256:not-a-digest', `sha256:${'A'.repeat(64)}`]) {
      const ledger = mutableLedger();
      ledger.catalogSha256 = catalogSha256;
      expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(ledger).success, catalogSha256).toBe(
        false,
      );
    }

    const extraRoot = mutableLedger();
    extraRoot.candidate = null;
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(extraRoot).success).toBe(false);

    const extraTuple = mutableLedger();
    extraTuple.tuples[0]!.browserVersion = '150.0.7871.128';
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(extraTuple).success).toBe(false);

    const extraQualification = mutableLedger();
    extraQualification.tuples[0]!.qualification.startedAt = '2026-07-17T00:00:00Z';
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(extraQualification).success).toBe(false);
  });

  it('requires the complete canonical tuple set in its fixed order', () => {
    const missing = mutableLedger();
    missing.tuples.pop();
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(missing).success).toBe(false);

    const duplicate = mutableLedger();
    duplicate.tuples[1] = structuredClone(duplicate.tuples[0]!);
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(duplicate).success).toBe(false);

    const reordered = mutableLedger();
    [reordered.tuples[0], reordered.tuples[1]] = [reordered.tuples[1]!, reordered.tuples[0]!];
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(reordered).success).toBe(false);

    const fifth = mutableLedger();
    fifth.tuples.push(structuredClone(fifth.tuples[0]!));
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(fifth).success).toBe(false);
  });

  it('binds every tuple identity and runtime selection to the frozen closure', () => {
    const mutations: ReadonlyArray<readonly [number, string, unknown]> = [
      [0, 'tupleId', 'edge-webgpu'],
      [0, 'browserFamily', 'edge'],
      [0, 'backend', 'wasm'],
      [0, 'selectionId', 'supertonic-wasm'],
      [0, 'selectionDigest', `sha256:${'0'.repeat(64)}`],
      [1, 'selectionDigest', INITIAL_LEDGER.tuples[0].selectionDigest],
      [2, 'selectionId', 'supertonic-wasm'],
      [3, 'browserFamily', 'chrome'],
    ];

    for (const [index, field, value] of mutations) {
      const ledger = mutableLedger();
      ledger.tuples[index]![field] = value;
      expect(
        SupertonicBrowserEvidenceLedgerSchema.safeParse(ledger).success,
        `${index}.${field}`,
      ).toBe(false);
    }
  });

  it('cannot encode attempted, failed, passed, or partially populated evidence', () => {
    for (const status of ['attempted', 'failed', 'passed']) {
      const ledger = mutableLedger();
      ledger.tuples[0]!.qualification.status = status;
      expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(ledger).success, status).toBe(false);
    }

    const nonNullEvidence = mutableLedger();
    nonNullEvidence.tuples[0]!.qualification.evidence = {};
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(nonNullEvidence).success).toBe(false);

    const wrongChromeReason = mutableLedger();
    wrongChromeReason.tuples[0]!.qualification.reasonCode =
      'qualifying-edge-stable-host-unavailable';
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(wrongChromeReason).success).toBe(false);

    const wrongEdgeReason = mutableLedger();
    wrongEdgeReason.tuples[2]!.qualification.reasonCode = 'production-qualification-not-run';
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(wrongEdgeReason).success).toBe(false);

    const fabricatedDetail = mutableLedger();
    fabricatedDetail.tuples[0]!.qualification.detail = 'Chrome passed.';
    expect(SupertonicBrowserEvidenceLedgerSchema.safeParse(fabricatedDetail).success).toBe(false);
  });
});
