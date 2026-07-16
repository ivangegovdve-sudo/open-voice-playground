import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';

const root = resolve(import.meta.dirname, '..');
const openApiPath = resolve(root, 'openapi/openapi.yaml');

type SchemaObject = Record<string, unknown> & { enum?: unknown[] };

interface OpenApiDocument {
  openapi: string;
  jsonSchemaDialect: string;
  servers: { url: string }[];
  'x-protocol-major': number;
  paths: Record<string, Record<string, unknown>>;
  components: {
    headers: Record<string, Record<string, unknown>>;
    responses: Record<string, Record<string, unknown>>;
    schemas: Record<string, SchemaObject> & {
      ProblemCode: SchemaObject;
      VoiceId: SchemaObject;
    };
  };
}

function responseFor(
  document: OpenApiDocument,
  operationId: string,
  status: number,
): Record<string, unknown> {
  for (const item of Object.values(document.paths)) {
    for (const candidate of Object.values(item)) {
      if (candidate === null || typeof candidate !== 'object') continue;
      const operation = candidate as Record<string, unknown>;
      if (operation.operationId !== operationId) continue;
      const response = (operation.responses as Record<string, Record<string, unknown>>)[
        String(status)
      ]!;
      if ('$ref' in response) {
        const name = String(response.$ref).replace('#/components/responses/', '');
        return document.components.responses[name]!;
      }
      return response;
    }
  }
  throw new Error(`Missing ${operationId} ${status} response.`);
}

function headerNames(response: Record<string, unknown>): string[] {
  return Object.keys((response.headers ?? {}) as object).sort();
}

const expectedVoices = [
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
] as const;

const expectedRoutes = [
  'GET /v1/health',
  'OPTIONS /v1/health',
  'POST /v1/pairings/challenges',
  'OPTIONS /v1/pairings/challenges',
  'POST /v1/pairings/challenges/{id}/redeem',
  'OPTIONS /v1/pairings/challenges/{id}/redeem',
  'GET /v1/pairings/current',
  'DELETE /v1/pairings/current',
  'OPTIONS /v1/pairings/current',
  'GET /v1/runtime',
  'OPTIONS /v1/runtime',
  'GET /v1/engines',
  'OPTIONS /v1/engines',
  'GET /v1/voices',
  'OPTIONS /v1/voices',
  'GET /v1/packs',
  'OPTIONS /v1/packs',
  'POST /v1/jobs',
  'OPTIONS /v1/jobs',
  'GET /v1/jobs/{id}',
  'DELETE /v1/jobs/{id}',
  'OPTIONS /v1/jobs/{id}',
  'GET /v1/jobs/{id}/audio',
  'OPTIONS /v1/jobs/{id}/audio',
  'POST /v1/packs/{id}/actions',
  'OPTIONS /v1/packs/{id}/actions',
];

const expectedStatuses = {
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
  preflightHealth: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightPairingChallenges: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightPairingChallengeRedeem: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightCurrentPairing: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightRuntime: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightEngines: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightVoices: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightPacks: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightJobs: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightJob: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightJobAudio: [204, 400, 403, 405, 408, 413, 414, 431, 503],
  preflightPackActions: [204, 400, 403, 405, 408, 413, 414, 431, 503],
} as const;

const requiredProblemCodes = [
  'host-invalid',
  'origin-denied',
  'version-unsupported',
  'auth-invalid',
  'rate-limited',
  'body-too-large',
  'schema-invalid',
  'queue-full',
  'ownership-denied',
  'resource-not-found',
  'conflict',
  'handler-timeout',
  'listener-conflict',
  'pairing-denied',
  'pairing-expired',
  'pack-unverified',
  'runtime-unavailable',
];

function collectPropertyNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPropertyNames(item, names);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.properties !== null && typeof record.properties === 'object') {
      for (const name of Object.keys(record.properties as object)) names.add(name);
    }
    for (const child of Object.values(record)) collectPropertyNames(child, names);
  }
  return names;
}

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertStrictObjects(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.type === 'object') expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) assertStrictObjects(child);
}

describe('authoritative companion OpenAPI', () => {
  it('defines the strict fail-closed v1 surface', async () => {
    expect(existsSync(openApiPath), 'authoritative OpenAPI document is missing').toBe(true);
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    expect(document.openapi).toBe('3.1.2');
    expect(document.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document.servers).toEqual([{ url: 'http://127.0.0.1:17843' }]);
    expect(document['x-protocol-major']).toBe(1);

    assertStrictObjects(document.components.schemas);
    const routes = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item as object)
        .filter((method) => ['get', 'post', 'delete', 'options'].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(routes).toEqual(expectedRoutes);
    expect(document.components.schemas.VoiceId.enum).toEqual(expectedVoices);
    expect(document.components.schemas.ProblemCode.enum).toEqual(
      expect.arrayContaining(requiredProblemCodes),
    );

    const forbidden = new Set([
      'control',
      'controls',
      'path',
      'url',
      'command',
      'model',
      'outputname',
      'prompt',
      'referenceaudio',
      'upload',
      'cloning',
    ]);
    expect(
      [...collectPropertyNames(document.components.schemas)].filter((name) =>
        forbidden.has(name.toLowerCase()),
      ),
    ).toEqual([]);
  });

  it('declares the complete exact status matrix without ranges or defaults', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const observed: Record<string, number[]> = {};
    for (const item of Object.values(document.paths)) {
      for (const [method, candidate] of Object.entries(item)) {
        if (!['get', 'post', 'delete', 'options'].includes(method)) continue;
        const operation = candidate as { operationId: string; responses: Record<string, unknown> };
        observed[operation.operationId] = Object.keys(operation.responses)
          .map(Number)
          .sort((a, b) => a - b);
      }
    }
    expect(observed).toEqual(expectedStatuses);
  });

  it('declares exact actual CORS, common, and status-specific response headers', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    expect(headerNames(responseFor(document, 'getHealth', 200))).toEqual([
      'Access-Control-Allow-Origin',
      'Access-Control-Expose-Headers',
      'Cache-Control',
      'Vary',
      'X-Content-Type-Options',
      'X-Request-Id',
    ]);
    expect(headerNames(responseFor(document, 'getCurrentPairing', 401))).toContain(
      'WWW-Authenticate',
    );
    expect(headerNames(responseFor(document, 'getHealth', 405))).toContain('Allow');
    expect(headerNames(responseFor(document, 'getHealth', 429))).toContain('Retry-After');
    expect(headerNames(responseFor(document, 'getHealth', 503))).toContain('Retry-After');
  });

  it('declares route-aware empty OPTIONS with exact CORS, Vary, and legacy private-network metadata', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const options = document.paths['/v1/health']!.options as Record<string, unknown> | undefined;
    expect(options?.security).toEqual([]);
    expect(options?.requestBody).toBeUndefined();
    expect(
      (options?.parameters as { $ref: string }[] | undefined)?.map((entry) => entry.$ref),
    ).toEqual([
      '#/components/parameters/Origin',
      '#/components/parameters/PreflightGetMethod',
      '#/components/parameters/PreflightHeaders',
      '#/components/parameters/PreflightPrivateNetwork',
    ]);
    const success = responseFor(document, 'preflightHealth', 204);
    expect(success.content).toBeUndefined();
    expect(headerNames(success)).toEqual([
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Private-Network',
      'Access-Control-Max-Age',
      'Cache-Control',
      'Vary',
      'X-Content-Type-Options',
      'X-Request-Id',
    ]);
  });
});
