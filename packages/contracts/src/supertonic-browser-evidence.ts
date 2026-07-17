import { z } from 'zod';

import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
} from './index.js';

function freezeEvidenceTrustAnchor<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeEvidenceTrustAnchor(nested);
  Object.freeze(value);
  return value;
}

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const SUPERTONIC_BROWSER_EVIDENCE_LEDGER_KIND =
  'open-voice-supertonic-browser-evidence-ledger' as const;

export const SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES = freezeEvidenceTrustAnchor([
  {
    tupleId: 'chrome-webgpu',
    browserFamily: 'chrome',
    backend: 'webgpu',
    selectionId: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
    selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionDigest,
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
    selectionId: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
    selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionDigest,
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
    selectionId: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
    selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionDigest,
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
    selectionId: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
    selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionDigest,
    qualification: {
      status: 'not-run',
      reasonCode: 'qualifying-edge-stable-host-unavailable',
      detail:
        'No qualifying Edge Stable host was available, so production qualification has not been run.',
      evidence: null,
    },
  },
] as const);

function createSupertonicNotRunTupleSchema<
  const Tuple extends (typeof SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES)[number],
>(tuple: Tuple) {
  return z
    .object({
      tupleId: z.literal(tuple.tupleId),
      browserFamily: z.literal(tuple.browserFamily),
      backend: z.literal(tuple.backend),
      selectionId: z.literal(tuple.selectionId),
      selectionDigest: z.literal(tuple.selectionDigest),
      qualification: z
        .object({
          status: z.literal(tuple.qualification.status),
          reasonCode: z.literal(tuple.qualification.reasonCode),
          detail: z.literal(tuple.qualification.detail),
          evidence: z.null(),
        })
        .strict(),
    })
    .strict();
}

export const SupertonicBrowserEvidenceLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(SUPERTONIC_BROWSER_EVIDENCE_LEDGER_KIND),
    engineId: z.literal('supertonic'),
    operationalStatus: z.literal('disabled'),
    catalogSha256: Sha256Schema,
    assetSetId: z.literal(SUPERTONIC_ASSET_SET_ID),
    manifestDigest: z.literal(SUPERTONIC_MANIFEST_DIGEST),
    tuples: z.tuple([
      createSupertonicNotRunTupleSchema(SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES[0]),
      createSupertonicNotRunTupleSchema(SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES[1]),
      createSupertonicNotRunTupleSchema(SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES[2]),
      createSupertonicNotRunTupleSchema(SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES[3]),
    ]),
  })
  .strict();

export type SupertonicBrowserEvidenceLedger = z.infer<typeof SupertonicBrowserEvidenceLedgerSchema>;
