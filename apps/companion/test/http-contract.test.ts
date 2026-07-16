import { describe, expect, it, vi } from 'vitest';

import { buildHttpContract } from '../scripts/http-contract.mjs';
import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';
import * as generated from '../src/generated/protocol.js';

type JsonRecord = Record<string, unknown>;

const byCodeUnit = ([left]: readonly [string, unknown], [right]: readonly [string, unknown]) =>
  left < right ? -1 : left > right ? 1 : 0;
const sortedRecord = <Value>(entries: readonly (readonly [string, Value])[]) =>
  Object.fromEntries([...entries].sort(byCodeUnit));

const failureMap = sortedRecord([
  ['missing-origin', { status: 400, code: 'origin-missing' }],
  ['denied-origin', { status: 403, code: 'origin-denied' }],
  ['duplicate-preflight-header', { status: 400, code: 'duplicate-header' }],
  ['invalid-preflight-shape', { status: 400, code: 'schema-invalid' }],
  ['unsupported-route-method', { status: 405, code: 'method-not-allowed' }],
  ['oversize-body', { status: 413, code: 'body-too-large' }],
  ['header-timeout', { status: 408, code: 'header-timeout' }],
  ['request-line-too-large', { status: 414, code: 'request-line-too-large' }],
  ['headers-too-large', { status: 431, code: 'headers-too-large' }],
  ['admission-overload', { status: 503, code: 'queue-full' }],
]);

const policy = {
  version: 1,
  allowedOriginSource: 'compiled-exact-allowlist',
  credentials: 'prohibited',
  actual: {
    allowOrigin: 'validated-origin',
    exposeHeaders: ['ETag', 'Location', 'Retry-After', 'X-Request-Id'],
    vary: ['Origin'],
  },
  preflight: {
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-OVP-Client-Version'],
    maxAgeSeconds: 600,
    requestedHeaderComparison: 'ascii-case-insensitive-exact-set',
    requiresDeclaredConcreteTarget: true,
    rejectsBody: true,
    rejectsCredentials: true,
    rejectsOptionsTarget: true,
    failureMap,
    legacyPrivateNetwork: {
      requestHeader: 'Access-Control-Request-Private-Network',
      requestValue: 'true',
      responseHeader: 'Access-Control-Allow-Private-Network',
      responseValue: 'true',
      varyToken: 'Access-Control-Request-Private-Network',
      emitIffRequested: true,
    },
  },
  unknownRoute: { status: 404, code: 'resource-not-found' },
  retryAfter: {
    kind: 'delay-seconds',
    minimum: 1,
    maximum: 3600,
    httpDateAllowed: false,
    queueFullProblemCode: 'queue-full',
    queueFullResponseCondition: 'queue-full-problem',
  },
  problemCodes: {
    http: [
      'host-invalid',
      'origin-missing',
      'origin-denied',
      'version-missing',
      'version-unsupported',
      'auth-missing',
      'auth-invalid',
      'auth-origin-mismatch',
      'scope-denied',
      'rate-limited',
      'request-line-too-large',
      'headers-too-large',
      'body-too-large',
      'body-timeout',
      'header-timeout',
      'schema-invalid',
      'queue-full',
      'ownership-denied',
      'resource-not-found',
      'conflict',
      'handler-timeout',
      'pairing-not-found',
      'pairing-denied',
      'pairing-expired',
      'pairing-consumed',
      'pairing-attempts-exhausted',
      'pack-unverified',
      'runtime-unavailable',
      'method-not-allowed',
      'content-type-unsupported',
      'transfer-encoding-invalid',
      'duplicate-header',
      'text-invalid',
      'action-invalid',
    ],
    nonHttp: ['listener-conflict'],
  },
} as const;

const statuses = {
  getHealth: [200, 400, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  createPairingChallenge: [
    201, 400, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504,
  ],
  redeemPairingChallenge: [
    200, 202, 400, 403, 404, 405, 408, 409, 410, 413, 414, 415, 426, 429, 431, 503, 504,
  ],
  getCurrentPairing: [200, 400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  revokeCurrentPairing: [204, 400, 401, 403, 405, 408, 413, 414, 426, 431, 503, 504],
  getRuntime: [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  listEngines: [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  listVoices: [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  listPacks: [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  createJob: [202, 400, 401, 403, 405, 408, 413, 414, 415, 426, 429, 431, 503, 504],
  getJob: [200, 400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504],
  cancelJob: [202, 400, 401, 403, 404, 405, 408, 413, 414, 426, 431, 503, 504],
  getJobAudio: [200, 400, 401, 403, 404, 405, 408, 409, 410, 413, 414, 426, 429, 431, 503, 504],
  requestPackAction: [
    202, 400, 401, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504,
  ],
} as const;

type ConcreteId = keyof typeof statuses;
type Body =
  | { kind: 'empty' }
  | { kind: 'json'; mediaType: 'application/json' | 'application/problem+json'; schemaRef: string }
  | { kind: 'audio'; mediaType: 'audio/wav'; maxBytes: number };
type Spec = {
  id: ConcreteId;
  path: string;
  method: 'GET' | 'POST' | 'DELETE';
  auth: 'origin-only' | 'bearer';
  scope: string | null;
  ownership: 'none' | 'token-self' | 'job-owner';
  body?: string;
  pathSchema?: string;
};

const specs: readonly Spec[] = [
  {
    id: 'getHealth',
    path: '/v1/health',
    method: 'GET',
    auth: 'origin-only',
    scope: null,
    ownership: 'none',
  },
  {
    id: 'createPairingChallenge',
    path: '/v1/pairings/challenges',
    method: 'POST',
    auth: 'origin-only',
    scope: null,
    ownership: 'none',
    body: 'PairingChallengeRequest',
  },
  {
    id: 'redeemPairingChallenge',
    path: '/v1/pairings/challenges/{id}/redeem',
    method: 'POST',
    auth: 'origin-only',
    scope: null,
    ownership: 'none',
    body: 'RedeemRequest',
    pathSchema: 'CanonicalUuid',
  },
  {
    id: 'getCurrentPairing',
    path: '/v1/pairings/current',
    method: 'GET',
    auth: 'bearer',
    scope: null,
    ownership: 'token-self',
  },
  {
    id: 'revokeCurrentPairing',
    path: '/v1/pairings/current',
    method: 'DELETE',
    auth: 'bearer',
    scope: null,
    ownership: 'token-self',
  },
  {
    id: 'getRuntime',
    path: '/v1/runtime',
    method: 'GET',
    auth: 'bearer',
    scope: 'runtime:read',
    ownership: 'none',
  },
  {
    id: 'listEngines',
    path: '/v1/engines',
    method: 'GET',
    auth: 'bearer',
    scope: 'runtime:read',
    ownership: 'none',
  },
  {
    id: 'listVoices',
    path: '/v1/voices',
    method: 'GET',
    auth: 'bearer',
    scope: 'runtime:read',
    ownership: 'none',
  },
  {
    id: 'listPacks',
    path: '/v1/packs',
    method: 'GET',
    auth: 'bearer',
    scope: 'runtime:read',
    ownership: 'none',
  },
  {
    id: 'createJob',
    path: '/v1/jobs',
    method: 'POST',
    auth: 'bearer',
    scope: 'synthesis:create',
    ownership: 'none',
    body: 'JobCreateRequest',
  },
  {
    id: 'getJob',
    path: '/v1/jobs/{id}',
    method: 'GET',
    auth: 'bearer',
    scope: 'jobs:read',
    ownership: 'job-owner',
    pathSchema: 'CanonicalUuid',
  },
  {
    id: 'cancelJob',
    path: '/v1/jobs/{id}',
    method: 'DELETE',
    auth: 'bearer',
    scope: 'jobs:cancel',
    ownership: 'job-owner',
    pathSchema: 'CanonicalUuid',
  },
  {
    id: 'getJobAudio',
    path: '/v1/jobs/{id}/audio',
    method: 'GET',
    auth: 'bearer',
    scope: 'audio:read',
    ownership: 'job-owner',
    pathSchema: 'CanonicalUuid',
  },
  {
    id: 'requestPackAction',
    path: '/v1/packs/{id}/actions',
    method: 'POST',
    auth: 'bearer',
    scope: 'packs:request',
    ownership: 'none',
    body: 'PackActionRequest',
    pathSchema: 'PackId',
  },
] as const;

const preflightIds: Readonly<Record<string, string>> = {
  '/v1/health': 'preflightHealth',
  '/v1/pairings/challenges': 'preflightPairingChallenges',
  '/v1/pairings/challenges/{id}/redeem': 'preflightPairingChallengeRedeem',
  '/v1/pairings/current': 'preflightCurrentPairing',
  '/v1/runtime': 'preflightRuntime',
  '/v1/engines': 'preflightEngines',
  '/v1/voices': 'preflightVoices',
  '/v1/packs': 'preflightPacks',
  '/v1/jobs': 'preflightJobs',
  '/v1/jobs/{id}': 'preflightJob',
  '/v1/jobs/{id}/audio': 'preflightJobAudio',
  '/v1/packs/{id}/actions': 'preflightPackActions',
};

const successBodies: Readonly<Record<ConcreteId, Readonly<Record<number, Body>>>> = {
  getHealth: { 200: { kind: 'json', mediaType: 'application/json', schemaRef: 'HealthResponse' } },
  createPairingChallenge: {
    201: { kind: 'json', mediaType: 'application/json', schemaRef: 'PairingChallengeResponse' },
  },
  redeemPairingChallenge: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'RedeemResponse' },
    202: { kind: 'json', mediaType: 'application/json', schemaRef: 'RedeemPendingResponse' },
  },
  getCurrentPairing: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'PairingResponse' },
  },
  revokeCurrentPairing: { 204: { kind: 'empty' } },
  getRuntime: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'RuntimeResponse' },
  },
  listEngines: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'EngineListResponse' },
  },
  listVoices: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'VoiceListResponse' },
  },
  listPacks: {
    200: { kind: 'json', mediaType: 'application/json', schemaRef: 'PackListResponse' },
  },
  createJob: { 202: { kind: 'json', mediaType: 'application/json', schemaRef: 'JobResponse' } },
  getJob: { 200: { kind: 'json', mediaType: 'application/json', schemaRef: 'JobResponse' } },
  cancelJob: { 202: { kind: 'json', mediaType: 'application/json', schemaRef: 'JobResponse' } },
  getJobAudio: { 200: { kind: 'audio', mediaType: 'audio/wav', maxBytes: 67_108_864 } },
  requestPackAction: {
    202: { kind: 'json', mediaType: 'application/json', schemaRef: 'PackActionResponse' },
  },
};

const header = (name: string, required: boolean, schema: JsonRecord, condition: string | null) => ({
  name,
  required,
  schema,
  condition,
});
const commonHeaders = () => [
  header('Cache-Control', true, { kind: 'const', type: 'string', value: 'no-store' }, null),
  header('X-Content-Type-Options', true, { kind: 'const', type: 'string', value: 'nosniff' }, null),
  header('X-Request-Id', true, { kind: 'schema-ref', schemaRef: 'CanonicalUuid' }, null),
];
const actualHeaders = () => [
  header(
    'Access-Control-Allow-Origin',
    false,
    { kind: 'bounded-string', minLength: 1, maxLength: 256 },
    'validated-origin',
  ),
  header(
    'Access-Control-Expose-Headers',
    false,
    { kind: 'const', type: 'string', value: 'ETag, Location, Retry-After, X-Request-Id' },
    'validated-origin',
  ),
  header('Vary', false, { kind: 'const', type: 'string', value: 'Origin' }, 'validated-origin'),
];
const sortHeaders = (headers: ReturnType<typeof header>[]) =>
  headers.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

function allowFor(path: string): ('GET' | 'POST' | 'DELETE' | 'OPTIONS')[] {
  const methods = specs.filter((spec) => spec.path === path).map((spec) => spec.method);
  return [...methods, 'OPTIONS'];
}

function concreteHeaders(spec: Spec, status: number) {
  const headers = [...commonHeaders(), ...actualHeaders()];
  if (status === 401) {
    headers.push(
      header(
        'WWW-Authenticate',
        true,
        { kind: 'const', type: 'string', value: 'Bearer realm="open-voice-companion"' },
        null,
      ),
    );
  }
  if (status === 405) {
    headers.push(
      header(
        'Allow',
        true,
        { kind: 'const', type: 'string', value: allowFor(spec.path).join(', ') },
        null,
      ),
    );
  }
  if (status === 429 || (spec.id === 'redeemPairingChallenge' && status === 202)) {
    headers.push(
      header('Retry-After', true, { kind: 'bounded-integer', minimum: 1, maximum: 3600 }, null),
    );
  }
  if (status === 503) {
    headers.push(
      header(
        'Retry-After',
        false,
        { kind: 'bounded-integer', minimum: 1, maximum: 3600 },
        'queue-full-problem',
      ),
    );
  }
  if (
    (spec.id === 'createPairingChallenge' && status === 201) ||
    (spec.id === 'createJob' && status === 202) ||
    (spec.id === 'requestPackAction' && status === 202)
  ) {
    headers.push(
      header('Location', true, { kind: 'bounded-string', minLength: 1, maxLength: 256 }, null),
    );
  }
  if (
    status === 200 &&
    ['getRuntime', 'listEngines', 'listVoices', 'listPacks', 'getJobAudio'].includes(spec.id)
  ) {
    headers.push(
      header('ETag', true, { kind: 'bounded-string', minLength: 3, maxLength: 128 }, null),
    );
  }
  return sortHeaders(headers);
}

function concreteOperation(spec: Spec) {
  return {
    path: spec.path,
    method: spec.method,
    clientCallable: true,
    allow: allowFor(spec.path),
    access: { auth: spec.auth, scope: spec.scope, ownership: spec.ownership },
    pathParameters: spec.pathSchema
      ? [{ name: 'id', required: true, schemaRef: spec.pathSchema }]
      : [],
    request: {
      headers: [
        {
          name: 'Origin',
          required: true,
          schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
        },
        {
          name: 'X-OVP-Client-Version',
          required: true,
          schema: { kind: 'schema-ref', schemaRef: 'ClientVersion' },
        },
      ],
      body: spec.body
        ? { kind: 'json', required: true, mediaType: 'application/json', schemaRef: spec.body }
        : { kind: 'none' },
    },
    preflight: null,
    responses: statuses[spec.id].map((status) => ({
      status,
      body:
        status >= 400
          ? { kind: 'json', mediaType: 'application/problem+json', schemaRef: 'Problem' }
          : successBodies[spec.id][status]!,
      headers: concreteHeaders(spec, status),
    })),
  };
}

function requestedHeaders(spec: Spec): string[] {
  const headers = [];
  if (spec.auth === 'bearer') headers.push('Authorization');
  if (spec.body !== undefined) headers.push('Content-Type');
  headers.push('X-OVP-Client-Version');
  return headers;
}

function preflightOperation(path: string) {
  const pathSpecs = specs.filter((spec) => spec.path === path);
  const allow = allowFor(path);
  const methodValues = allow;
  const methodSchema = { kind: 'enum', type: 'string', values: methodValues };
  const pathSchema = pathSpecs.find((spec) => spec.pathSchema !== undefined)?.pathSchema;
  const preflightHeaders = sortHeaders([
    header('Cache-Control', true, { kind: 'const', type: 'string', value: 'no-store' }, null),
    header(
      'Vary',
      true,
      {
        kind: 'const',
        type: 'string',
        value: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      },
      null,
    ),
    header(
      'X-Content-Type-Options',
      true,
      { kind: 'const', type: 'string', value: 'nosniff' },
      null,
    ),
    header('X-Request-Id', true, { kind: 'schema-ref', schemaRef: 'CanonicalUuid' }, null),
  ]);
  const successHeaders = sortHeaders([
    ...commonHeaders(),
    header(
      'Access-Control-Allow-Headers',
      true,
      { kind: 'const', type: 'string', value: 'Authorization, Content-Type, X-OVP-Client-Version' },
      null,
    ),
    header(
      'Access-Control-Allow-Methods',
      true,
      { kind: 'const', type: 'string', value: 'GET, POST, DELETE, OPTIONS' },
      null,
    ),
    header(
      'Access-Control-Allow-Origin',
      true,
      { kind: 'bounded-string', minLength: 1, maxLength: 256 },
      null,
    ),
    header(
      'Access-Control-Allow-Private-Network',
      false,
      { kind: 'const', type: 'string', value: 'true' },
      'legacy-private-network-requested',
    ),
    header('Access-Control-Max-Age', true, { kind: 'const', type: 'integer', value: 600 }, null),
    header(
      'Vary',
      true,
      {
        kind: 'enum',
        type: 'string',
        values: [
          'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
          'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
        ],
      },
      null,
    ),
  ]);
  const responses = [204, 400, 403, 405, 408, 413, 414, 431, 503].map((status) => {
    const headers = status === 204 ? successHeaders : [...preflightHeaders];
    if (status === 405) {
      headers.push(
        header('Allow', true, { kind: 'const', type: 'string', value: allow.join(', ') }, null),
      );
    }
    if (status === 503) {
      headers.push(
        header('Retry-After', true, { kind: 'bounded-integer', minimum: 1, maximum: 3600 }, null),
      );
    }
    return {
      status,
      body:
        status === 204
          ? { kind: 'empty' }
          : { kind: 'json', mediaType: 'application/problem+json', schemaRef: 'Problem' },
      headers: sortHeaders(headers),
    };
  });
  return {
    path,
    method: 'OPTIONS',
    clientCallable: false,
    allow,
    access: { auth: 'preflight', scope: null, ownership: 'none' },
    pathParameters: pathSchema ? [{ name: 'id', required: true, schemaRef: pathSchema }] : [],
    request: {
      headers: [
        {
          name: 'Access-Control-Request-Headers',
          required: true,
          schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
        },
        { name: 'Access-Control-Request-Method', required: true, schema: methodSchema },
        {
          name: 'Access-Control-Request-Private-Network',
          required: false,
          schema: { kind: 'const', type: 'string', value: 'true' },
        },
        {
          name: 'Origin',
          required: true,
          schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
        },
      ],
      body: { kind: 'none' },
    },
    preflight: {
      concreteMethods: pathSpecs.map((spec) => spec.method),
      requestedHeadersByMethod: sortedRecord(
        pathSpecs.map((spec) => [spec.method, requestedHeaders(spec)] as const),
      ),
    },
    responses,
  };
}

const uniquePaths = [...new Set(specs.map((spec) => spec.path))];
const paths = sortedRecord(
  uniquePaths.map((path) => [
    path,
    {
      allow: allowFor(path),
      concreteOperationIds: specs.filter((spec) => spec.path === path).map((spec) => spec.id),
      preflightOperationId: preflightIds[path]!,
    },
  ]),
);
const operations = sortedRecord([
  ...specs.map((spec) => [spec.id, concreteOperation(spec)] as const),
  ...uniquePaths.map((path) => [preflightIds[path]!, preflightOperation(path)] as const),
]);

export const expectedHttpContract = {
  version: 1,
  policy,
  paths,
  operations,
} as const;

describe('complete normalized HTTP contract', () => {
  it('matches the independently authored whole operation, status, body, header, access, and preflight object', async () => {
    const document = await loadOpenApiDocument();
    expect(buildHttpContract(document)).toEqual(expectedHttpContract);
    expect((generated as unknown as { HTTP_CONTRACT?: unknown }).HTTP_CONTRACT).toEqual(
      expectedHttpContract,
    );
  });

  it('normalizes dynamic maps by ASCII code unit without filesystem or network work', async () => {
    const document = structuredClone((await loadOpenApiDocument()) as JsonRecord) as JsonRecord & {
      paths: Record<string, JsonRecord>;
      components: {
        headers: Record<string, JsonRecord>;
        parameters: Record<string, JsonRecord>;
        responses: Record<string, JsonRecord>;
      };
      'x-ovp-http-policy': JsonRecord & {
        accessByOperation: Record<string, JsonRecord>;
        preflight: JsonRecord & { failureMap: Record<string, JsonRecord> };
      };
    };
    document.paths = Object.fromEntries(Object.entries(document.paths).reverse());
    document.components.headers = Object.fromEntries(
      Object.entries(document.components.headers).reverse(),
    );
    document.components.parameters = Object.fromEntries(
      Object.entries(document.components.parameters).reverse(),
    );
    document.components.responses = Object.fromEntries(
      Object.entries(document.components.responses).reverse(),
    );
    for (const response of Object.values(document.components.responses)) {
      if (response.headers !== null && typeof response.headers === 'object') {
        response.headers = Object.fromEntries(
          Object.entries(response.headers as Record<string, unknown>).reverse(),
        );
      }
    }
    const policy = document['x-ovp-http-policy'];
    policy.accessByOperation = Object.fromEntries(
      Object.entries(policy.accessByOperation).reverse(),
    );
    policy.actual = Object.fromEntries(Object.entries(policy.actual as JsonRecord).reverse());
    policy.unknownRoute = Object.fromEntries(
      Object.entries(policy.unknownRoute as JsonRecord).reverse(),
    );
    policy.retryAfter = Object.fromEntries(
      Object.entries(policy.retryAfter as JsonRecord).reverse(),
    );
    policy.problemCodes = Object.fromEntries(
      Object.entries(policy.problemCodes as JsonRecord).reverse(),
    );
    policy.preflight.legacyPrivateNetwork = Object.fromEntries(
      Object.entries(policy.preflight.legacyPrivateNetwork as JsonRecord).reverse(),
    );
    policy.preflight.failureMap = Object.fromEntries(
      Object.entries(policy.preflight.failureMap)
        .reverse()
        .map(([name, value]) => [name, Object.fromEntries(Object.entries(value).reverse())]),
    );
    policy.preflight = Object.fromEntries(
      Object.entries(policy.preflight).reverse(),
    ) as typeof policy.preflight;
    document['x-ovp-http-policy'] = Object.fromEntries(
      Object.entries(policy).reverse(),
    ) as typeof policy;
    const fetchSpy = vi.fn(() => {
      throw new Error('HTTP normalization must not use the network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const normalizedContract = buildHttpContract(document);
      expect(normalizedContract).toEqual(expectedHttpContract);
      expect(JSON.stringify(normalizedContract)).toBe(JSON.stringify(expectedHttpContract));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
