import { describe, expect, it } from 'vitest';

import * as protocol from '../src/generated/protocol.js';

const schemaNames = [
  'CanonicalDateTime',
  'CanonicalUuid',
  'ClientLabel',
  'ClientVersion',
  'DeepLinkChallengeRequest',
  'EngineListResponse',
  'EngineResponse',
  'HealthResponse',
  'JobCreateRequest',
  'JobResponse',
  'ManualChallengeRequest',
  'OpaqueSecret',
  'OperationalState',
  'PackActionRequest',
  'PackActionResponse',
  'PackId',
  'PackListResponse',
  'PackResponse',
  'PairingChallengeRequest',
  'PairingChallengeResponse',
  'PairingResponse',
  'Problem',
  'ProblemCode',
  'RedeemPendingResponse',
  'RedeemRequest',
  'RedeemResponse',
  'RuntimeResponse',
  'Scope',
  'ScopeList',
  'SynthesisText',
  'VoiceId',
  'VoiceListResponse',
  'VoiceResponse',
] as const;

type RuntimeProtocol = Record<string, unknown> & {
  ProtocolValidationError: new (...args: never[]) => Error;
};

const runtime = protocol as RuntimeProtocol;

function guard(name: string, value: unknown): boolean {
  return (runtime[`is${name}`] as (candidate: unknown) => boolean)(value);
}

function parse(name: string, value: unknown): unknown {
  return (runtime[`parse${name}`] as (candidate: unknown) => unknown)(value);
}

const uuid = '123e4567-e89b-12d3-a456-426614174000';
const timestamp = '2028-02-29T23:59:59.123+03:00';
const opaqueSecret = 'A'.repeat(43);
const scopes = [
  'health:read',
  'runtime:read',
  'synthesis:create',
  'jobs:read',
  'jobs:cancel',
  'audio:read',
  'packs:request',
];
const voiceIds = [
  'pocket:alba',
  'pocket:estelle',
  'pocket:anna',
  'pocket:vera',
  'pocket:fantine',
  'pocket:charles',
  'pocket:paul',
  'pocket:eponine',
  'pocket:azelma',
  'pocket:george',
  'pocket:mary',
  'pocket:jane',
  'pocket:michael',
  'pocket:eve',
  'pocket:bill_boerst',
  'pocket:caro_davy',
  'pocket:peter_yearsley',
  'pocket:stuart_bell',
  'pocket:marius',
  'pocket:javert',
];

const pairing = {
  id: uuid,
  clientLabel: 'Browser playground',
  scopes,
  createdAt: timestamp,
  lastUsedAt: timestamp,
};
const deepLinkChallenge = {
  state: opaqueSecret,
  verifierHash: opaqueSecret,
  clientLabel: 'Browser playground',
  scopes,
};
const engine = {
  id: 'pocket',
  state: 'pack-unverified',
  operational: false,
};
const pack = {
  id: 'pocket-companion-pack',
  state: 'pack-unverified',
  verified: false,
  operational: false,
};
const voices = voiceIds.map((id) => ({
  id,
  engineId: 'pocket',
  availableInPack: true,
  operational: false,
}));
const validValues = {
  CanonicalDateTime: timestamp,
  CanonicalUuid: uuid,
  ClientLabel: 'Browser playground',
  ClientVersion: '1.0.0',
  DeepLinkChallengeRequest: deepLinkChallenge,
  EngineListResponse: { engines: [engine] },
  EngineResponse: engine,
  HealthResponse: {
    app: 'open-voice-companion',
    protocolMajor: 1,
    listenerState: 'listening',
  },
  JobCreateRequest: { voiceId: 'pocket:alba', text: 'Exact text' },
  JobResponse: {
    id: uuid,
    voiceId: 'pocket:alba',
    state: 'queued',
    audioAvailable: false,
    createdAt: timestamp,
  },
  ManualChallengeRequest: {
    code: '23456789ABCD',
    verifierHash: opaqueSecret,
    clientLabel: 'Browser playground',
    scopes,
  },
  OpaqueSecret: opaqueSecret,
  OperationalState: 'pack-unverified',
  PackActionRequest: { action: 'install' },
  PackActionResponse: {
    id: uuid,
    packId: 'pocket-companion-pack',
    action: 'install',
    state: 'pending-native-decision',
  },
  PackId: 'pocket-companion-pack',
  PackListResponse: { packs: [pack] },
  PackResponse: pack,
  PairingChallengeRequest: deepLinkChallenge,
  PairingChallengeResponse: { id: uuid, state: 'pending', expiresAt: timestamp },
  PairingResponse: pairing,
  Problem: {
    type: 'urn:ovp:problem:schema-invalid',
    title: 'Invalid request',
    status: 400,
    detail: 'The request body does not match the protocol schema.',
    instance: `urn:uuid:${uuid}`,
    code: 'schema-invalid',
    requestId: uuid,
  },
  ProblemCode: 'schema-invalid',
  RedeemPendingResponse: { state: 'pending' },
  RedeemRequest: { verifier: opaqueSecret },
  RedeemResponse: { token: opaqueSecret, pairing },
  RuntimeResponse: {
    engineId: 'pocket',
    state: 'pack-unverified',
    operational: false,
    reason: 'pack-unverified',
  },
  Scope: 'health:read',
  ScopeList: scopes,
  SynthesisText: 'Exact text',
  VoiceId: 'pocket:alba',
  VoiceListResponse: { voices },
  VoiceResponse: voices[0],
} satisfies Record<(typeof schemaNames)[number], unknown>;

describe('generated companion protocol validators', () => {
  it('exports the complete normalized HTTP contract alongside concrete client routes', () => {
    expect(runtime.HTTP_CONTRACT).toBeTypeOf('object');
    expect(Object.keys(runtime.HTTP_CONTRACT as object)).toEqual([
      'version',
      'policy',
      'paths',
      'operations',
    ]);
    expect(protocol.ROUTES).toEqual({
      cancelJob: 'DELETE /v1/jobs/{id}',
      createJob: 'POST /v1/jobs',
      createPairingChallenge: 'POST /v1/pairings/challenges',
      getCurrentPairing: 'GET /v1/pairings/current',
      getHealth: 'GET /v1/health',
      getJob: 'GET /v1/jobs/{id}',
      getJobAudio: 'GET /v1/jobs/{id}/audio',
      getRuntime: 'GET /v1/runtime',
      listEngines: 'GET /v1/engines',
      listPacks: 'GET /v1/packs',
      listVoices: 'GET /v1/voices',
      redeemPairingChallenge: 'POST /v1/pairings/challenges/{id}/redeem',
      requestPackAction: 'POST /v1/packs/{id}/actions',
      revokeCurrentPairing: 'DELETE /v1/pairings/current',
    });
  });

  it('generates a strict guard and parser for every owned schema', () => {
    expect(runtime.ProtocolValidationError).toBeTypeOf('function');
    for (const name of schemaNames) {
      expect(runtime[`is${name}`], `is${name}`).toBeTypeOf('function');
      expect(runtime[`parse${name}`], `parse${name}`).toBeTypeOf('function');
    }
  });

  it('accepts and preserves one positive value for every owned schema', () => {
    for (const name of schemaNames) {
      const value = validValues[name];
      expect(guard(name, value), name).toBe(true);
      expect(parse(name, value), name).toBe(value);
    }
  });

  it.each([
    ['pattern scalar', 'OpaqueSecret', 'short'],
    ['enum scalar', 'VoiceId', 'unknown:voice'],
    ['const scalar', 'PackId', 'other-pack'],
    ['oneOf', 'PairingChallengeRequest', {}],
    ['required object', 'JobCreateRequest', { voiceId: 'pocket:alba' }],
    ['closed object', 'HealthResponse', { ...validValues.HealthResponse, extra: true }],
    ['bounded array', 'EngineListResponse', { engines: [] }],
    ['unique array', 'ScopeList', [...scopes.slice(0, 6), 'health:read']],
    ['bounded integer', 'Problem', { ...validValues.Problem, status: 399 }],
    ['formatted scalar', 'PairingResponse', { ...pairing, id: uuid.toUpperCase() }],
    ['nested const', 'RuntimeResponse', { ...validValues.RuntimeResponse, operational: true }],
  ])('rejects a representative invalid %s value', (_family, name, value) => {
    expect(guard(name, value)).toBe(false);
    expect(() => parse(name, value)).toThrow(runtime.ProtocolValidationError);
  });

  it('accepts a valid job without cloning it and rejects missing, extra, or raw voice fields', () => {
    const valid = { voiceId: 'pocket:alba', text: 'Exact text' };
    expect(parse('JobCreateRequest', valid)).toBe(valid);
    expect(guard('JobCreateRequest', valid)).toBe(true);
    expect(guard('JobCreateRequest', { voiceId: 'pocket:alba' })).toBe(false);
    expect(guard('JobCreateRequest', { ...valid, extra: true })).toBe(false);
    expect(guard('JobCreateRequest', { voiceId: 'alba', text: 'Exact text' })).toBe(false);
  });

  it('enforces canonical UUID and calendar-aware RFC 3339 date-time formats', () => {
    const valid = { id: uuid, state: 'pending', expiresAt: '2028-02-29T23:59:59.123+03:00' };
    expect(guard('PairingChallengeResponse', valid)).toBe(true);

    for (const candidate of [
      { ...valid, id: uuid.toUpperCase() },
      { ...valid, id: '123e4567e89b12d3a456426614174000' },
      { ...valid, expiresAt: '2027-02-29T23:59:59Z' },
      { ...valid, expiresAt: '2028-02-29t23:59:59z' },
      { ...valid, expiresAt: '2028-02-29T24:00:00Z' },
      { ...valid, expiresAt: '2028-02-29T23:59:59' },
    ]) {
      expect(guard('PairingChallengeResponse', candidate)).toBe(false);
    }
  });

  it('enforces strict Problems, status bounds, patterns, codes, and unknown fields', () => {
    const valid = {
      type: 'urn:ovp:problem:schema-invalid',
      title: 'Invalid request',
      status: 400,
      detail: 'The request body does not match the protocol schema.',
      instance: `urn:uuid:${uuid}`,
      code: 'schema-invalid',
      requestId: uuid,
    };
    expect(guard('Problem', valid)).toBe(true);
    expect(guard('Problem', { ...valid, status: 399 })).toBe(false);
    expect(guard('Problem', { ...valid, status: 400.5 })).toBe(false);
    expect(guard('Problem', { ...valid, code: 'internal-exception' })).toBe(false);
    expect(guard('Problem', { ...valid, requestId: uuid.toUpperCase() })).toBe(false);
    expect(guard('Problem', { ...valid, stack: 'secret' })).toBe(false);
  });

  it('uses JSON deep equality for array uniqueness', () => {
    expect(guard('ScopeList', scopes)).toBe(true);
    expect(guard('ScopeList', [...scopes.slice(0, 6), 'health:read'])).toBe(false);
  });

  it('rejects non-JSON, inherited, accessor, symbol, cyclic, and ill-formed string inputs safely', () => {
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    inherited.voiceId = 'pocket:alba';
    inherited.text = 'hello';
    expect(guard('JobCreateRequest', inherited)).toBe(false);

    let getterCalls = 0;
    const accessor = { voiceId: 'pocket:alba' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'text', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'must not execute';
      },
    });
    expect(guard('JobCreateRequest', accessor)).toBe(false);
    expect(getterCalls).toBe(0);

    const symbolValue = { voiceId: 'pocket:alba', text: 'hello', [Symbol('secret')]: true };
    expect(guard('JobCreateRequest', symbolValue)).toBe(false);

    const cyclic: Record<string, unknown> = { voiceId: 'pocket:alba', text: 'hello' };
    cyclic.cycle = cyclic;
    expect(guard('JobCreateRequest', cyclic)).toBe(false);

    expect(guard('JobCreateRequest', { voiceId: 'pocket:alba', text: '\ud800' })).toBe(false);
    expect(guard('Problem', Number.NaN)).toBe(false);
    expect(guard('Problem', BigInt(1))).toBe(false);
  });

  it('never throws from guards and parser errors expose only owned schema paths', () => {
    const marker = 'plaintext-secret-must-not-escape';
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(marker);
        },
      },
    );
    expect(() => guard('JobCreateRequest', proxy)).not.toThrow();
    expect(guard('JobCreateRequest', proxy)).toBe(false);

    let caught: unknown;
    try {
      parse('JobCreateRequest', { voiceId: 'pocket:alba', text: marker, unknown: marker });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(runtime.ProtocolValidationError);
    expect(String(caught)).toContain('JobCreateRequest');
    expect(String(caught)).not.toContain(marker);
  });
});
